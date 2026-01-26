# Three-Tier Deployment Strategy

## Quick Reference

This document provides a high-level overview of the deployment architecture. For detailed instructions, see the linked documentation below.

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
│ - App: simplelabeldataexporter.fly.dev                  │
│ - Database: simplelabeldataexporter-db (PostgreSQL)     │
│ - Purpose: Pre-production testing, QA, demos            │
│ - Shopify App: Test app in Partners Dashboard          │
│ - Deploy: flyctl deploy                                 │
└─────────────────────────────────────────────────────────┘
                        ↓ After Testing
┌─────────────────────────────────────────────────────────┐
│ PRODUCTION (fly.io)                                     │
│ - App: simplelabels-prod.fly.dev                        │
│ - Database: simplelabels-prod-db (PostgreSQL)           │
│ - Purpose: Serves all customer stores (multi-tenant)    │
│ - Shopify Apps: Custom app per customer                │
│ - Deploy: flyctl deploy --config fly.production.toml    │
│ - Docs: DEPLOYMENT.md, CUSTOMER_ONBOARDING.md          │
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
2. **Test**: Verify at https://simplelabeldataexporter.fly.dev
3. **Verify**: Test in your staging/test store

📖 See [DEPLOYMENT.md](./DEPLOYMENT.md) for details

### Production Deployment

**First Time Setup**:
1. Create fly.io app: `flyctl apps create simplelabels-prod`
2. Create database: `flyctl postgres create --name simplelabels-prod-db ...`
3. Attach database: `flyctl postgres attach simplelabels-prod-db --app simplelabels-prod`
4. Set secrets: `flyctl secrets set NODE_ENV=production --app simplelabels-prod`
5. Deploy: `flyctl deploy --config fly.production.toml --app simplelabels-prod`

**Subsequent Deployments**:
```bash
flyctl deploy --config fly.production.toml --app simplelabels-prod
```

📖 See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions

### Adding Customers

**Process** (5-10 minutes per customer):
1. Create custom app in customer's Shopify admin
2. Configure API scopes: `read_products`
3. Install app in customer's store
4. Set app URLs to point to production
5. Test functionality
6. Verify session created in database

📖 See [CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md) for step-by-step guide

## Key Decisions

### Why Three Tiers?

- **Development**: Fast iteration without affecting staging/production
- **Staging**: Test in production-like environment before releasing
- **Production**: Stable environment for paying customers

### Why Custom Apps?

✅ **Advantages**:
- No Shopify app review required (faster onboarding)
- Better access control (can revoke per customer)
- Simpler setup (5-10 minutes vs weeks for app review)
- No ongoing Shopify Partner requirements

❌ **Trade-offs**:
- Manual onboarding per customer
- Not listed in Shopify App Store

### Why Single Production Deployment?

✅ **Advantages**:
- Lower cost (~$10/month total vs $10/month per customer)
- Easier to maintain and update
- Centralized monitoring and logs

✅ **How it works**:
- App already supports multi-tenancy via `Session.shop` field
- Each customer session is isolated by shop domain
- Access tokens are shop-specific

## File Reference

### Configuration Files

| File | Purpose | Environment |
|------|---------|-------------|
| `.env.example` | Environment template | Development |
| `fly.toml` | Staging config | Staging |
| `fly.production.toml` | Production config | Production |
| `prisma/schema.prisma` | Database schema | All |
| `shopify.app.toml` | Shopify CLI config | Development |

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
DATABASE_URL="postgresql://labelexporter:devpassword@localhost:5432/labelexporter_dev"
NODE_ENV=development
# SHOPIFY_* vars set by shopify CLI
```

### Staging
```bash
DATABASE_URL="postgres://..."  # Auto-set by fly.io
SHOPIFY_API_KEY="..."          # Set via flyctl secrets
SHOPIFY_API_SECRET="..."       # Set via flyctl secrets
```

### Production
```bash
DATABASE_URL="postgres://..."  # Auto-set by fly.io
NODE_ENV=production            # Set via flyctl secrets
# No SHOPIFY_* vars needed (uses custom apps)
```

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

## Multi-Tenant Security

Each customer's data is isolated:

1. **Session Isolation**: Sessions stored with `shop` field (e.g., `customer.myshopify.com`)
2. **Token Isolation**: Access tokens are shop-specific
3. **Query Isolation**: App verifies shop domain on every request
4. **App Isolation**: Each customer has their own custom app credentials

**Verification**:
```sql
-- View all customer sessions
SELECT shop, id, "isOnline" FROM "Session";

-- Each row = one customer store
```

## Monitoring

### Check App Status
```bash
# Staging
flyctl status --app simplelabeldataexporter

# Production
flyctl status --app simplelabels-prod
```

### View Logs
```bash
# Real-time logs
flyctl logs --app simplelabels-prod

# Last hour
flyctl logs --app simplelabels-prod --time 1h
```

### Database Health
```bash
# Check database status
flyctl postgres status --app simplelabels-prod-db

# Connect to database
flyctl postgres connect --app simplelabels-prod-db
```

## Cost Breakdown

| Component | Cost (per month) |
|-----------|------------------|
| Staging app | ~$5 |
| Staging database | ~$5 |
| Production app | ~$5 |
| Production database | ~$5 |
| **Total** | **~$20** |

**Note**: Costs are per environment, NOT per customer. Adding customers is free.

## Rollback Procedure

If production deployment causes issues:

```bash
# 1. List releases
flyctl releases --app simplelabels-prod

# 2. Rollback to previous version
flyctl releases rollback <version-number> --app simplelabels-prod

# 3. Verify rollback
flyctl status --app simplelabels-prod
flyctl logs --app simplelabels-prod
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
