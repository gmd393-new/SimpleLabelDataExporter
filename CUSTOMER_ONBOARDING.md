# Customer Onboarding Guide

This guide provides step-by-step instructions for adding a new customer to the Label Data Exporter production deployment.

## Overview

Each customer gets a **custom Shopify app** installed in their store. All custom apps point to the same production URL (`https://simplelabels-prod.fly.dev`), but sessions are isolated by shop domain to ensure data security.

**Time to onboard**: 5-10 minutes per customer

## Prerequisites

- Access to the customer's Shopify admin (requires store owner or staff with app development permissions)
- Production environment deployed and running at `https://simplelabels-prod.fly.dev`

## Onboarding Steps

### Step 1: Access Customer's Shopify Admin

1. Log into the customer's Shopify store admin
2. Navigate to: **Settings** → **Apps and sales channels**
3. Click **Develop apps** (or **Develop apps for your store** if first time)

**Note**: If "Develop apps" is not visible, you may need to enable it:
- Click **Allow custom app development**
- Read and confirm the warning message

### Step 2: Create Custom App

1. Click **Create an app** button
2. Enter app details:
   - **App name**: `Label Data Exporter` (or customer's preferred name)
   - **App developer**: Your name or company name
3. Click **Create app**

### Step 3: Configure API Scopes

1. Click **Configure Admin API scopes** button
2. In the search box, type: `write_products`
3. Check the box for: ☑️ `write_products`
   - **Description**: "Read and write products, variants, and collections"
   - **Note**: This scope is required for both reading product data AND generating barcodes for variants
4. Scroll down and click **Save**

### Step 4: Install the App

1. Click the **API credentials** tab
2. Click **Install app** button
3. Confirm the installation by clicking **Install** in the modal

**Important**: The app must be installed before you can configure the URLs in the next step.

### Step 5: Configure App URLs

1. After installation, click the **Configuration** tab
2. Scroll to **App URL** section
3. Set the following URLs:

   **App URL**:
   ```
   https://simplelabels-prod.fly.dev
   ```

   **Allowed redirection URL(s)** (click "Add URL" for each):
   ```
   https://simplelabels-prod.fly.dev/api/auth
   https://simplelabels-prod.fly.dev/api/auth/callback
   https://simplelabels-prod.fly.dev/auth/callback
   ```

4. Click **Save** at the bottom of the page

### Step 6: Get API Credentials

1. Go back to the **API credentials** tab
2. You'll see:
   - **API key**: A string like `abc123def456...`
   - **API secret key**: Click **Reveal once** to see it

3. **Copy and save these credentials securely** (optional, for your records)
   - These are specific to this customer's store
   - You can always access them later from this page
   - The production app doesn't need these in environment variables (they're stored by Shopify)

### Step 7: Access the App

1. From the customer's Shopify admin, navigate to: **Apps**
2. You should see **Label Data Exporter** in the list
3. Click on it to open the app
4. The app should load and show the product export interface

**Expected behavior**:
- First access triggers OAuth flow (authentication)
- You'll see a permission consent screen
- After accepting, the app loads and shows the product list
- Customer can select products and export to Excel

### Step 8: Test Functionality

1. **Search for products**: Try searching in the search box
2. **Select products**: Check some product checkboxes
3. **Export**: Click "Export Selected to Excel"
4. **Verify download**: An Excel file should download with the selected products

Example filename: `label-export-2026-01-25.xlsx`

### Step 9: Verify Session Created

To confirm the customer's session was created correctly:

```bash
# Connect to production database
flyctl postgres connect --app simplelabels-prod-db

# Query sessions
SELECT shop, id, "isOnline", "accessToken" IS NOT NULL as has_token
FROM "Session"
WHERE shop = 'customer-store-name.myshopify.com';

# You should see at least one row for this customer
```

Expected output:
```
                    shop                    |         id          | isOnline | has_token
--------------------------------------------+---------------------+----------+-----------
 customer-store-name.myshopify.com          | online_abc123...    | t        | t
```

## Customer Handoff

Once the app is installed and tested, inform the customer:

1. **Access the app**:
   - Go to Shopify Admin → Apps
   - Click "Label Data Exporter"

2. **How to use**:
   - Search for products by name, SKU, barcode, or vendor
   - Select products using checkboxes
   - Click "Generate" button for variants without barcodes (optional)
   - Click "Export Selected to Excel"
   - Open the downloaded file in Excel or label printing software

3. **Support contact**: Provide your support email/contact

## Updating Existing Customers

If you have existing customers who were onboarded before the barcode generation feature was added, they'll need to update their app permissions from `read_products` to `write_products`.

### Update Process

1. Contact the customer and explain the new barcode generation feature
2. Have them log into their Shopify admin
3. Navigate to: **Settings** → **Apps and sales channels** → **Develop apps**
4. Click on their **Label Data Exporter** custom app
5. Click **Configuration** tab
6. Click **Configure Admin API scopes**
7. In the search box, type: `write_products`
8. **Uncheck** `read_products` (if checked)
9. **Check** ☑️ `write_products`
10. Click **Save**
11. They'll be prompted to **reinstall the app** - click **Install app**
12. Confirm by clicking **Install** in the modal

**Note**: The app will continue to work with `read_products` for export functionality, but barcode generation will only work after upgrading to `write_products`.

### Verification

After updating:
1. Customer opens the app
2. Finds a product variant without a barcode
3. Clicks the "Generate" button
4. An 8-digit barcode should be generated and appear immediately
5. The barcode should also be saved in Shopify admin

## Removing a Customer

If you need to remove a customer's access:

### Option 1: Customer Uninstalls (Recommended)

1. Customer goes to: **Settings** → **Apps and sales channels**
2. Click on **Label Data Exporter**
3. Click **Delete app**
4. Confirm deletion

**Note**: The app handles uninstall webhooks and automatically cleans up the session.

### Option 2: Manual Deletion (if needed)

```bash
# Connect to production database
flyctl postgres connect --app simplelabels-prod-db

# Delete customer's sessions
DELETE FROM "Session" WHERE shop = 'customer-store-name.myshopify.com';
```

## Troubleshooting

### App Won't Load / "Page Not Found"

**Cause**: App URLs not configured correctly

**Solution**:
1. Go to the custom app in Shopify admin
2. Click **Configuration** tab
3. Verify all URLs point to: `https://simplelabels-prod.fly.dev`
4. Ensure redirection URLs include `/api/auth`, `/api/auth/callback`, and `/auth/callback`

### "Permission Denied" Error

**Cause**: Missing `write_products` scope

**Solution**:
1. Go to custom app → **API credentials** → **Configure Admin API scopes**
2. Check ☑️ `write_products`
3. Click **Save**
4. **Uninstall and reinstall** the app to apply new permissions

### OAuth Loop / Keeps Redirecting

**Cause**: Session not being created or database connection issue

**Solution**:
1. Check production app is running: `flyctl status --app simplelabels-prod`
2. Check database connection: `flyctl postgres status --app simplelabels-prod-db`
3. View logs: `flyctl logs --app simplelabels-prod`
4. Verify session is created in database (see Step 9)

### Products Not Showing

**Cause**: Customer has no products, or search is too specific

**Solution**:
1. Verify the store has products published
2. Try clearing the search box to show all products
3. Check that products are not archived/draft

### Export Button Not Working

**Cause**: JavaScript error or no products selected

**Solution**:
1. Open browser console (F12) and check for errors
2. Ensure at least one product is selected (checkboxes)
3. Try refreshing the page and selecting again

## Security Notes

### Data Isolation

Each customer's data is isolated:
- Sessions are stored with `shop` field containing the store domain
- Access tokens are shop-specific
- One customer cannot access another customer's data
- The app checks the shop domain on every request

### Access Control

Custom app credentials are:
- Stored in the customer's Shopify admin (not in your production environment)
- Specific to that customer's store
- Can be regenerated by the customer at any time
- Revoked automatically if the customer deletes the app

### Best Practices

1. **Never share API credentials** across customer stores
2. **Each customer must have their own custom app** (don't reuse apps)
3. **Test in a test store first** before onboarding real customers
4. **Keep documentation updated** if the onboarding process changes

## Scaling Considerations

The production deployment is designed for multi-tenancy:

- **Database**: PostgreSQL with automatic connection pooling
- **Auto-scaling**: Machines start on demand, stop when idle
- **Memory**: 1GB should handle 100+ concurrent customers
- **Storage**: Database volume scales automatically

**When to upgrade**:
- If you have 50+ active customers, consider upgrading to 2GB memory
- Monitor database size and upgrade volume if needed
- Use `flyctl metrics` to track resource usage

## Cost Per Customer

Each additional customer adds **$0 in infrastructure costs** because:
- All customers share the same production deployment
- Database stores only lightweight session data
- Machines scale to zero when not in use

Current monthly cost: ~$10 regardless of customer count (within reasonable limits)

## Next Steps

After onboarding your first customer:

1. Monitor production logs for any errors
2. Ask customer for feedback on usability
3. Document any customer-specific configurations or requests
4. Set up a customer list/spreadsheet to track who's onboarded

## Customer List Template

Consider maintaining a spreadsheet with:

| Customer Name | Shop Domain | Install Date | Contact Email | Notes |
|--------------|-------------|--------------|---------------|-------|
| Wife's Store | example.myshopify.com | 2026-01-25 | email@example.com | First customer |

This helps track who's using the app and when they were onboarded.
