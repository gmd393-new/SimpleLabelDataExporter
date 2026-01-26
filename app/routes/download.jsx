import * as XLSX from "xlsx";
import db from "../db.server";

/**
 * Download endpoint for mobile-compatible file exports
 *
 * This route is NOT under the app layout (not app.download.jsx), which means:
 * - It's not embedded in an iframe
 * - File downloads work properly on mobile devices
 * - It loads in a new context when triggered by window.open()
 *
 * Security: Uses one-time tokens that expire after 15 minutes
 * Note: This route does NOT require Shopify authentication - the token IS the authentication
 * The token was created by an authenticated user and is shop-specific, one-time use, and expires.
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    throw new Response("Missing download token", { status: 400 });
  }

  // Find the download token in the database
  const downloadToken = await db.downloadToken.findUnique({
    where: { token },
  });

  if (!downloadToken) {
    throw new Response("Invalid or expired download token", { status: 403 });
  }

  // Verify token hasn't expired (15 minutes)
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  if (downloadToken.createdAt < fifteenMinutesAgo) {
    // Clean up expired token
    await db.downloadToken.delete({ where: { token } });
    throw new Response("Download token expired", { status: 403 });
  }

  // Token is valid - the token itself is the authentication
  // It was created by an authenticated user in the app._index action
  // and is tied to a specific shop

  // Parse the export data from the token
  const exportData = JSON.parse(downloadToken.data);

  // Build worksheet data - formatted for label printing
  const wsData = [];

  // Header row
  wsData.push(["Product Name", "Size", "Barcode", "Price"]);

  // Data rows
  exportData.forEach((item) => {
    wsData.push([
      item.productTitle,
      item.variantTitle || "Default",
      item.barcode || "",
      `$${item.price || "0.00"}`,
    ]);
  });

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Format barcode column as text to prevent scientific notation
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let row = 1; row <= range.e.r; row++) {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: 2 });
    if (ws[cellAddress]) {
      ws[cellAddress].t = "s";
    }
  }

  // Set column widths
  ws["!cols"] = [
    { wch: 30 }, // Product Name
    { wch: 20 }, // Size
    { wch: 20 }, // Barcode
    { wch: 10 }, // Price
  ];

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Labels");

  // Generate XLSX file as buffer
  const wbout = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

  // Delete the one-time token (it's been consumed)
  await db.downloadToken.delete({ where: { token } });

  // Return file with proper headers for download
  // This works on both desktop and mobile browsers
  return new Response(wbout, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${downloadToken.fileName}"`,
      "Content-Length": wbout.length.toString(),
    },
  });
}
