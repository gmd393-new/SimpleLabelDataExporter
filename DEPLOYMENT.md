# Deployment Guide

This guide covers deploying the Label Data Exporter to staging and production environments on fly.io.

## Architecture Overview

```
Development (Local)
├── Database: PostgreSQL (Docker)
├── Server: shopify app dev (local + tunnel)
└── Purpose: Active development and testing

Staging (fly.io)
├── App: simplelabeldataexporter.fly.dev
├── Database: simplelabeldataexporter-db (PostgreSQL)
├── Shopify App: LabelDataExporter (test app in Partners)
└── Purpose: Pre-production testing, QA, demos

Production (fly.io)
├── App: simplelabels-prod.fly.dev
├── Database: simplelabels-prod-db (PostgreSQL)
├── Shopify Apps: Custom app per customer store
└── Purpose: Serves all customer stores (multi-tenant)
```

## Prerequisites

1. **Install fly.io CLI**:
   ```bash
   # Windows (PowerShell)
   iwr https://fly.io/install.ps1 -useb | iex

   # macOS/Linux
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login to fly.io**:
   ```bash
   flyctl auth login
   ```

3. **Verify access** to the fly.io organization where apps are deployed

## Deploying to Staging

Staging uses the existing `simplelabeldataexporter` app.

### Deploy Process

```bash
# From the label-data-exporter directory

# Deploy to staging (uses fly.toml by default)
flyctl deploy

# Or explicitly specify the config file
flyctl deploy --config fly.toml --app simplelabeldataexporter
```

### Check Deployment Status

```bash
# View app status
flyctl status --app simplelabeldataexporter

# View logs
flyctl logs --app simplelabeldataexporter

# Open the app in browser
flyctl open --app simplelabeldataexporter
```

### Staging Environment Details

- **URL**: https://simplelabeldataexporter.fly.dev
- **Database**: Attached PostgreSQL instance (simplelabeldataexporter-db)
- **Shopify App**: Test app in Shopify Partners dashboard
- **Test Store**: Install to your test/development store

## Setting Up Production (First Time)

Production uses a **new** fly.io deployment: `simplelabels-prod`

### Step 1: Create Production App

```bash
# Create the production app
flyctl apps create simplelabels-prod --org your-org-name
```

### Step 2: Create Production Database

```bash
# Create PostgreSQL database for production
flyctl postgres create \
  --name simplelabels-prod-db \
  --region iad \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# Attach database to the app (sets DATABASE_URL automatically)
flyctl postgres attach simplelabels-prod-db --app simplelabels-prod
```

### Step 3: Set Production Secrets

```bash
# Set environment variables
flyctl secrets set \
  NODE_ENV=production \
  --app simplelabels-prod
```

**Note**: Unlike staging, production doesn't need `SHOPIFY_API_KEY` or `SHOPIFY_API_SECRET` because it uses custom apps (configured per customer store).

### Step 4: Deploy to Production

```bash
# Deploy using production configuration
flyctl deploy --config fly.production.toml --app simplelabels-prod
```

### Step 5: Verify Production Deployment

```bash
# Check status
flyctl status --app simplelabels-prod

# Test health endpoint
curl https://simplelabels-prod.fly.dev/healthz

# View logs
flyctl logs --app simplelabels-prod
```

## Deploying Updates to Production

After the initial setup, deploying updates is simple:

```bash
# Deploy latest code to production
flyctl deploy --config fly.production.toml --app simplelabels-prod
```

**Recommended Workflow**:
1. Test changes locally with `shopify app dev`
2. Deploy to staging and test: `flyctl deploy --app simplelabeldataexporter`
3. Once verified, deploy to production: `flyctl deploy --config fly.production.toml --app simplelabels-prod`

## Database Management

### View Database Status

```bash
# Staging database
flyctl postgres status --app simplelabeldataexporter-db

# Production database
flyctl postgres status --app simplelabels-prod-db
```

### Connect to Database

```bash
# Staging
flyctl postgres connect --app simplelabeldataexporter-db

# Production
flyctl postgres connect --app simplelabels-prod-db
```

### Database Backups

```bash
# List backups
flyctl postgres backup list --app simplelabels-prod-db

# Create manual backup
flyctl postgres backup create --app simplelabels-prod-db
```

### Migrations

Migrations run automatically during deployment via the `docker-start` script in package.json:

```json
"docker-start": "npm run setup && npm run start"
"setup": "prisma generate && prisma migrate deploy"
```

**Manual migration** (if needed):
```bash
# SSH into the app
flyctl ssh console --app simplelabels-prod

# Run migrations
npm run setup
```

## Monitoring

### View Logs

```bash
# Real-time logs
flyctl logs --app simplelabels-prod

# Logs from last hour
flyctl logs --app simplelabels-prod --time 1h
```

### App Metrics

```bash
# View metrics
flyctl metrics --app simplelabels-prod

# VM metrics
flyctl vm status --app simplelabels-prod
```

### Health Checks

The app exposes a `/healthz` endpoint for health checks:

```bash
curl https://simplelabels-prod.fly.dev/healthz
```

Should return HTTP 200 if healthy.

## Rollback

If a deployment causes issues, you can rollback to a previous version:

```bash
# List all releases
flyctl releases --app simplelabels-prod

# Rollback to previous version
flyctl releases rollback <version-number> --app simplelabels-prod
```

Example:
```bash
$ flyctl releases --app simplelabels-prod
VERSION  STATUS    DESCRIPTION                  USER            DATE
v5       complete  Deploy successful            you@email.com   2m ago
v4       complete  Deploy successful            you@email.com   2h ago

$ flyctl releases rollback v4 --app simplelabels-prod
```

## Scaling

### Adjust VM Resources

```bash
# Scale to 2GB memory
flyctl scale memory 2048 --app simplelabels-prod

# Scale CPUs
flyctl scale vm shared-cpu-2x --app simplelabels-prod
```

### Auto-scaling

Currently configured for auto-scaling:
- `min_machines_running = 0` - Scales to zero when idle
- `auto_stop_machines = 'stop'` - Stops when no traffic
- `auto_start_machines = true` - Starts on first request

This keeps costs low while ensuring availability.

## Environment Variables Reference

### Staging Secrets

```bash
# View current secrets (values are hidden)
flyctl secrets list --app simplelabeldataexporter

# Set secrets
flyctl secrets set \
  SHOPIFY_API_KEY=your-staging-api-key \
  SHOPIFY_API_SECRET=your-staging-api-secret \
  --app simplelabeldataexporter
```

### Production Secrets

```bash
# View current secrets
flyctl secrets list --app simplelabels-prod

# Set secrets (if needed)
flyctl secrets set \
  NODE_ENV=production \
  --app simplelabels-prod
```

## Multi-Tenant Architecture (Production)

Production serves multiple customer stores from a single deployment:

1. **Each customer** has a custom Shopify app installed in their store
2. **Each custom app** points to: `https://simplelabels-prod.fly.dev`
3. **Sessions are isolated** by the `shop` field in the database
4. **Access tokens** are shop-specific - customers cannot access each other's data

To verify session isolation:
```bash
# Connect to production database
flyctl postgres connect --app simplelabels-prod-db

# View all sessions
SELECT shop, id, "isOnline" FROM "Session";

# Each row represents a customer store session
```

## Troubleshooting

### Deployment Fails

```bash
# Check build logs
flyctl logs --app simplelabels-prod

# Try deploying with verbose output
flyctl deploy --config fly.production.toml --verbose
```

### Database Connection Issues

```bash
# Verify DATABASE_URL is set
flyctl secrets list --app simplelabels-prod

# Verify database is running
flyctl postgres status --app simplelabels-prod-db

# Test connection
flyctl ssh console --app simplelabels-prod
# Inside the container:
echo $DATABASE_URL
```

### App Won't Start

```bash
# Check app status
flyctl status --app simplelabels-prod

# View recent logs
flyctl logs --app simplelabels-prod

# Restart the app
flyctl apps restart simplelabels-prod
```

### Migration Errors

```bash
# SSH into the app
flyctl ssh console --app simplelabels-prod

# Check migration status
npx prisma migrate status

# Apply migrations manually
npx prisma migrate deploy
```

## Cost Estimation

**Staging**:
- App (shared-cpu-1x, 1GB RAM): ~$5/month (scales to zero)
- PostgreSQL (shared-cpu-1x, 1GB volume): ~$5/month
- **Total**: ~$10/month

**Production**:
- App (shared-cpu-1x, 1GB RAM): ~$5/month (scales to zero)
- PostgreSQL (shared-cpu-1x, 1GB volume): ~$5/month
- **Total**: ~$10/month

**Combined**: ~$20/month for unlimited customer stores

## Security Best Practices

1. **Never commit secrets** - All secrets are managed via `flyctl secrets`
2. **Use HTTPS only** - Configured in fly.toml with `force_https = true`
3. **Database encryption** - fly.io PostgreSQL uses encryption at rest
4. **Session isolation** - Each customer's session is isolated by shop domain
5. **Access control** - Only authorized users can deploy via fly.io CLI

## Next Steps

- See [CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md) for adding new customers to production
- See [DEVELOPMENT.md](./DEVELOPMENT.md) for local development setup
