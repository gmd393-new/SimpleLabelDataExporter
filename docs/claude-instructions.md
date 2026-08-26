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
- `CHECK_BARCODE_EXISTS_QUERY`: A safety-net search for a barcode across the store, used to catch hand-typed codes the ledger has never seen
- `GET_VARIANT_BARCODE_QUERY`: Fetches a single variant's current barcode directly from Shopify — the server's source of truth for the generate/replace overwrite guard
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
  - `generateBarcode`: Allocates a 12-digit UPC-A for a variant with no barcode
  - `replaceBarcode`: Allocates a UPC to explicitly overwrite a non-UPC (legacy) barcode
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

The app issues real 12-digit UPC-A codes for variants, allocated sequentially from a
permanent ledger rather than generated at random. A UPC must be used only once, ever,
so uniqueness comes from a database constraint, not from checking Shopify for
collisions.

**The ledger** (`prisma/schema.prisma` — `UpcAllocation` model)
- One row per issued UPC: `upc`, `itemCode`, `shop`, `productId`, `variantId`, `replacedBarcode`
- `itemCode` and `upc` are unique constraints — these, not any application-level
  lock, are what guarantee a code is never issued twice
- Rows are never deleted; a burned code (e.g. the Shopify update after allocation
  fails) is simply never reused

**Utility Functions** (`app/utils/barcode.js`, `app/utils/upc.js`)
- `getUpcPrefix()`: Reads `UPC_PREFIX` from the environment. Throws if it is unset —
  there is no default, because each store runs its own database and a shared or
  missing prefix would let two stores mint the identical UPC
- `allocateUpc({ dbClient, prefix, allocation, barcodeExists })`: Reads the highest
  `itemCode` in the ledger, computes the next one, builds a UPC, and inserts it;
  retries on a unique-constraint race (`P2002`) or on `barcodeExists` reporting the
  candidate already lives in Shopify
- `checkBarcodeExists(admin, barcode)`: A safety net for hand-typed codes the ledger
  has never seen — not the uniqueness guarantee, the ledger is
- `generateUniqueUpc(admin, allocation)`: Wires `allocateUpc` to the real Prisma
  client and Shopify
- `buildUpc(prefix, itemCode)` / `calculateCheckDigit` / `isValidUpc` / `isOurUpc`
  (`app/utils/upc.js`): GS1 check-digit math and helpers for recognizing our own
  codes vs. legacy or foreign barcodes

**Generate vs. Replace** — two actions in `app/routes/app._index.jsx`, deliberately
kept separate so an existing barcode is never overwritten implicitly:
1. `generateBarcode`: only for a variant with no barcode. The server fetches the
   variant's *live* barcode from Shopify (via `GET_VARIANT_BARCODE_QUERY`) and
   refuses if it is non-empty — a client-supplied value is never trusted for this
   decision, since the client's copy can be stale.
2. `replaceBarcode`: only for a variant that already has a barcode that is not one
   of ours (`isOurUpc`) and is not empty. Requires explicit user confirmation in the
   UI. The live barcode read from Shopify is recorded as `replacedBarcode` in the
   ledger.

Both paths then call `generateUniqueUpc` to allocate the next code and
`productVariantsBulkUpdate` to write it to Shopify.

**Features**:
- Database-level uniqueness guarantee (unique constraints), not collision retry
- Real-time UI updates without page reload
- Works on both mobile and desktop views
- Saves directly to Shopify (no manual entry needed)
- Toast notifications show the generated or replaced barcode

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
flyctl deploy --config .fly/production.toml --app <production-app>

# Database Access
flyctl postgres connect --app <production-app>-db       # Connect to production DB
```
