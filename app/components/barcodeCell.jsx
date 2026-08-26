/**
 * Shared bits of the barcode cell, used by both the mobile card and the desktop
 * table. The two layouts differ enough that only these pieces are worth sharing.
 */

/**
 * Styling for the Generate / Replace / confirm buttons.
 * @param {boolean} busy
 */
export function barcodeActionStyle(busy) {
  return {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: "600",
    color: busy ? "#6d7175" : "#008060",
    background: busy ? "#f6f6f7" : "#f1f8f5",
    border: `1px solid ${busy ? "#c9cccf" : "#008060"}`,
    borderRadius: "6px",
    cursor: busy ? "not-allowed" : "pointer",
    transition: "all 0.15s ease",
  };
}

/** Marks a barcode that is not a UPC and so cannot ship to Paradies. */
export function LegacyBadge() {
  return (
    <span
      title="Not a UPC — this item cannot ship to Paradies until it is replaced"
      style={{
        padding: "1px 6px",
        fontSize: "11px",
        fontWeight: "600",
        color: "#8a6116",
        background: "#fff5ea",
        border: "1px solid #e1b878",
        borderRadius: "10px",
        whiteSpace: "nowrap",
      }}
    >
      Legacy
    </span>
  );
}
