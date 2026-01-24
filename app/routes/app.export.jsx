import { useLoaderData } from "react-router";
import { useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PRODUCTS_QUERY } from "../graphql/products";
import * as XLSX from "xlsx";

/**
 * Loader: Fetches products and variants from Shopify Admin API
 */
export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Fetch products with variants
  const response = await admin.graphql(PRODUCTS_QUERY, {
    variables: {
      first: 50, // Fetch 50 products at a time
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
  };
}

/**
 * Component: Product selection table with export functionality
 */
export default function ExportPage() {
  const { variants } = useLoaderData();
  const shopify = useAppBridge();
  const [selectedIds, setSelectedIds] = useState([]);

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

    // Build worksheet data - formatted for Niimbot
    const wsData = [];

    // Header row
    wsData.push([
      "Product Name",
      "Variant",
      "SKU",
      "Barcode",
      "Price",
    ]);

    // Data rows
    selectedVariants.forEach((variant) => {
      wsData.push([
        variant.productTitle,
        variant.variantTitle || "Default",
        variant.sku || "",
        variant.barcode || "",
        variant.price || "0.00",
      ]);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Format barcode column as text to prevent scientific notation
    // Column D (index 3) is the Barcode column
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let row = 1; row <= range.e.r; row++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: 3 }); // Column D (Barcode)
      if (ws[cellAddress]) {
        ws[cellAddress].t = "s"; // Set cell type to string
      }
    }

    // Set column widths for better readability
    ws["!cols"] = [
      { wch: 30 }, // Product Name
      { wch: 20 }, // Variant
      { wch: 15 }, // SKU
      { wch: 20 }, // Barcode
      { wch: 10 }, // Price
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Labels");

    // Generate XLSX file
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });

    // Create blob and trigger download
    const blob = new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `niimbot-labels-${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    shopify.toast.show(`Exported ${selectedIds.length} variants successfully`);
  };

  return (
    <s-page heading="Niimbot Label Exporter">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleExport}
        {...(selectedIds.length === 0 ? { disabled: true } : {})}
      >
        Export {selectedIds.length} Selected
      </s-button>

      <s-section>
        <s-paragraph>
          Select product variants below and click "Export" to download an Excel
          file (.xlsx) formatted for Niimbot label printers.
        </s-paragraph>

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
                    SKU
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Barcode
                  </th>
                  <th style={{ padding: "12px 8px", textAlign: "left" }}>
                    Stock
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
                    <td style={{ padding: "12px 8px" }}>{variant.sku}</td>
                    <td style={{ padding: "12px 8px" }}>
                      {variant.barcode || "—"}
                    </td>
                    <td style={{ padding: "12px 8px" }}>
                      {variant.inventoryQuantity}
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
