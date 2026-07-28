# Customer Onboarding Guide

Step-by-step instructions for adding a new customer store to the Label Data Exporter.

**Note**: Real store domains, app names, and URLs live in
`.claude/deployment-config.local.json` (gitignored). This guide uses placeholders
throughout — see [SECURITY.md](./security.md) for why. Substitute:

| Placeholder | Meaning |
|---|---|
| `<store-slug>` | short identifier for the store, dashes removed |
| `<store>.myshopify.com` | the store's Shopify domain |
| `<store-app>` | that store's Fly app name |
| `<production-db>` | the shared production Postgres cluster |

## Architecture: one Partners app AND one deployment per store

Read this before following the steps — it explains why onboarding looks the way it does.

This app uses **custom distribution**. A custom-distribution Shopify app installs on
**exactly one store**, with a single exception: multiple stores inside one Shopify
**Plus** organization. And critically:

> **An app's distribution method can never be changed after it is selected.**

So each customer store needs its own Partners app, with its own client ID and secret.
Because `app/shopify.server.js` builds a single `shopifyApp()` instance from
`SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`, one running deployment can serve exactly one
Partners app — and therefore one store.

Each store therefore gets:

- its own **Partners app** (custom distribution, pinned to that store's domain)
- its own **Fly deployment** running the identical image
- its own **logical database** on the shared `<production-db>` Postgres cluster

Sharing one Postgres cluster keeps the cost flat; separate logical databases keep each
store's migrations independent, so one store's deploy can't apply schema changes under
another store's running code.

### This does not scale forever

Onboarding is ~20 minutes of mostly-dashboard work per store, and every release must
deploy every store. That is fine for a handful. At roughly **five stores**, switch to
routing multiple Partners apps through a single deployment (hostname →
`shopifyApp()` instance map). See
`docs/superpowers/specs/2026-07-28-second-store-deployment-design.md` for why that was
deferred rather than built.

### What this is NOT

Older versions of this guide described creating a custom app from inside the merchant's
own Shopify admin ("Settings → Apps → Develop apps"). **That does not work with this
codebase.** Admin-created custom apps issue a static Admin API access token and never
perform the embedded OAuth handshake this app implements. Shopify has also stopped
allowing new custom apps to be created that way. Ignore any instructions of that shape.

## Store inventory

The authoritative list of live stores is **not in this repository**. It lives in:

- `.claude/deployment-config.local.json` (gitignored) — domains, app names, databases
- `.fly/production*.toml` — one config file per store deployment
- The Shopify Partner Dashboard — one custom-distribution app per store

Keep all three in sync when onboarding or removing a store.

## Naming convention

For a store slug `<store-slug>` (the `.myshopify.com` subdomain, dashes removed):

| Thing | Pattern |
|---|---|
| Fly app | `<production-app-prefix>-<store-slug>` |
| Fly config | `.fly/production-<store-slug>.toml` |
| App URL | `https://<store-app>.fly.dev` |
| Postgres DB | assigned by `postgres attach` |

## Prerequisites

- Shopify Partner Dashboard access
- The customer's `.myshopify.com` domain, **confirmed in writing** (see Step 2)
- `flyctl` installed and authenticated (`flyctl auth login`)

---

## Step 1 — Create the Partners app

Partner Dashboard → **Apps** → **Create app**.

Name it so the merchant recognises it in their admin, e.g.
`Label Data Exporter — <Store Name>`.

## Step 2 — Choose distribution ⚠️ irreversible

App → **Distribution** → **Choose distribution** → **Custom distribution** → enter the
store's `.myshopify.com` domain.

**Verify the domain character by character before confirming.** Neither the distribution
method nor the pinned store can be changed afterwards. A typo means abandoning the app
and creating another one.

Do **not** click *Generate link* yet — that is Step 9, after the deployment is live.

## Step 3 — Configure URLs and scopes

App → **Configuration**:

| Field | Value | Why it matters |
|---|---|---|
| **Scopes** | `write_products` | **Most important.** Drives Shopify managed installation — if empty, the install grants nothing and the app fails to authenticate afterwards. |
| **Use legacy install flow** | leave **unchecked** | Unchecked selects managed install + token exchange, which is what this codebase implements. |
| **App URL** | `https://<store-app>.fly.dev` | Must exactly match the `SHOPIFY_APP_URL` secret from Step 6. |
| **Embed app in Shopify admin** | checked | The app renders embedded. |
| **Redirect URLs** | leave empty | Unused unless legacy install flow is enabled. See below. |

### Why there are no redirect URLs

`@shopify/shopify-app-react-router` (v1.x) authenticates embedded apps with **token
exchange** backed by **Shopify managed installation**, not the legacy authorization-code
grant. Per Shopify's documentation this strategy "eliminates the redirects that were
previously necessary." The install link triggers a managed install, the app loads
embedded, and it exchanges the session token for an access token directly — no
`/auth/callback` round trip ever occurs.

So an empty **Redirect URLs** field is correct, not an oversight. The app still serves
`/auth` and `/auth/login` routes, but they are not part of the install path.

If you ever tick **Use legacy install flow**, redirect URLs become mandatory:
`https://<store-app>.fly.dev/api/auth` and `https://<store-app>.fly.dev/auth/callback`.

### Scopes

`write_products` covers both reading product data for export and writing generated
barcodes back to variants. It must match the `SCOPES` secret set in Step 6 — a mismatch
causes a re-authorization loop rather than a clear error.

### Credentials

Copy the **client ID** and **API secret key** from the API credentials page; you need
them in Step 6.

**Note**: the app name field caps at 30 characters and truncates silently. Since each
store only ever sees its own app, a store suffix is unnecessary — a plain product name
avoids the truncation entirely.

## Step 4 — Create the Fly app

```bash
flyctl apps create <store-app>
```

## Step 5 — Attach the database

```bash
flyctl postgres attach <production-db> --app <store-app>
```

This creates a **new logical database and user on the existing cluster** and sets
`DATABASE_URL` automatically. It does not create a new cluster, so it adds no cost.

## Step 6 — Set secrets

Copy the template, fill in the two credentials from Step 3, and apply it:

```bash
cp .env-store.example .env-<store-slug>
# edit .env-<store-slug>, then:
bash scripts/set-store-secrets.sh .env-<store-slug>
```

Use the script rather than typing `flyctl secrets set` by hand. It keeps the API secret
out of your shell history and terminal scrollback, applies everything in one call so the
app restarts once, and refuses to run if the env file is not gitignored or has somehow
become tracked. Add `--dry-run` to see what it would set without changing anything.

`.gitignore` covers `.env-*`. Verify before filling one in:

```bash
git check-ignore .env-<store-slug>    # must print the filename
```

All five secrets are required — `app/shopify.server.js` reads `SHOPIFY_API_KEY`,
`SHOPIFY_API_SECRET`, `SCOPES`, and `SHOPIFY_APP_URL`, and `DATABASE_URL` comes from
Step 5.

**`SHOPIFY_APP_URL` is the one that bites.** If it is missing, or copied from another
store's deployment, OAuth redirects land on the wrong deployment and present as a
redirect loop — not as an obviously wrong URL. The script rejects a missing `https://`
scheme and a trailing slash for the same reason.

## Step 7 — Add the deployment to the repo

1. Copy `.fly/production.toml` to `.fly/production-<store-slug>.toml`, changing only the
   `app = ` line.
2. Add the store to `.claude/deployment-config.local.json`.

`scripts/deploy-all.sh` discovers stores by globbing `.fly/production*.toml`, so adding
the config file is all that is needed to include the store in future releases. A store
without a config file silently stops receiving updates.

## Step 8 — Deploy

```bash
./scripts/deploy-all.sh
```

Then confirm it answers:

```bash
curl https://<store-app>.fly.dev/healthz    # expect HTTP 200
```

## Step 9 — Generate the install link and send it

Partner Dashboard → app → **Distribution** → **Generate link** → copy.

Send it to the store owner. They open it, review the requested `write_products`
permission, and click **Install**.

The deployment must already be answering before this step. Installing against a
hostname that isn't up fails in a way that is hard to diagnose from the merchant's side.

## Step 10 — Verify

1. Open the app from the store's **Apps** menu; it should load embedded in the admin.
2. Search for a product.
3. Select products and click **Export Selected to Excel**; confirm the `.xlsx`
   downloads and contains the expected rows.
4. Confirm the session landed in the right database:
   ```bash
   flyctl postgres connect --app <production-db>
   \c <store database>
   SELECT shop, id, "isOnline", "accessToken" IS NOT NULL AS has_token FROM "Session";
   ```
   Expect at least one row, with `shop` matching the store domain.
5. Confirm the **other** stores still load and export — `deploy-all.sh` deployed them
   too.

---

## Customer handoff

1. **Access**: Shopify Admin → **Apps** → the app's name.
2. **Usage**: search by name, SKU, barcode, or vendor; select products; optionally click
   **Generate** for variants missing barcodes; click **Export Selected to Excel**; open
   the file in Excel or label-printing software.
3. **Support**: provide your contact address.

## Changing scopes for an existing store

Scopes live in two places that must agree:

1. Partner Dashboard → app → **Configuration** → **Access scopes**
2. The `SCOPES` Fly secret on that store's deployment

Update both, redeploy that store, then have the merchant reopen the app. Shopify prompts
them to approve the new permissions. The `app/scopes_update` webhook
(`shopify.app.toml:18-20`) keeps the stored session scope in sync.

## Removing a store

**Merchant-initiated (preferred)**: the merchant uninstalls from Shopify Admin →
**Settings** → **Apps and sales channels** → **Uninstall**. The `app/uninstalled`
webhook cleans up the session automatically.

**Full decommission**, once the merchant has uninstalled:

```bash
flyctl apps destroy <store-app>
```

Then delete `.fly/production-<store-slug>.toml` and remove the store from
`.claude/deployment-config.local.json`. Leave the Partners app in place — deleting it
frees nothing, and its pinned domain cannot be reused anyway.

## Troubleshooting

### App fails to authenticate after a successful install

Check **Scopes** on the Partners app first. Managed installation grants exactly what is
declared there; if it is empty, the merchant installs successfully and then the app
cannot authenticate. Confirm it matches the `SCOPES` secret:

```bash
flyctl ssh console --app <store-app> -C "printenv SCOPES"
```

### Redirect loop during install

Almost always `SHOPIFY_APP_URL`. Confirm it exactly matches the App URL in the Partner
Dashboard, including scheme and no trailing slash:

```bash
flyctl secrets list --app <store-app>
```

If **Use legacy install flow** is enabled, also confirm the redirect URLs are populated.
With managed install (the default) that field is unused and should be empty.

### "Page not found" when opening the app

App URL in the dashboard points at the wrong deployment, or that Fly app is down:

```bash
flyctl status --app <store-app>
flyctl logs --app <store-app>
```

### Repeated permission prompts

`SCOPES` secret and dashboard access scopes disagree. Make them match, redeploy.

### Barcode "Generate" button fails

The store is authorized for `read_products` rather than `write_products`. Follow
*Changing scopes for an existing store*.

### Products not showing

Confirm the store actually has products, clear the search box, and check the
Active/Draft status filter.

### One store works, another is broken after a release

They are on different versions — a `deploy-all.sh` run partially failed, or a store is
missing a `.fly/production*.toml` config. Check:

```bash
./scripts/deploy-all.sh --check
flyctl releases --app <store-app>
```

## Security notes

- Sessions are keyed by `shop` (`prisma/schema.prisma`), and each deployment serves a
  single store, so stores are isolated both by row and by process.
- Access tokens are per-store and never leave that store's deployment.
- Client secrets live only in Fly secrets and the Partner Dashboard — never in the repo.
- Store domains and deployment URLs stay out of this repository; see
  [SECURITY.md](./security.md).
- A merchant uninstalling revokes their token immediately; the `app/uninstalled` webhook
  removes the session.

## Cost

Adding a store adds one Fly app. Machines scale to zero when idle
(`min_machines_running = 0`), so the marginal cost is small — the Postgres cluster and
its volume are already paid for and are not duplicated.
