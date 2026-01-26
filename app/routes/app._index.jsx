import { useLoaderData, useSubmit, useFetcher } from "react-router";
import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PRODUCTS_QUERY } from "../graphql/products";
import crypto from "crypto";
import db from "../db.server";

/**
 * Loader: Fetches products and variants from Shopify Admin API
 */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Get search query from URL
  const url = new URL(request.url);
  const searchQuery = url.searchParams.get("search") || "";

  // Sanitize and validate search input
  let sanitizedQuery = "";
  if (searchQuery) {
    // Limit length to prevent DoS
    const trimmedQuery = searchQuery.trim().substring(0, 100);

    // Sanitize: escape special GraphQL query characters
    // Remove characters that could be used for query injection: *, ", :, OR, AND, NOT, parentheses
    sanitizedQuery = trimmedQuery
      .replace(/[*"():]/g, '') // Remove special query operators
      .replace(/\b(OR|AND|NOT)\b/gi, '') // Remove boolean operators
      .trim();
  }

  // Build GraphQL query string for Shopify product search
  // Search by product title, variant SKU, barcode, or vendor
  let graphqlQuery = "";
  if (sanitizedQuery) {
    // Use sanitized input with wildcards applied by us (not user-controlled)
    graphqlQuery = `title:*${sanitizedQuery}* OR sku:*${sanitizedQuery}* OR barcode:*${sanitizedQuery}* OR vendor:*${sanitizedQuery}*`;
  }

  // Fetch products with variants
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: {
      first: 50, // Fetch 50 products at a time
      query: graphqlQuery || null,
    },
  });

  const data = await response.json();

  // Flatten the data structure for easier rendering
  // Each row represents a variant
  const variantRows = [];

  data.data.products.edges.forEach(({ node: product }) => {
    product.variants.edges.forEach(({ node: variant }) => {
      variantRows.push({
        id: variant.id,
        productTitle: product.title,
        vendor: product.vendor || "",
        variantTitle: variant.title,
        displayName: variant.displayName,
        sku: variant.sku || "N/A",
        barcode: variant.barcode || "",
        price: variant.price,
        inventoryQuantity: variant.inventoryQuantity || 0,
        image: product.featuredImage?.url || null,
        imageAlt: product.featuredImage?.altText || product.title,
      });
    });
  });

  return {
    variants: variantRows,
    hasNextPage: data.data.products.pageInfo.hasNextPage,
    searchQuery,
  };
}

/**
 * Action: Creates a one-time download token for mobile-compatible file exports
 *
 * This approach works on both desktop and mobile Shopify apps by:
 * 1. Creating a secure one-time token
 * 2. Storing export data in the database temporarily
 * 3. Returning a download URL with the token
 * 4. Client uses App Bridge Redirect.REMOTE to open the download in a new context
 */
export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const exportDataJson = formData.get("exportData");

  if (!exportDataJson) {
    return { error: "No export data provided" };
  }

  // Generate a secure one-time token (crypto.randomUUID() in Node 19+)
  const token = crypto.randomUUID();

  const fileName = `label-export-${new Date().toISOString().split("T")[0]}.xlsx`;

  // Store token in database with export data (expires after 15 minutes)
  await db.downloadToken.create({
    data: {
      token,
      shop: session.shop,
      data: exportDataJson,
      fileName,
    },
  });

  // Return download URL with token
  return {
    success: true,
    downloadUrl: `/download?token=${token}`,
    fileName,
  };
}

/**
 * Component: Product selection table with export functionality
 */
export default function ExportPage() {
  const { variants, searchQuery } = useLoaderData();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchInput, setSearchInput] = useState(searchQuery || "");
  const debounceTimer = useRef(null);
  const [labelQuantities, setLabelQuantities] = useState({});

  // Get effective quantity (uses default if not customized)
  const getEffectiveQuantity = (variantId, variant) => {
    return labelQuantities[variantId] ?? (variant?.inventoryQuantity || 0);
  };

  // Update quantity for a variant with validation
  const handleQuantityChange = (variantId, value) => {
    const numValue = parseInt(value, 10);

    if (isNaN(numValue) || numValue < 0) return;

    if (numValue > 1000) {
      shopify.toast.show("Maximum quantity is 1000 labels per variant", {
        isError: true,
      });
      return;
    }

    if (numValue > 100) {
      shopify.toast.show("Large quantity detected. Export may take a moment.");
    }

    setLabelQuantities(prev => ({
      ...prev,
      [variantId]: numValue
    }));
  };

  // Reset all quantities to stock levels
  const handleResetQuantities = () => {
    setLabelQuantities({});
    shopify.toast.show("Label quantities reset to stock levels");
  };

  // Reset single quantity to stock level
  const handleResetSingleQuantity = (variantId) => {
    setLabelQuantities(prev => {
      const updated = { ...prev };
      delete updated[variantId];
      return updated;
    });
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(variants.map((v) => v.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Handle search input with debouncing
  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchInput(value);

    // Clear existing timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Set new timer to submit search after 500ms of no typing
    debounceTimer.current = setTimeout(() => {
      const formData = new FormData();
      formData.append("search", value);
      submit(formData, { method: "get" });
    }, 500);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  // Handle export response from server
  useEffect(() => {
    if (fetcher.data && fetcher.data.success) {
      const { downloadUrl } = fetcher.data;

      // Construct full URL for download
      // Using window.location.origin ensures it works in all environments
      const fullDownloadUrl = `${window.location.origin}${downloadUrl}`;

      // Open download URL in new window/tab
      // This works on both desktop and mobile Shopify apps
      // On desktop: opens in new tab with download
      // On mobile: triggers direct download
      window.open(fullDownloadUrl, '_blank');

      // Calculate total labels for success message
      const selectedVariants = variants.filter((v) => selectedIds.includes(v.id));
      const totalLabels = selectedVariants.reduce((sum, variant) => {
        const qty = getEffectiveQuantity(variant.id, variant);
        return sum + qty;
      }, 0);

      shopify.toast.show(`Export started! Download will begin in a new tab. (${totalLabels} label${totalLabels !== 1 ? 's' : ''})`);
    } else if (fetcher.data && fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify, variants, selectedIds]);

  const handleExport = () => {
    if (selectedIds.length === 0) {
      shopify.toast.show("Please select at least one variant to export", {
        isError: true,
      });
      return;
    }

    // Get selected variants from loaded data
    const selectedVariants = variants.filter((v) =>
      selectedIds.includes(v.id)
    );

    // Calculate total labels before export
    const totalLabels = selectedVariants.reduce((sum, variant) => {
      const qty = getEffectiveQuantity(variant.id, variant);
      return sum + qty;
    }, 0);

    // Validate that at least one label will be exported
    if (totalLabels === 0) {
      shopify.toast.show("Cannot export: All selected variants have 0 quantity. Please set label quantities before exporting.", {
        isError: true,
      });
      return;
    }

    // Build export data array - duplicate each variant based on its label quantity
    const exportData = [];
    selectedVariants.forEach((variant) => {
      const quantity = getEffectiveQuantity(variant.id, variant);

      if (quantity === 0) return; // Skip variants with 0 quantity

      // Add N rows for this variant (one row per label)
      for (let i = 0; i < quantity; i++) {
        exportData.push({
          productTitle: variant.productTitle,
          variantTitle: variant.variantTitle,
          barcode: variant.barcode,
          price: variant.price,
        });
      }
    });

    shopify.toast.show(`Exporting ${totalLabels} label${totalLabels !== 1 ? 's' : ''}...`);

    // Submit to server action - maintains authentication context
    // Works on both desktop and mobile Shopify apps
    const formData = new FormData();
    formData.append("exportData", JSON.stringify(exportData));
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <s-page heading="Simple Exporter for Labels">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleExport}
        {...(selectedIds.length === 0 ? { disabled: true } : {})}
      >
        {(() => {
          if (selectedIds.length === 0) return "Export Selected";

          const totalLabels = selectedIds.reduce((sum, id) => {
            const variant = variants.find(v => v.id === id);
            const qty = getEffectiveQuantity(id, variant);
            return sum + qty;
          }, 0);

          return `Export ${totalLabels} Label${totalLabels !== 1 ? 's' : ''} (${selectedIds.length} variant${selectedIds.length !== 1 ? 's' : ''})`;
        })()}
      </s-button>

      <s-button
        slot="secondary-actions"
        variant="secondary"
        onClick={handleResetQuantities}
        {...(Object.keys(labelQuantities).length === 0 ? { disabled: true } : {})}
      >
        Reset All Quantities
      </s-button>

      <s-section>
        <s-paragraph>
          Select product variants below and click "Export" to download an Excel
          file (.xlsx) formatted for label printing.
        </s-paragraph>

        {/* Search input */}
        <div style={{ marginBottom: "16px" }}>
          <input
            type="text"
            placeholder="Search by product name, SKU, barcode, or vendor..."
            value={searchInput}
            onChange={handleSearchChange}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "14px",
              border: "1px solid #c9cccf",
              borderRadius: "4px",
              boxSizing: "border-box",
            }}
          />
        </div>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    <input
                      type="checkbox"
                      onChange={handleSelectAll}
                      checked={
                        selectedIds.length === variants.length &&
                        variants.length > 0
                      }
                    />
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Image
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Product Name
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Vendor
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    SKU
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Barcode
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Stock
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Label Qty
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <tr
                    key={variant.id}
                    style={{
                      borderBottom: "1px solid #e1e3e5",
                      backgroundColor: selectedIds.includes(variant.id)
                        ? "#f6f6f7"
                        : "transparent",
                    }}
                  >
                    <td style={{ padding: "12px 8px" }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(variant.id)}
                        onChange={() => handleSelectOne(variant.id)}
                      />
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {variant.image ? (
                        <img
                          src={variant.image}
                          alt={variant.imageAlt}
                          style={{
                            width: "40px",
                            height: "40px",
                            objectFit: "cover",
                            borderRadius: "4px",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "40px",
                            height: "40px",
                            backgroundColor: "#e1e3e5",
                            borderRadius: "4px",
                          }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <div>
                        <strong>{variant.productTitle}</strong>
                        {variant.variantTitle &&
                          variant.variantTitle !== "Default Title" && (
                            <div
                              style={{
                                fontSize: "12px",
                                color: "#6d7175",
                                marginTop: "4px",
                              }}
                            >
                              {variant.variantTitle}
                            </div>
                          )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {variant.vendor || "—"}
                    </td>
                    <td style={{ padding: "12px 8px" }}>{variant.sku}</td>
                    <td style={{ padding: "12px 8px" }}>
                      {variant.barcode || "—"}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {variant.inventoryQuantity}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <input
                          type="number"
                          min="0"
                          max="1000"
                          value={getEffectiveQuantity(variant.id, variant)}
                          onChange={(e) => handleQuantityChange(variant.id, e.target.value)}
                          aria-label={`Label quantity for ${variant.displayName}`}
                          style={{
                            width: "60px",
                            padding: "4px 8px",
                            fontSize: "14px",
                            border: "1px solid #c9cccf",
                            borderRadius: "4px",
                            textAlign: "center",
                          }}
                        />
                        {labelQuantities[variant.id] !== undefined && (
                          <button
                            onClick={() => handleResetSingleQuantity(variant.id)}
                            style={{
                              padding: "2px 6px",
                              fontSize: "11px",
                              color: "#5c6ac4",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              textDecoration: "underline",
                            }}
                            title="Reset to stock quantity"
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 8px" }}>${variant.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-box>

        {variants.length === 0 && (
          <s-paragraph>
            No products found. Make sure you have products in your store.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
