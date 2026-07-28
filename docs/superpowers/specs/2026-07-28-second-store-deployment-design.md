# Second Store Deployment — Design

**Date**: 2026-07-28
**Status**: Approved, not yet implemented
**Target store**: `<store-b>.myshopify.com`

## Problem

The customer owns a second Shopify store, `<store-b>.myshopify.com`, and wants
the Label Data Exporter installed there. The Partners app currently serving them uses
**custom distribution**, which installs on exactly one store.

### Existing Partners app inventory

There are two Partners apps, and **the repository only tracks the staging one**:

| Partners app | client_id | Application URL | Store |
|---|---|---|---|
| Simple Exporter for Labels | `<staging-client-id>` (`shopify.app.toml:3`) | `<staging-app>.fly.dev` (staging) | dev store `<dev-store>.myshopify.com` |
| Label Data Exporter | `<store-a-client-id>` — **not tracked in the repo** | `<store-a-app>.fly.dev` (production) | `<store-a>` |

The production app has no `shopify.app.*.toml` in the repository; it is managed
entirely through the Partner Dashboard. Adding one is out of scope here, but it is
a gap worth closing separately — the production app's configuration currently exists
in exactly one place, with no version history.

Two facts constrain every possible solution:

1. A custom-distribution app installs on a single store. The only exception is
   multiple stores within one Shopify **Plus** organization. These two stores are
   not on Plus, so the exception does not apply.
2. **An app's distribution method can never be changed after selection.** The
   existing app cannot be converted to public distribution.

Therefore a new Partners app is unavoidable.

## Decision

Create a second custom-distribution Partners app pinned to `<store-b>.myshopify.com`,
served by a second Fly deployment running the identical image, sharing the existing
Postgres cluster via a separate logical database.

### Options considered

| Option | Summary | Verdict |
|---|---|---|
| **1. Second Partners app + second Fly deployment** | New app, new Fly app, same image, same PG cluster | **Chosen** |
| 2. One deployment serving multiple Partners apps | Hostname → `shopifyApp()` instance map, routed per request | Rejected — needs an owned domain (Fly issues one `*.fly.dev` per app), touches every route importing `authenticate`, real OAuth regression risk. Disproportionate for two stores. |
| 3. Public distribution | New public app, one `client_id` for unlimited stores | Rejected — mandatory App Store review (unlisted/unpublished apps [deprecated 2024](https://shopify.dev/changelog/update-on-deprecation-of-unpublished-apps)); would also require the three GDPR compliance webhooks currently absent from `shopify.app.toml`. Weeks of calendar time for a two-store need. |

Option 1 was chosen because the expected scale is exactly two stores. It requires no
application code changes and is fully reversible. Its known ceiling is roughly five
stores, past which Option 2 becomes the right answer — and by then the routing
requirements will be far better understood.

## Architecture

Store A and store B share a codebase and a Postgres cluster. Nothing else.

```
┌─────────────────────────────┐   ┌─────────────────────────────────┐
│ Fly: <store-a-app>          │   │ Fly: <store-b-app>        (new) │
│ Partners app A              │   │ Partners app B            (new) │
│ → <store-a>.myshopify.com   │   │ → <store-b>.myshopify.com       │
└──────────────┬──────────────┘   └────────────────┬────────────────┘
               │                                   │
               │   same image, deployed together   │
               │      via scripts/deploy-all.sh    │
               ▼                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Postgres cluster: <production-db>              (already exists) │
│   ├── <store-a-database>                                        │
│   └── <store-b-database>                                  (new) │
└─────────────────────────────────────────────────────────────────┘
```

Concrete names for every placeholder above are in
`.claude/deployment-config.local.json` (gitignored). This repository is public; see
[SECURITY.md](../../security.md).

### Naming

| Thing | Value |
|---|---|
| Store A domain (existing) | `<store-a>.myshopify.com` |
| Store B domain (new) | `<store-b>.myshopify.com` |
| Partners app B name | `Label Data Exporter — <Store B Name>` |
| Fly app | `<store-b-app>` |
| Fly config | `.fly/production-<store-b-slug>.toml` |
| Shopify CLI config | `shopify.app.<store-b-slug>.toml` |
| Application URL | `https://<store-b-app>.fly.dev` |
| Postgres logical DB | `<store-b-database>` |

### Why a separate logical database on the same cluster

`flyctl postgres attach <production-db> --app <store-b-app>`
creates a new database and user on the **existing** cluster and sets `DATABASE_URL`.

- **No extra cost.** Billing follows the cluster and its volume, not logical databases.
- **No migration-ordering hazard.** Migrations run at boot via the `setup` script
  (`package.json`: `prisma generate && prisma migrate deploy`). If both apps shared one
  database, whichever machine booted first would migrate schema the other app's running
  code might not expect. Separate databases decouple them.
- **One cluster** to back up, monitor, and keep alive.

Accepted trade-off: enumerating all stores using the app becomes two queries instead of
one. Acceptable for two stores under one owner.

## Required secrets on the new Fly app

`.fly/production.toml` sets only `PORT` and `HOST` in `[env]`; everything else is a Fly
secret. `app/shopify.server.js` reads four of them:

| Secret | Value | Source |
|---|---|---|
| `SHOPIFY_API_KEY` | Partners app B client ID | Dashboard |
| `SHOPIFY_API_SECRET` | Partners app B secret | Dashboard |
| `SHOPIFY_APP_URL` | `https://<store-b-app>.fly.dev` | This deployment |
| `SCOPES` | `write_products` | Matches `shopify.app.toml:24` |
| `NODE_ENV` | `production` | — |
| `DATABASE_URL` | — | Set automatically by `postgres attach` |

`SHOPIFY_APP_URL` is the highest-risk value. If it is missing or copied from store A,
OAuth redirects land on the wrong deployment and present as a redirect loop rather than
a clear error.

## Work breakdown

### Phase 0 — Cheap escape hatch — ✅ CHECKED, NOT AVAILABLE

Checked 2026-07-28 on the "Label Data Exporter" Distribution page. The
**"Allow multi-store install for one Plus organization"** checkbox is ticked but
disabled, and its help text reads: *"This app can be installed on stores that belong to
the same Plus organization as the store provided."* The pinned store is
`<store-a>`; `<store-b>` is not in a Plus organization with it, so the
existing install link cannot reach it.

The remaining phases are required.

### Phase 1 — `AppDistribution` correction — ⏭️ SKIPPED (decided 2026-07-28)

`app/shopify.server.js:18` sets `distribution: AppDistribution.AppStore`, but these are
custom-distribution apps managed in the Partner Dashboard, which per Shopify's
`shopifyApp` reference should be `AppDistribution.SingleMerchant`.

**Deliberately not changed.** The reasoning:

- It fixes a latent inconsistency, not a current outage. Store A authenticates and
  exports correctly today with `AppStore`.
- It is shared code, so it would alter the live authentication behaviour of a working
  production store.
- Staging could only validate it if the staging Partners app is *also* on custom
  distribution, which was not confirmed. Testing it there might have proven nothing
  while implying it had.
- Store B is unaffected either way — it inherits whatever store A already does
  successfully.

Revisit only if an auth-flow bug appears that this would plausibly explain. The fix is
one line; the risk is entirely in deploying it to a working store for no present
benefit.

### Phase 2 — Partners app B (dashboard, user-executed)

1. Create a new app in the Partner Dashboard.
2. Distribution → Choose distribution → **Custom distribution**.
3. Enter `<store-b>.myshopify.com`. **This selection is permanent.**
4. Set the application URL and redirect URLs to the new Fly hostname.
5. Record the client ID and secret for Phase 3.
6. **Do not generate the install link yet.** That happens in Phase 6, after the
   deployment exists and responds — installing against a dead hostname fails
   confusingly.

### Phase 3 — Fly infrastructure

```bash
flyctl apps create <store-b-app>
flyctl postgres attach <production-db> --app <store-b-app>
flyctl secrets set NODE_ENV=production SCOPES=write_products \
  SHOPIFY_APP_URL=https://<store-b-app>.fly.dev \
  SHOPIFY_API_KEY=<from Phase 2> SHOPIFY_API_SECRET=<from Phase 2> \
  --app <store-b-app>
flyctl deploy --config .fly/production-<store-b-slug>.toml --app <store-b-app>
```

### Phase 4 — Repository changes

**New files**

- `.fly/production-<store-b-slug>.toml` — copy of `.fly/production.toml` with the app name
  changed. All other settings identical, including `dockerfile = "../.docker/Dockerfile"`.
- `shopify.app.<store-b-slug>.toml` — generated by `shopify app config link`, which also
  switches the active config in `.shopify/project.json`. Switch back afterwards with
  `shopify app config use shopify.app.toml`.
- `scripts/deploy-all.sh` — deploys both production apps in sequence, aborting if either
  fails. Bash, matching `scripts/verify-security.sh`. Preventing deployment drift is the
  core operational risk of this design, so releasing through one command is a
  requirement, not a convenience.

**No application code changes.** Multi-tenancy already works: `Session` and
`DownloadToken` are both keyed by `shop` (`prisma/schema.prisma`), and each deployment
serves exactly one store.

**Configuration**

- `.claude/deployment-config.local.json` — add the new app entry (gitignored).
- `.claude/deployment-config.example.json` — mirror the new shape.

### Phase 5 — Documentation corrections

Three documents describe an architecture that cannot work against this codebase. They
describe merchant-admin custom apps, which issue a static Admin API access token and
never perform the embedded OAuth handshake `app/shopify.server.js` implements. Following
them for store B would waste an afternoon before failing.

- `docs/customer-onboarding.md` — full rewrite to the Partners custom-distribution flow
  (create app → choose distribution → pin domain → deploy → generate install link).
- `docs/deployment.md:117` and its "Production Secrets" section — remove the claim that
  production does not need `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`. It does; see
  `app/shopify.server.js:11-12`.
- `docs/deployment-strategy.md` — correct the architecture diagram, the "Why Custom
  Apps?" section, and the cost table, which currently claims one production deployment
  serves unlimited stores.

### Phase 6 — Verification

1. `curl https://<store-b-app>.fly.dev/healthz` returns 200.
2. Generate the install link (deferred from Phase 2) and install to
   `<store-b>.myshopify.com`.
3. App loads embedded in the store B admin.
4. Run a real product export; confirm the `.xlsx` downloads and contains data.
5. Confirm a `Session` row exists for `<store-b>.myshopify.com` in
   `<store-b-database>`.
6. Confirm store A still loads and exports — regression check for Phase 1.

## Rollback

| Phase | Rollback |
|---|---|
| 1 | Revert the one-line change, redeploy prod A. |
| 3 | `flyctl apps destroy <store-b-app>`. Store A untouched. |
| 4–5 | Ordinary git revert. No effect on running deployments until redeployed. |

Store A's deployment is never modified except by Phase 1, which is deployed and verified
in isolation before any store B work begins.

## Out of scope

- Public distribution and App Store review.
- The GDPR compliance webhooks (`customers/data_request`, `customers/redact`,
  `shop/redact`) absent from `shopify.app.toml`. Not required for custom distribution;
  they become mandatory only if public distribution is ever pursued.
- Migrating to Option 2 (single deployment, multiple Partners apps). Revisit at roughly
  five stores.
