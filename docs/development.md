# Development Guide

This guide covers local development setup for the Label Data Exporter Shopify app.

## Quick Start

```bash
# 1. Start PostgreSQL database
docker compose -f .docker/docker-compose.yml up -d

# 2. Run migrations
npx prisma migrate deploy
npx prisma generate

# 3. Start development server
shopify app dev
```

That's it! The app will open in your development store.

## Environment Setup

### Prerequisites

- **Node.js 20+** installed
- **Docker Desktop** installed and running
- **Shopify CLI** installed: `npm install -g @shopify/cli`

### Development Environment

For local development, this app uses **PostgreSQL** running in Docker to match the staging/production environment.

1. **Copy the environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Start the PostgreSQL database**:
   ```bash
   docker compose -f .docker/docker-compose.yml up -d
   ```

   This starts a PostgreSQL container on port 5432. The database will persist data in a Docker volume.

3. **Run database migrations**:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

4. **Start the development server**:
   ```bash
   shopify app dev
   ```

The Shopify CLI will:
- Create a secure tunnel to your local server
- Load app configuration from `shopify.app.toml`
- Set environment variables automatically
- Open your development store with the app installed

### Database Configuration

**Development (Local)**:
- Uses PostgreSQL via Docker: `postgresql://labelexporter:devpassword@localhost:5432/labelexporter_dev`
- Start database: `docker compose -f .docker/docker-compose.yml up -d`
- Stop database: `docker compose down`
- Reset database: `docker compose down -v` (deletes all data)

**Staging/Production (fly.io)**:
- Uses PostgreSQL (managed by fly.io)
- Database URL set automatically via `flyctl postgres attach`
- Migrations run during deployment via `npm run docker-start`

### Environment Variables

The app uses different environment variables per environment:

| Variable | Development | Staging | Production |
|----------|------------|---------|------------|
| `DATABASE_URL` | `postgresql://labelexporter:devpassword@localhost:5432/labelexporter_dev` | Set by fly.io | Set by fly.io |
| `SHOPIFY_API_KEY` | From shopify.app.toml | fly.io secret | N/A (custom apps) |
| `SHOPIFY_API_SECRET` | From shopify.app.toml | fly.io secret | N/A (custom apps) |
| `NODE_ENV` | `development` | `production` | `production` |

**Note**: Production uses Shopify Custom Apps (one per customer store), so API keys are configured in each customer's Shopify admin, not in environment variables.

## Development Workflow

### Making Changes

1. **Start dev server**: `shopify app dev`
2. **Make code changes** - the server auto-reloads
3. **Test in your development store**
4. **Commit changes**:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push origin main
   ```

### Database Migrations

When you modify `prisma/schema.prisma`:

```bash
# Create a new migration
npx prisma migrate dev --name describe_your_change

# This will:
# - Generate SQL migration files
# - Apply the migration to your local PostgreSQL database
# - Regenerate the Prisma Client
```

The migration files are PostgreSQL-compatible and work across development, staging, and production.

## Testing

### Local Testing

1. Install the app in your development store via `shopify app dev`
2. Navigate to Apps > Label Data Exporter in your store admin
3. Test product selection and export functionality

### Staging Testing

After deploying to staging:

1. Visit https://simplelabeldataexporter.fly.dev
2. Install the test app in your test store
3. Verify functionality works as expected

## Troubleshooting

### Database Issues

**Database connection errors**:
```bash
# Make sure Docker is running
docker compose ps

# Restart the database
docker compose restart
```

**Migration errors**:
```bash
# Reset your local database (WARNING: deletes all data)
docker compose down -v
docker compose -f .docker/docker-compose.yml up -d
npx prisma migrate deploy
npx prisma generate
```

**"Port 5432 already in use"**:
```bash
# Check if PostgreSQL is already running locally
# Windows:
netstat -ano | findstr :5432

# Stop any local PostgreSQL service or change docker-compose.yml port
# Example: "5433:5432" to use port 5433 on host
```

### Shopify CLI Issues

**Clear CLI cache**:
```bash
shopify logout
shopify auth login
```

**Port conflicts**:
```bash
# The CLI uses port 3000 by default
# Kill any process using port 3000
# On Windows:
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

## Next Steps

- See [DEPLOYMENT.md](./DEPLOYMENT.md) for deploying to staging/production
- See [CUSTOMER_ONBOARDING.md](./CUSTOMER_ONBOARDING.md) for adding new customers
