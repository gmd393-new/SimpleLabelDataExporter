# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Simple Exporter for Labels** is a Shopify App built with React Router (Remix framework) that allows merchants to select products/variants from their inventory and export them as an Excel file (.xlsx) formatted for label printing applications.

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
- **Database**: Prisma (PostgreSQL in development via Docker)

### Key Files

**App Layout** (`app/routes/app.jsx`)
- Provides AppProvider wrapper for embedded app authentication
- No navigation menu (single-page app)

**GraphQL Queries & Mutations** (`app/graphql/products.js`)
- `PRODUCTS_QUERY`: Fetches products with variants including barcode, SKU, price, and inventory data
- `CHECK_BARCODE_EXISTS_QUERY`: Verifies if a barcode already exists in the store
- `UPDATE_VARIANT_BARCODE_MUTATION`: Updates a variant's barcode using productVariantsBulkUpdate
- Supports search filtering via `$query` parameter
- Search syntax: `title:*term* OR sku:*term* OR barcode:*term*`

**Main Route** (`app/routes/app._index.jsx`)
- **Loader**:
  - Fetches product/variant data via GraphQL
  - Handles `?search=` query parameter for product filtering
  - Returns up to 50 products per search
  - Includes productId in variant data for barcode updates
- **Actions**:
  - `export`: Creates one-time download token for Excel file export
  - `generateBarcode`: Generates unique 8-digit barcode and updates variant in Shopify
- **Component**:
  - Live search input with 500ms debouncing
  - Product table with multi-select checkboxes
  - Barcode generation buttons for variants without barcodes
  - Uses Polaris web components and custom HTML table
- **Download Mechanism**:
  - Hybrid approach for desktop and mobile compatibility
  - Server generates Excel file and returns as base64 (maintains authentication)
  - Client converts base64 to Blob and triggers download (works in embedded apps)
  - Compatible with both desktop and mobile Shopify apps
- **Dependencies**: `xlsx` package for Excel file generation

**Configuration** (`shopify.app.toml`)
- App configuration including client_id, scopes, and webhooks
- `access_scopes = "write_products"` - required for reading product data and generating barcodes

### Data Model

Each row in the export table represents a **ProductVariant** (not a Product). This is crucial because:
- Variants contain the actual SKU, barcode, and pricing information
- A single product can have multiple variants (e.g., T-Shirt in sizes S, M, L)
- The export operates on variants to provide accurate label data

### Barcode Generation

The app can generate unique 8-digit barcodes for variants that don't have one:

**Utility Functions** (`app/utils/barcode.js`)
- `generateRandomBarcode()`: Creates random 8-digit number (10000000-99999999)
- `checkBarcodeExists(admin, barcode)`: Verifies barcode doesn't already exist in store
- `generateUniqueBarcode(admin)`: Loops until unique barcode found (max 10 attempts)

**Generation Process**:
1. User clicks "Generate" button on variant without barcode
2. Server generates random 8-digit number
3. Checks if barcode already exists in store via GraphQL query
4. If collision detected, tries again (up to 10 attempts)
5. Updates variant in Shopify using `productVariantsBulkUpdate` mutation
6. Returns new barcode to client for immediate UI update

**Features**:
- Collision detection prevents duplicate barcodes
- Real-time UI updates without page reload
- Works on both mobile and desktop views
- Saves directly to Shopify (no manual entry needed)
- Toast notifications show generated barcode

### Excel Export Format

The XLSX file is formatted for label printing:

1. **Price**: Formatted with dollar sign (e.g., `$10.00`)
2. **Barcode**: Cell type set to "string" to prevent Excel from converting to scientific notation (prevents `123456789` from becoming `1.23E+08`)
3. **Columns**: Product Name, Size, Barcode, Price
4. **Column Widths**: Auto-sized for readability
5. **Filename**: Auto-generated with date stamp: `label-export-YYYY-MM-DD.xlsx`
6. **Library**: Uses SheetJS (xlsx) for server-side generation with client-side download trigger

### GraphQL Field Reference

Verified against Shopify Admin API (2026-04):
- `ProductVariant.barcode` (String) - The UPC/barcode value
- `ProductVariant.price` (Money!) - Price in shop currency
- `ProductVariant.sku` (String) - Stock keeping unit
- `ProductVariant.inventoryQuantity` (Int) - Current stock level
- `ProductVariant.displayName` (String) - Full display name including variant options

### File Downloads in Embedded Apps

**Important**: File downloads in embedded Shopify apps require special handling to work on both desktop and mobile.

**This App's Solution** - Hybrid Server/Client Approach:

1. **Server-side**: Generate Excel file using SheetJS, return as base64 via action
2. **Client-side**: Convert base64 to Blob and trigger download

```javascript
// In action (server-side)
const wbout = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
return { success: true, fileData: wbout, fileName: "export.xlsx" };

// In component (client-side)
const byteCharacters = atob(fileData);
const byteArray = new Uint8Array(byteCharacters.length);
for (let i = 0; i < byteCharacters.length; i++) {
  byteArray[i] = byteCharacters.charCodeAt(i);
}
const blob = new Blob([byteArray], {
  type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
});

const url = window.URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = fileName;
document.body.appendChild(a);
a.click();
window.URL.revokeObjectURL(url);
document.body.removeChild(a);
```

**Why this approach?**
- ✅ Maintains authentication context (uses React Router action)
- ✅ Works on desktop embedded apps
- ✅ Works on mobile Shopify app
- ✅ Server-side generation is more reliable for large files
- ✅ Avoids App Bridge iframe download restrictions

### Adding New Routes

This is currently a single-page app with no navigation. To add additional routes:

1. Create file in `app/routes/` following naming convention:
   - `app.routename.jsx` for routes accessible via `/app/routename`
   - Use underscore prefix for index routes: `app._index.jsx`

2. If multiple pages are needed, re-add navigation in `app/routes/app.jsx`:
   ```jsx
   <s-app-nav>
     <s-link href="/app">Home</s-link>
     <s-link href="/app/routename">Route Name</s-link>
   </s-app-nav>
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

## Deployment Architecture

This app uses a **three-tier deployment strategy**:

1. **Development**: Local development with PostgreSQL (Docker)
2. **Staging**: fly.io deployment for testing
3. **Production**: fly.io deployment serving all customers

**Note**: Actual deployment URLs are stored in `.claude/deployment-config.local.json` (gitignored).

### Environment Overview

| Environment | Database | URL | Purpose |
|------------|----------|-----|---------|
| Development | PostgreSQL (Docker) | localhost (via tunnel) | Active development |
| Staging | PostgreSQL | <staging-app>.fly.dev | Pre-production testing |
| Production | PostgreSQL | <production-app>.fly.dev | Customer deployments |

### Multi-Tenant Production

Production uses a **single shared deployment** for all customers:
- Each customer gets a custom Shopify app installed in their store
- All custom apps point to the same production URL
- Sessions are isolated by the `shop` field in the database
- Access tokens are shop-specific, preventing cross-customer data access

### Documentation Files

For detailed information, see:

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Local development setup and workflow
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** - Deploying to staging and production
- **[CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md)** - Adding new customers to production
- **[DEPLOYMENT_STRATEGY.md](./DEPLOYMENT_STRATEGY.md)** - Architecture overview and quick reference

### Quick Commands

```bash
# Development
shopify app dev                                           # Start local dev server

# Staging Deployment
flyctl deploy                                             # Deploy to staging

# Production Deployment
flyctl deploy --config fly.production.toml --app <production-app>

# Database Access
flyctl postgres connect --app <production-app>-db       # Connect to production DB
```
