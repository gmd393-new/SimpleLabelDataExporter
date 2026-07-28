# Three-Tier Deployment Strategy

## Quick Reference

This document provides a high-level overview of the deployment architecture. For detailed instructions, see the linked documentation below.

**Note**: Actual deployment URLs are stored in `.claude/deployment-config.local.json` (gitignored). Copy `.claude/deployment-config.example.json` to get started.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ DEVELOPMENT (Local)                                     │
│ - Database: PostgreSQL (Docker)                         │
│ - Server: shopify app dev (localhost + tunnel)          │
│ - Purpose: Active development and testing               │
│ - Docs: DEVELOPMENT.md                                  │
└─────────────────────────────────────────────────────────┘
                        ↓ Deploy & Test
┌─────────────────────────────────────────────────────────┐
│ STAGING (fly.io)                                        │
│ - App: <staging-app>.fly.dev                  │
│ - Database: <staging-app>-db (PostgreSQL)     │
│ - Purpose: Pre-production testing, QA, demos            │
│ - Shopify App: Test app in Partners Dashboard          │
│ - Deploy: flyctl deploy                                 │
└─────────────────────────────────────────────────────────┘
                        ↓ After Testing
┌─────────────────────────────────────────────────────────┐
│ PRODUCTION (fly.io) — one deployment PER STORE          │
│ - Apps: one Fly app per store, same image on each       │
│         <store-a-app>  → <store-a>.myshopify.com        │
│         <store-b-app>  → <store-b>.myshopify.com        │
│ - Database: <production-db>, one logical DB per store   │
│ - Shopify Apps: one custom-distribution app per store   │
│ - Deploy: ./scripts/deploy-all.sh (all stores together) │
│ - Docs: DEPLOYMENT.md, CUSTOMER_ONBOARDING.md           │
└─────────────────────────────────────────────────────────┘
```

## Workflows

### Development Workflow

1. **Setup**: Copy `.env.example` to `.env`
2. **Develop**: Run `shopify app dev`
3. **Test**: Use your development store
4. **Commit**: Push changes to git

📖 See [DEVELOPMENT.md](./DEVELOPMENT.md) for details

### Staging Deployment

1. **Deploy**: `flyctl deploy` (uses fly.toml)
2. **Test**: Verify at https://<staging-app>.fly.dev
3. **Verify**: Test in your staging/test store

📖 See [DEPLOYMENT.md](./DEPLOYMENT.md) for details

### Production Deployment

**First Time Setup**:
1. Create fly.io app: `flyctl apps create <production-app>`
2. Create database: `flyctl postgres create --name <production-app>-db ...`
3. Attach database: `flyctl postgres attach <production-app>-db --app <production-app>`
4. Set secrets: `flyctl secrets set NODE_ENV=production --app <production-app>`
5. Deploy: `flyctl deploy --config .fly/production.toml --app <production-app>`

**Subsequent Deployments**:
```bash
flyctl deploy --config .fly/production.toml --app <production-app>
```

📖 See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions

### Adding Customers

**Process** (~20 minutes per store):
1. Create a Partners app; choose **custom distribution** and pin the store domain
2. Configure app URLs and `write_products` scope
3. Create a Fly app and attach the shared Postgres cluster
4. Set that store's secrets (including its own `SHOPIFY_APP_URL`)
5. Add the store to `scripts/deploy-all.sh` and deploy
6. Generate the install link, send it to the merchant, verify

📖 See [CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md) for step-by-step guide

## Key Decisions

### Why Three Tiers?

- **Development**: Fast iteration without affecting staging/production
- **Staging**: Test in production-like environment before releasing
- **Production**: Stable environment for paying customers

### Why Custom Distribution?

✅ **Advantages**:
- No Shopify app review required (weeks of calendar time avoided)
- Revocable per store
- No App Store listing, privacy policy, or GDPR compliance webhooks required

❌ **Trade-offs**:
- Manual onboarding per store
- **Installs on exactly one store** (unless the stores share a Plus organization)
- **Distribution method can never be changed** — reaching a new store always means a
  new Partners app

### Why One Deployment Per Store?

Not a preference — a consequence. `app/shopify.server.js` builds a single
`shopifyApp()` instance from one `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` pair, so one
deployment can serve one Partners app, and a custom-distribution Partners app serves one
store.

✅ **How costs stay flat**: all stores share the `<production-db>` Postgres cluster,
each with its own logical database (`flyctl postgres attach` creates one on the existing
cluster). Fly machines scale to zero when idle. Separate logical databases also keep each
store's migrations independent, so one store's deploy cannot apply schema changes beneath
another store's running code.

❌ **The cost**: every release must deploy every store, or they drift.
`scripts/deploy-all.sh` exists to prevent that and fails loudly if stores end up on
different versions.

⚠️ **Ceiling**: this stops being reasonable at roughly **five stores**. Past that, route
multiple Partners apps through one deployment via a hostname → `shopifyApp()` instance
map. See `docs/superpowers/specs/2026-07-28-second-store-deployment-design.md`.

## File Reference

### Configuration Files

| File | Purpose | Environment |
|------|---------|-------------|
| `.env.example` | Environment template | Development |
| `.fly/staging.toml` | Staging config | Staging |
| `.fly/production.toml` | Production config — `<store-a>` | Production |
| `.fly/production-<store-b-slug>.toml` | Production config — `<store-b>` | Production |
| `scripts/deploy-all.sh` | Deploys every production store together | Production |
| `prisma/schema.prisma` | Database schema | All |
| `shopify.app.toml` | Shopify CLI config — **staging app only** | Development |

**Note**: the production Partners apps are configured entirely in the Partner Dashboard
and have no `shopify.app.*.toml` in this repository. `shopify.app.toml` tracks the
staging app (`Simple Exporter for Labels`), not either production app.

### Documentation Files

| File | Purpose |
|------|---------|
| `DEVELOPMENT.md` | Local development setup |
| `DEPLOYMENT.md` | Staging and production deployment |
| `CUSTOMER_ONBOARDING.md` | Adding new customers |
| `DEPLOYMENT_STRATEGY.md` | This file - architecture overview |
| `CLAUDE.md` | App-specific guidance for Claude Code |

## Environment Variables

### Development
```bash
# Database credentials stored in .env.docker (gitignored)
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/<db>"
NODE_ENV=development
# SHOPIFY_* vars set by shopify CLI
```

### Staging
```bash
DATABASE_URL="postgres://..."  # Auto-set by fly.io
SHOPIFY_API_KEY="..."          # Set via flyctl secrets
SHOPIFY_API_SECRET="..."       # Set via flyctl secrets
```

### Production (set per store, on each store's Fly app)
```bash
DATABASE_URL="postgres://..."                          # Auto-set by postgres attach
NODE_ENV=production                                    # Set via flyctl secrets
SCOPES="write_products"                                # Must match dashboard scopes
SHOPIFY_APP_URL="https://<store-app>.fly.dev"  # PER STORE — do not copy
SHOPIFY_API_KEY="..."                                  # That store's Partners app
SHOPIFY_API_SECRET="..."                               # That store's Partners app
```

All of these are required — `app/shopify.server.js:11-15` reads four of them.
`SHOPIFY_APP_URL` differs per store; copying it between deployments causes OAuth
redirect loops.

## Database Strategy

**Development**:
- PostgreSQL via Docker for consistency with staging/production
- Database: `labelexporter_dev` running on port 5432
- Migrations created via: `npx prisma migrate dev`

**Staging/Production**:
- PostgreSQL for scalability and features
- Managed by fly.io
- Migrations applied automatically on deploy via `npm run docker-start`

**Migration Compatibility**:
- All environments use PostgreSQL
- Same migration files work across development, staging, and production
- Catches PostgreSQL-specific issues during local development

## Store Isolation

Each customer's data is isolated at four levels:

1. **Process Isolation**: each store has its own deployment, authenticating only that
   store's Partners app
2. **Database Isolation**: each deployment has its own logical database on the shared
   cluster
3. **Session Isolation**: sessions stored with `shop` field (e.g., `<store-a>.myshopify.com`)
4. **Token Isolation**: access tokens are per-store and never leave that store's
   deployment

**Verification**:
```bash
flyctl postgres connect --app <production-db>

\l                              -- one database per store
\c <store-database>
SELECT shop, id, "isOnline" FROM "Session";
```

Because databases are per-store, there is no single query listing every store. The
inventory lives in the **Current stores** table in
[CUSTOMER_ONBOARDING.md](./customer-onboarding.md) and in `DEPLOYMENTS` in
`scripts/deploy-all.sh`.

## Monitoring

### Check App Status
```bash
# Staging
flyctl status --app <staging-app>

# Production
flyctl status --app <production-app>
```

### View Logs
```bash
# Real-time logs
flyctl logs --app <production-app>

# Last hour
flyctl logs --app <production-app> --time 1h
```

### Database Health
```bash
# Check database status
flyctl postgres status --app <production-app>-db

# Connect to database
flyctl postgres connect --app <production-app>-db
```

## Cost Breakdown

| Component | Cost (per month) |
|-----------|------------------|
| Staging app | ~$5 |
| Staging database | ~$5 |
| Production database cluster (shared by all stores) | ~$5 |
| Production app — `<store-a-app>` | ~$5 |
| Production app — `<store-b-app>` | ~$5 |
| **Total** | **~$25** |

**Note**: adding a store adds one Fly app, not a database cluster —
`flyctl postgres attach` creates a logical database on the existing cluster. The listed
app costs are ceilings; machines scale to zero when idle
(`min_machines_running = 0`), so lightly-used stores cost considerably less.

## Rollback Procedure

If production deployment causes issues:

```bash
# 1. List releases
flyctl releases --app <production-app>

# 2. Rollback to previous version
flyctl releases rollback <version-number> --app <production-app>

# 3. Verify rollback
flyctl status --app <production-app>
flyctl logs --app <production-app>
```

## Next Steps

### Initial Setup (One-Time)

- [ ] Set up production environment (DEPLOYMENT.md - "Setting Up Production")
- [ ] Deploy to production
- [ ] Onboard first customer (CUSTOMER_ONBOARDING.md)
- [ ] Verify multi-tenant isolation works

### Ongoing Operations

- **Daily**: Check logs for errors
- **Weekly**: Review customer sessions, verify all working
- **Monthly**: Review costs and resource usage
- **Before features**: Deploy to staging → test → deploy to production

## Troubleshooting Quick Links

| Issue | See |
|-------|-----|
| Local dev not working | [DEVELOPMENT.md](./DEVELOPMENT.md#troubleshooting) |
| Deployment failing | [DEPLOYMENT.md](./DEPLOYMENT.md#troubleshooting) |
| Customer app not loading | [CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md#troubleshooting) |
| Database connection errors | [DEPLOYMENT.md](./DEPLOYMENT.md#database-connection-issues) |
| Migration errors | [DEPLOYMENT.md](./DEPLOYMENT.md#migration-errors) |

## Support

For questions or issues:

1. Check the relevant documentation file
2. Review fly.io logs: `flyctl logs --app <app-name>`
3. Check database status: `flyctl postgres status --app <db-name>`
4. Review Shopify app logs in Partners Dashboard (for staging)

---

**Last Updated**: 2026-01-25
**Architecture Version**: 1.0
