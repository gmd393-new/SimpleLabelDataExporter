# Deployment Guide

This guide covers deploying the Label Data Exporter to staging and production environments on fly.io.

**Note**: Actual deployment URLs are stored in `.claude/deployment-config.local.json` (gitignored). Copy `.claude/deployment-config.example.json` to get started.

## Architecture Overview

```
Development (Local)
├── Database: PostgreSQL (Docker)
├── Server: shopify app dev (local + tunnel)
└── Purpose: Active development and testing

Staging (fly.io)
├── App: <staging-app>.fly.dev
├── Database: <staging-app>-db (PostgreSQL)
├── Shopify App: Test app in Partners Dashboard
└── Purpose: Pre-production testing, QA, demos

Production (fly.io)
├── Postgres cluster: <production-db> (shared by all stores)
├── One deployment PER STORE, all running the same image:
│   ├── <store-a-app>  → <store-a>.myshopify.com
│   └── <store-b-app>  → <store-b>.myshopify.com
├── Shopify Apps: one custom-distribution Partners app per store
└── Deploy: ./scripts/deploy-all.sh (deploys every store together)
```

**Why one deployment per store**: a custom-distribution Shopify app installs on a single
store, and `app/shopify.server.js` builds one `shopifyApp()` instance from a single
`SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` pair — so one deployment serves one Partners app,
and therefore one store. Each deployment gets its own logical database on the shared
cluster. See [CUSTOMER_ONBOARDING.md](./customer-onboarding.md).

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

Staging uses your configured staging app (see `.claude/deployment-config.local.json`).

### Deploy Process

```bash
# From the label-data-exporter directory

# Deploy to staging (uses fly.toml by default)
flyctl deploy --config .fly/staging.toml

# Or explicitly specify the config file and app name
flyctl deploy --config .fly/staging.toml --app <staging-app>
```

### Check Deployment Status

```bash
# View app status
flyctl status --app <staging-app>

# View logs
flyctl logs --app <staging-app>

# Open the app in browser
flyctl open --app <staging-app>
```

### Staging Environment Details

- **URL**: https://<staging-app>.fly.dev
- **Database**: Attached PostgreSQL instance (<staging-app>-db)
- **Shopify App**: Test app in Shopify Partners dashboard
- **Test Store**: Install to your test/development store

## Setting Up Production (First Time)

Production uses a separate fly.io deployment from staging.

### Step 1: Create Production App

```bash
# Create the production app
flyctl apps create <production-app> --org your-org-name
```

### Step 2: Create Production Database

```bash
# Create PostgreSQL database for production
flyctl postgres create \
  --name <production-app>-db \
  --region iad \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# Attach database to the app (sets DATABASE_URL automatically)
flyctl postgres attach <production-app>-db --app <production-app>
```

### Step 3: Set Production Secrets

```bash
flyctl secrets set \
  NODE_ENV=production \
  SCOPES=write_products \
  SHOPIFY_APP_URL=https://<production-app>.fly.dev \
  SHOPIFY_API_KEY=<client ID from that store's Partners app> \
  SHOPIFY_API_SECRET=<API secret from that store's Partners app> \
  UPC_PREFIX=<this store's own vendor prefix, distinct from every other store> \
  --app <production-app>
```

**All six are required.** `app/shopify.server.js:11-15` reads `SHOPIFY_API_KEY`,
`SHOPIFY_API_SECRET`, `SCOPES`, and `SHOPIFY_APP_URL`; `DATABASE_URL` is set by
`postgres attach`. `UPC_PREFIX` has no default — `getUpcPrefix()` throws if it is
missing — because two stores sharing a prefix would issue duplicate UPCs from their
separate databases.

`SHOPIFY_APP_URL` is per-deployment. Copying it from another store's deployment sends
OAuth redirects to the wrong app and presents as a redirect loop rather than a clear
error.

### Step 4: Deploy to Production

```bash
# Deploy using production configuration
flyctl deploy --config .fly/production.toml --app <production-app>
```

### Step 5: Verify Production Deployment

```bash
# Check status
flyctl status --app <production-app>

# Test health endpoint
curl https://<production-app>.fly.dev/healthz

# View logs
flyctl logs --app <production-app>
```

## Deploying Updates to Production

**Always deploy every store together:**

```bash
./scripts/deploy-all.sh
```

Nothing in the platform enforces that the per-store deployments run the same code, so
drift is the main operational risk of this architecture. `deploy-all.sh` deploys every
store listed in its `DEPLOYMENTS` array, health-checks each afterwards, and exits
non-zero with a loud warning if the stores end up on different versions.

To check health without deploying anything:

```bash
./scripts/deploy-all.sh --check
```

Deploying a single store by hand is possible but should be a deliberate exception —
say, verifying a fix on one store before rolling it everywhere:

```bash
flyctl deploy --config .fly/production-<slug>.toml --app <store-app>
```

**Recommended Workflow**:
1. Test changes locally with `shopify app dev`
2. Deploy to staging and test: `flyctl deploy --config .fly/staging.toml`
3. Once verified: `./scripts/deploy-all.sh`
4. Spot-check each production store still loads and exports

## Database Management

### View Database Status

```bash
# Staging database
flyctl postgres status --app <staging-app>-db

# Production database
flyctl postgres status --app <production-app>-db
```

### Connect to Database

```bash
# Staging
flyctl postgres connect --app <staging-app>-db

# Production
flyctl postgres connect --app <production-app>-db
```

### Database Backups

```bash
# List backups
flyctl postgres backup list --app <production-app>-db

# Create manual backup
flyctl postgres backup create --app <production-app>-db
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
flyctl ssh console --app <production-app>

# Run migrations
npm run setup
```

## Monitoring

### View Logs

```bash
# Real-time logs
flyctl logs --app <production-app>

# Logs from last hour
flyctl logs --app <production-app> --time 1h
```

### App Metrics

```bash
# View metrics
flyctl metrics --app <production-app>

# VM metrics
flyctl vm status --app <production-app>
```

### Health Checks

The app exposes a `/healthz` endpoint for health checks:

```bash
curl https://<production-app>.fly.dev/healthz
```

Should return HTTP 200 if healthy.

## Rollback

If a deployment causes issues, you can rollback to a previous version:

```bash
# List all releases
flyctl releases --app <production-app>

# Rollback to previous version
flyctl releases rollback <version-number> --app <production-app>
```

Example:
```bash
$ flyctl releases --app <production-app>
VERSION  STATUS    DESCRIPTION                  USER            DATE
v5       complete  Deploy successful            you@email.com   2m ago
v4       complete  Deploy successful            you@email.com   2h ago

$ flyctl releases rollback v4 --app <production-app>
```

## Scaling

### Adjust VM Resources

```bash
# Scale to 2GB memory
flyctl scale memory 2048 --app <production-app>

# Scale CPUs
flyctl scale vm shared-cpu-2x --app <production-app>
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
flyctl secrets list --app <staging-app>

# Set secrets
flyctl secrets set \
  SHOPIFY_API_KEY=your-staging-api-key \
  SHOPIFY_API_SECRET=your-staging-api-secret \
  --app <staging-app>
```

### Production Secrets (per store)

Every store's deployment needs its own full set — the API key/secret and app URL differ
per store.

```bash
# View current secrets (values hidden)
flyctl secrets list --app <store-app>

flyctl secrets set \
  NODE_ENV=production \
  SCOPES=write_products \
  SHOPIFY_APP_URL=https://<store-app>.fly.dev \
  SHOPIFY_API_KEY=<that store's client ID> \
  SHOPIFY_API_SECRET=<that store's API secret> \
  UPC_PREFIX=<that store's own vendor prefix, distinct from every other store> \
  --app <store-app>
```

## Per-Store Architecture (Production)

Production runs **one deployment per customer store**, not one shared deployment:

1. **Each store** has its own custom-distribution Partners app, pinned to that store's
   domain (the pin is permanent, as is the distribution method itself)
2. **Each Partners app** has its own client ID and secret, so it needs its own
   deployment — `app/shopify.server.js` builds one `shopifyApp()` instance from one
   credential pair
3. **Each deployment** has its own logical database on the shared
   `<production-db>` cluster, keeping migrations independent
4. **Isolation** is therefore by process *and* by row: sessions are keyed by `shop`, and
   each deployment only ever authenticates one store

To inspect a store's sessions:
```bash
flyctl postgres connect --app <production-db>

\l                              -- list databases, one per store
\c <store-database>     -- connect to a store's database
SELECT shop, id, "isOnline" FROM "Session";
```

## Troubleshooting

### Deployment Fails

```bash
# Check build logs
flyctl logs --app <production-app>

# Try deploying with verbose output
flyctl deploy --config .fly/production.toml --verbose
```

### Database Connection Issues

```bash
# Verify DATABASE_URL is set
flyctl secrets list --app <production-app>

# Verify database is running
flyctl postgres status --app <production-app>-db

# Test connection
flyctl ssh console --app <production-app>
# Inside the container:
echo $DATABASE_URL
```

### App Won't Start

```bash
# Check app status
flyctl status --app <production-app>

# View recent logs
flyctl logs --app <production-app>

# Restart the app
flyctl apps restart <production-app>
```

### Migration Errors

```bash
# SSH into the app
flyctl ssh console --app <production-app>

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
- PostgreSQL cluster (shared-cpu-1x, 1GB volume): ~$5/month — **shared by all stores**
- App, per store (shared-cpu-1x, 1GB RAM): ~$5/month at full utilisation, but machines
  scale to zero when idle (`min_machines_running = 0`), so a low-traffic store costs
  well under that

Adding a store adds one Fly app and no new database cluster, since
`flyctl postgres attach` creates a logical database on the existing cluster.

**Current total**: ~$20/month (staging app + staging DB + two production apps + shared
production DB), with the production apps mostly idle.

## Security Best Practices

1. **Never commit secrets** - All secrets are managed via `flyctl secrets`
2. **Use HTTPS only** - Configured in fly.toml with `force_https = true`
3. **Database encryption** - fly.io PostgreSQL uses encryption at rest
4. **Session isolation** - Each customer's session is isolated by shop domain
5. **Access control** - Only authorized users can deploy via fly.io CLI

## Next Steps

- See [CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md) for adding new customers to production
- See [DEVELOPMENT.md](./DEVELOPMENT.md) for local development setup
