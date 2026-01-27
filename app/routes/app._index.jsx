import { useLoaderData, useSubmit, useFetcher } from "react-router";
import { useState, useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PRODUCTS_QUERY, UPDATE_VARIANT_BARCODE_MUTATION } from "../graphql/products";
import crypto from "crypto";
import db from "../db.server";
import { generateUniqueBarcode } from "../utils/barcode";

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
        productId: product.id,
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
 * Action: Handles both export and barcode generation actions
 *
 * Actions:
 * 1. "export" - Creates a one-time download token for mobile-compatible file exports
 * 2. "generateBarcode" - Generates and updates a unique barcode for a variant
 */
export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const actionType = formData.get("actionType");

  // Handle barcode generation
  if (actionType === "generateBarcode") {
    const variantId = formData.get("variantId");
    const productId = formData.get("productId");

    if (!variantId || !productId) {
      return { error: "No variant ID or product ID provided" };
    }

    try {
      // Generate a unique barcode
      const newBarcode = await generateUniqueBarcode(admin);

      // Update the variant in Shopify using bulk update mutation
      const response = await admin.graphql(UPDATE_VARIANT_BARCODE_MUTATION, {
        variables: {
          productId: productId,
          variants: [
            {
              id: variantId,
              barcode: newBarcode,
            },
          ],
        },
      });

      const data = await response.json();

      // Check for errors
      if (data.data.productVariantsBulkUpdate.userErrors.length > 0) {
        const errorMessages = data.data.productVariantsBulkUpdate.userErrors
          .map((e) => e.message)
          .join(", ");
        return { error: `Failed to update barcode: ${errorMessages}` };
      }

      // Return success with new barcode
      return {
        success: true,
        actionType: "generateBarcode",
        variantId,
        barcode: newBarcode,
      };
    } catch (error) {
      console.error("Barcode generation error:", error);
      return { error: error.message || "Failed to generate barcode" };
    }
  }

  // Handle export action
  if (actionType === "export" || !actionType) {
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
      actionType: "export",
      downloadUrl: `/download?token=${token}`,
      fileName,
    };
  }

  return { error: "Invalid action type" };
}

/**
 * Component: Product selection table with export functionality
 */
export default function ExportPage() {
  const { variants: initialVariants, searchQuery } = useLoaderData();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const fetcher = useFetcher();
  const barcodeFetcher = useFetcher();
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchInput, setSearchInput] = useState(searchQuery || "");
  const debounceTimer = useRef(null);
  const [labelQuantities, setLabelQuantities] = useState({});
  const [variants, setVariants] = useState(initialVariants);
  const [generatingBarcodeFor, setGeneratingBarcodeFor] = useState(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const downloadInitiatedRef = useRef(null);

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

    // Auto-select the item when quantity is changed
    if (!selectedIds.includes(variantId)) {
      setSelectedIds(prev => [...prev, variantId]);
    }
  };

  // Increment quantity by 1
  const handleIncrement = (variantId, variant) => {
    const currentQty = getEffectiveQuantity(variantId, variant);
    handleQuantityChange(variantId, currentQty + 1);
  };

  // Decrement quantity by 1 (minimum 0)
  const handleDecrement = (variantId, variant) => {
    const currentQty = getEffectiveQuantity(variantId, variant);
    if (currentQty > 0) {
      handleQuantityChange(variantId, currentQty - 1);
    }
  };

  // Set specific quantity (for quick-set buttons)
  const handleSetQuantity = (variantId, quantity) => {
    handleQuantityChange(variantId, quantity);
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

  // Update variants when loader data changes (e.g., after search)
  useEffect(() => {
    setVariants(initialVariants);
  }, [initialVariants]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  // Detect desktop vs mobile for conditional rendering
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');

    // Set initial value
    setIsDesktop(mediaQuery.matches);

    // Listen for changes
    const handler = (e) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Handle barcode generation response
  useEffect(() => {
    if (barcodeFetcher.data && barcodeFetcher.data.success && barcodeFetcher.data.actionType === "generateBarcode") {
      const { variantId, barcode } = barcodeFetcher.data;

      // Update the variant in local state
      setVariants((prevVariants) =>
        prevVariants.map((v) =>
          v.id === variantId ? { ...v, barcode } : v
        )
      );

      setGeneratingBarcodeFor(null);
      shopify.toast.show(`Barcode generated: ${barcode}`);
    } else if (barcodeFetcher.data && barcodeFetcher.data.error) {
      setGeneratingBarcodeFor(null);
      shopify.toast.show(barcodeFetcher.data.error, { isError: true });
    }
  }, [barcodeFetcher.data, shopify]);

  // Handle export response from server
  useEffect(() => {
    if (fetcher.data && fetcher.data.success && fetcher.data.actionType === "export") {
      const { downloadUrl } = fetcher.data;

      // Prevent duplicate downloads - check if we've already initiated this download
      if (downloadInitiatedRef.current === downloadUrl) {
        return;
      }
      downloadInitiatedRef.current = downloadUrl;

      // Construct full URL for download
      const fullDownloadUrl = `${window.location.origin}${downloadUrl}`;

      // Use hidden iframe approach for smoother mobile experience
      // This triggers the download without opening/closing a new tab
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = fullDownloadUrl;
      document.body.appendChild(iframe);

      // Clean up iframe after download starts
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 5000);

      // Calculate total labels for success message
      const selectedVariants = variants.filter((v) => selectedIds.includes(v.id));
      const totalLabels = selectedVariants.reduce((sum, variant) => {
        const qty = getEffectiveQuantity(variant.id, variant);
        return sum + qty;
      }, 0);

      shopify.toast.show(`Exporting ${totalLabels} label${totalLabels !== 1 ? 's' : ''}... Download starting!`);
    } else if (fetcher.data && fetcher.data.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify, variants, selectedIds]);

  const handleGenerateBarcode = (variantId, productId) => {
    setGeneratingBarcodeFor(variantId);

    const formData = new FormData();
    formData.append("actionType", "generateBarcode");
    formData.append("variantId", variantId);
    formData.append("productId", productId);
    barcodeFetcher.submit(formData, { method: "post" });
  };

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
    formData.append("actionType", "export");
    formData.append("exportData", JSON.stringify(exportData));
    fetcher.submit(formData, { method: "post" });
  };

  // Calculate total labels for sticky action bar
  const totalLabels = selectedIds.reduce((sum, id) => {
    const variant = variants.find(v => v.id === id);
    const qty = getEffectiveQuantity(id, variant);
    return sum + qty;
  }, 0);

  return (
    <>
      <style>{`
        /* Mobile-first responsive styles */
        .mobile-cards {
          display: block;
        }
        .desktop-table {
          display: none;
        }


        /* Quantity Stepper Controls */
        .quantity-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: stretch;
        }

        .stepper {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .stepper button {
          width: 44px;
          height: 44px;
          font-size: 20px;
          font-weight: 600;
          color: #202223;
          background: #ffffff;
          border: 1px solid #c9cccf;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .stepper button:hover {
          background: #f6f6f7;
          border-color: #8c9196;
        }

        .stepper button:active {
          transform: scale(0.95);
          background: #e1e3e5;
        }

        .stepper .quantity-display {
          min-width: 48px;
          font-size: 20px;
          font-weight: 700;
          text-align: center;
          color: #202223;
        }

        .quick-set {
          display: flex;
          gap: 6px;
          justify-content: center;
        }

        .quick-set button {
          flex: 1;
          height: 36px;
          font-size: 16px;
          font-weight: 600;
          color: #008060;
          background: #f1f8f5;
          border: 1px solid #008060;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .quick-set button:hover {
          background: #008060;
          color: #ffffff;
        }

        .quick-set button:active {
          transform: scale(0.95);
        }

        /* Product Card Styles */
        .product-card {
          border: 1px solid #e1e3e5;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          background: #ffffff;
          transition: all 0.2s ease;
        }

        .product-card.selected {
          border-color: #008060;
          background: #f1f8f5;
          box-shadow: 0 0 0 2px rgba(0, 128, 96, 0.1);
        }

        .card-header {
          display: flex;
          gap: 12px;
          margin-bottom: 12px;
        }

        .card-checkbox {
          flex-shrink: 0;
          margin-top: 4px;
        }

        .card-checkbox input[type="checkbox"] {
          width: 24px;
          height: 24px;
          cursor: pointer;
        }

        .card-image {
          flex-shrink: 0;
        }

        .card-image img {
          width: 80px;
          height: 80px;
          object-fit: cover;
          border-radius: 6px;
        }

        .card-image-placeholder {
          width: 80px;
          height: 80px;
          background: #e1e3e5;
          border-radius: 6px;
        }

        .card-info {
          flex: 1;
          min-width: 0;
        }

        .card-title {
          font-size: 16px;
          font-weight: 600;
          color: #202223;
          margin: 0 0 4px 0;
          word-wrap: break-word;
        }

        .card-variant {
          font-size: 14px;
          color: #6d7175;
          margin: 0 0 8px 0;
        }

        .card-price {
          font-size: 18px;
          font-weight: 700;
          color: #008060;
        }

        .card-metadata {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 12px;
          color: #6d7175;
          margin-bottom: 12px;
          padding: 8px 0;
          border-top: 1px solid #e1e3e5;
        }

        .card-metadata-item {
          display: flex;
          gap: 4px;
        }

        .card-metadata-label {
          font-weight: 600;
        }

        /* Sticky Bottom Action Bar */
        .sticky-action-bar {
          position: sticky;
          bottom: 0;
          left: 0;
          right: 0;
          background: #ffffff;
          border-top: 2px solid #e1e3e5;
          box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
          padding: 16px;
          z-index: 100;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .action-bar-status {
          font-size: 14px;
          color: #202223;
          text-align: center;
          font-weight: 600;
        }

        .action-bar-buttons {
          display: flex;
          gap: 8px;
        }

        .action-bar-button {
          flex: 1;
          height: 48px;
          font-size: 16px;
          font-weight: 600;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .action-bar-button.primary {
          background: #008060;
          color: #ffffff;
        }

        .action-bar-button.primary:hover {
          background: #006e52;
        }

        .action-bar-button.primary:disabled {
          background: #e1e3e5;
          color: #8c9196;
          cursor: not-allowed;
        }

        .action-bar-button.secondary {
          background: #ffffff;
          color: #202223;
          border: 1px solid #c9cccf;
        }

        .action-bar-button.secondary:hover {
          background: #f6f6f7;
        }

        .action-bar-button.secondary:disabled {
          background: #f6f6f7;
          color: #8c9196;
          cursor: not-allowed;
        }

        /* Desktop breakpoint */
        @media (min-width: 768px) {
          .mobile-cards {
            display: none;
          }
          .desktop-table {
            display: block;
          }
        }
      `}</style>

      <s-page heading="Simple Exporter for Labels">
        {isDesktop && (
          <>
            <s-button
              slot="primary-action"
              variant="primary"
              onClick={handleExport}
              {...(selectedIds.length === 0 ? { disabled: true } : {})}
            >
              {(() => {
                if (selectedIds.length === 0) return "Export Selected";

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
          </>
        )}

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

          {/* Select All - Mobile */}
          <div className="mobile-cards" style={{ marginBottom: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: "600" }}>
              <input
                type="checkbox"
                onChange={handleSelectAll}
                checked={selectedIds.length === variants.length && variants.length > 0}
                style={{ width: "20px", height: "20px", cursor: "pointer" }}
              />
              Select All ({variants.length})
            </label>
          </div>

          {/* Mobile Card Layout */}
          <div className="mobile-cards">
            {variants.map((variant) => (
              <div
                key={variant.id}
                className={`product-card ${selectedIds.includes(variant.id) ? 'selected' : ''}`}
              >
                <div className="card-header">
                  <div className="card-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(variant.id)}
                      onChange={() => handleSelectOne(variant.id)}
                    />
                  </div>

                  <div className="card-image">
                    {variant.image ? (
                      <img src={variant.image} alt={variant.imageAlt} />
                    ) : (
                      <div className="card-image-placeholder" />
                    )}
                  </div>

                  <div className="card-info">
                    <h3 className="card-title">{variant.productTitle}</h3>
                    {variant.variantTitle && variant.variantTitle !== "Default Title" && (
                      <p className="card-variant">{variant.variantTitle}</p>
                    )}
                    <div className="card-price">${variant.price}</div>
                  </div>
                </div>

                <div className="card-metadata">
                  <div className="card-metadata-item">
                    <span className="card-metadata-label">Stock:</span>
                    <span>{variant.inventoryQuantity}</span>
                  </div>
                  <div className="card-metadata-item">
                    <span className="card-metadata-label">SKU:</span>
                    <span>{variant.sku}</span>
                  </div>
                  {variant.vendor && (
                    <div className="card-metadata-item">
                      <span className="card-metadata-label">Vendor:</span>
                      <span>{variant.vendor}</span>
                    </div>
                  )}
                  <div className="card-metadata-item" style={{ flex: "1 1 100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span className="card-metadata-label">Barcode:</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        {variant.barcode ? (
                          variant.barcode
                        ) : (
                          <>
                            <span style={{ fontSize: "14px", color: "#bf0711" }}>🚫</span>
                            <span style={{ color: "#6d7175", fontStyle: "italic" }}>None</span>
                          </>
                        )}
                      </span>
                    </div>
                    {!variant.barcode && (
                      <button
                        onClick={() => handleGenerateBarcode(variant.id, variant.productId)}
                        disabled={generatingBarcodeFor === variant.id}
                        style={{
                          padding: "6px 12px",
                          fontSize: "13px",
                          fontWeight: "600",
                          color: generatingBarcodeFor === variant.id ? "#6d7175" : "#008060",
                          background: generatingBarcodeFor === variant.id ? "#f6f6f7" : "#f1f8f5",
                          border: `1px solid ${generatingBarcodeFor === variant.id ? "#c9cccf" : "#008060"}`,
                          borderRadius: "6px",
                          cursor: generatingBarcodeFor === variant.id ? "not-allowed" : "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        {generatingBarcodeFor === variant.id ? "Generating..." : "Generate"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="quantity-controls">
                  <div className="stepper">
                    <button
                      onClick={() => handleDecrement(variant.id, variant)}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="quantity-display">
                      {getEffectiveQuantity(variant.id, variant)}
                    </span>
                    <button
                      onClick={() => handleIncrement(variant.id, variant)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>

                  <div className="quick-set">
                    <button onClick={() => handleSetQuantity(variant.id, 1)}>1</button>
                    <button onClick={() => handleSetQuantity(variant.id, 2)}>2</button>
                    <button onClick={() => handleSetQuantity(variant.id, 3)}>3</button>
                  </div>

                  {labelQuantities[variant.id] !== undefined && (
                    <button
                      onClick={() => handleResetSingleQuantity(variant.id)}
                      style={{
                        padding: "8px",
                        fontSize: "13px",
                        color: "#5c6ac4",
                        background: "none",
                        border: "1px solid #c9cccf",
                        borderRadius: "6px",
                        cursor: "pointer",
                        marginTop: "4px",
                      }}
                      title="Reset to stock quantity"
                    >
                      ↺ Reset to stock ({variant.inventoryQuantity})
                    </button>
                  )}
                </div>
              </div>
            ))}

            {variants.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px", color: "#6d7175" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>📦</div>
                <p style={{ fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
                  No products found
                </p>
                <p style={{ fontSize: "14px" }}>
                  {searchInput ? "Try searching for something else" : "Make sure you have products in your store"}
                </p>
              </div>
            )}
          </div>

          {/* Desktop Table Layout */}
          <div className="desktop-table">

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
                          {variant.barcode ? (
                            variant.barcode
                          ) : (
                            <button
                              onClick={() => handleGenerateBarcode(variant.id, variant.productId)}
                              disabled={generatingBarcodeFor === variant.id}
                              style={{
                                padding: "6px 12px",
                                fontSize: "13px",
                                fontWeight: "600",
                                color: generatingBarcodeFor === variant.id ? "#6d7175" : "#008060",
                                background: generatingBarcodeFor === variant.id ? "#f6f6f7" : "#f1f8f5",
                                border: `1px solid ${generatingBarcodeFor === variant.id ? "#c9cccf" : "#008060"}`,
                                borderRadius: "6px",
                                cursor: generatingBarcodeFor === variant.id ? "not-allowed" : "pointer",
                                transition: "all 0.15s ease",
                              }}
                            >
                              {generatingBarcodeFor === variant.id ? "Generating..." : "Generate"}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          {variant.inventoryQuantity}
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "120px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
                              <button
                                onClick={() => handleDecrement(variant.id, variant)}
                                style={{
                                  width: "32px",
                                  height: "32px",
                                  fontSize: "18px",
                                  fontWeight: "600",
                                  color: "#202223",
                                  background: "#ffffff",
                                  border: "1px solid #c9cccf",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                aria-label="Decrease quantity"
                              >
                                −
                              </button>
                              <span style={{ minWidth: "32px", fontSize: "16px", fontWeight: "700", textAlign: "center" }}>
                                {getEffectiveQuantity(variant.id, variant)}
                              </span>
                              <button
                                onClick={() => handleIncrement(variant.id, variant)}
                                style={{
                                  width: "32px",
                                  height: "32px",
                                  fontSize: "18px",
                                  fontWeight: "600",
                                  color: "#202223",
                                  background: "#ffffff",
                                  border: "1px solid #c9cccf",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                aria-label="Increase quantity"
                              >
                                +
                              </button>
                            </div>
                            <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                              <button
                                onClick={() => handleSetQuantity(variant.id, 1)}
                                style={{
                                  flex: "1",
                                  height: "24px",
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  color: "#008060",
                                  background: "#f1f8f5",
                                  border: "1px solid #008060",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                1
                              </button>
                              <button
                                onClick={() => handleSetQuantity(variant.id, 2)}
                                style={{
                                  flex: "1",
                                  height: "24px",
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  color: "#008060",
                                  background: "#f1f8f5",
                                  border: "1px solid #008060",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                2
                              </button>
                              <button
                                onClick={() => handleSetQuantity(variant.id, 3)}
                                style={{
                                  flex: "1",
                                  height: "24px",
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  color: "#008060",
                                  background: "#f1f8f5",
                                  border: "1px solid #008060",
                                  borderRadius: "4px",
                                  cursor: "pointer",
                                }}
                              >
                                3
                              </button>
                            </div>
                            {labelQuantities[variant.id] !== undefined && (
                              <button
                                onClick={() => handleResetSingleQuantity(variant.id)}
                                style={{
                                  padding: "4px",
                                  fontSize: "11px",
                                  color: "#5c6ac4",
                                  background: "none",
                                  border: "none",
                                  cursor: "pointer",
                                  textDecoration: "underline",
                                }}
                                title="Reset to stock quantity"
                              >
                                ↺ Reset
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
          </div>
        </s-section>
      </s-page>

      {/* Sticky Bottom Action Bar - Mobile Only */}
      {!isDesktop && (
        <div className="sticky-action-bar">
          <div className="action-bar-status">
            {selectedIds.length > 0 ? (
              <>
                {selectedIds.length} selected • {totalLabels} label{totalLabels !== 1 ? 's' : ''}
              </>
            ) : (
              "Select products to export"
            )}
          </div>
          <div className="action-bar-buttons">
            <button
              className="action-bar-button secondary"
              onClick={handleResetQuantities}
              disabled={Object.keys(labelQuantities).length === 0}
            >
              Reset All
            </button>
            <button
              className="action-bar-button primary"
              onClick={handleExport}
              disabled={selectedIds.length === 0}
            >
              Export {totalLabels > 0 ? `(${totalLabels})` : ''}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
