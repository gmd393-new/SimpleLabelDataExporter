# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Niimbot Exporter** is a Shopify App built with React Router (Remix framework) that allows merchants to select products/variants from their inventory and export them as an Excel file (.xlsx) formatted specifically for the Niimbot label printing application.

## Development Commands

```bash
# Start development server (opens app in your development store)
shopify app dev

# Build for production
npm run build

# Deploy to Shopify
shopify app deploy

# Generate a new extension
shopify app generate extension

# Run linter
npm run lint
```

## Architecture

### Tech Stack
- **Framework**: React Router (Shopify App Template)
- **UI Library**: Shopify Polaris web components (s-page, s-button, etc.)
- **API**: Shopify Admin GraphQL API
- **Authentication**: Shopify App Bridge
- **Database**: Prisma (SQLite in development)

### Key Files

**Navigation** (`app/routes/app.jsx`)
- Defines app navigation in `<s-app-nav>` component
- Add new routes here to make them accessible in the app sidebar

**GraphQL Queries** (`app/graphql/products.js`)
- `PRODUCTS_QUERY`: Fetches products with variants including barcode, SKU, price, and inventory data
- Verified against Shopify Admin GraphQL API schema

**Export Route** (`app/routes/app.export.jsx`)
- **Loader**: Fetches product/variant data via GraphQL and flattens for table display
- **Component**: Uses Polaris web components and custom HTML table with multi-select functionality
- **Download Mechanism**: Client-side XLSX generation using SheetJS library and Blob API to avoid App Bridge iframe restrictions
- **Dependencies**: `xlsx` package for Excel file generation

**Configuration** (`shopify.app.toml`)
- App configuration including client_id, scopes, and webhooks
- `access_scopes = "write_products"` - required for reading product data

### Data Model

Each row in the export table represents a **ProductVariant** (not a Product). This is crucial because:
- Variants contain the actual SKU, barcode, and pricing information
- A single product can have multiple variants (e.g., T-Shirt in sizes S, M, L)
- The export operates on variants to provide accurate label data

### Excel Export Format

The XLSX file is formatted specifically for Niimbot label printers:

1. **Price**: Raw decimal number without currency symbols (e.g., `10.00` not `$10.00`)
2. **Barcode**: Cell type set to "string" to prevent Excel from converting to scientific notation (prevents `123456789` from becoming `1.23E+08`)
3. **Columns**: Product Name, Variant, SKU, Barcode, Price
4. **Column Widths**: Auto-sized for readability
5. **Filename**: Auto-generated with date stamp: `niimbot-labels-YYYY-MM-DD.xlsx`
6. **Library**: Uses SheetJS (xlsx) for client-side Excel generation

### GraphQL Field Reference

Verified against Shopify Admin API (2026-04):
- `ProductVariant.barcode` (String) - The UPC/barcode value
- `ProductVariant.price` (Money!) - Price in shop currency
- `ProductVariant.sku` (String) - Stock keeping unit
- `ProductVariant.inventoryQuantity` (Int) - Current stock level
- `ProductVariant.displayName` (String) - Full display name including variant options

### File Downloads in Embedded Apps

**Important**: Shopify App Bridge can interfere with file downloads in embedded apps when using fetch/form submissions or server-generated downloads from within the iframe.

**Solution**: Generate files on the client side using the Blob API:

```javascript
// For CSV files
const blob = new Blob([csvContent], { type: "text/csv" });

// For Excel files (using SheetJS)
const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
const blob = new Blob([wbout], {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

// Trigger download
const url = window.URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "filename.xlsx";
document.body.appendChild(a);
a.click();
window.URL.revokeObjectURL(url);
document.body.removeChild(a);
```

This approach:
- Works within the iframe without authentication issues
- Doesn't require server round-trips for data already loaded
- Avoids App Bridge redirect complications

Alternative: If server-side generation is required, use `window.open(downloadUrl, "_blank")` with one-time tokens.

Source: [Shopify Community - How do I force a download with App Bridge?](https://community.shopify.com/c/shopify-apis-and-sdks/how-do-i-force-a-download-with-app-bridge/m-p/611434)

### Adding New Routes

To add a new route to the app:

1. Create file in `app/routes/` following naming convention:
   - `app.routename.jsx` for routes accessible via `/app/routename`
   - Use underscore prefix for routes without layout: `app._index.jsx`

2. Add navigation link in `app/routes/app.jsx`:
   ```jsx
   <s-link href="/app/routename">Route Name</s-link>
   ```

3. Export required functions:
   - `loader` - Server-side data fetching
   - `action` - Form submission handling
   - `default` - React component

### Authentication

All app routes use `authenticate.admin(request)` from `app/shopify.server.js` to:
- Verify the session is valid
- Provide access to the Admin GraphQL API via `admin.graphql()`
- Handle OAuth flow automatically
