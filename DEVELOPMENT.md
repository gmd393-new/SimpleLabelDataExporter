# Development Guide

This guide covers local development setup for the Label Data Exporter Shopify app.

## Environment Setup

### Development Environment

For local development, this app uses **SQLite** for the database, which requires no additional setup.

1. **Copy the environment template**:
   ```bash
   cp .env.example .env
   ```

2. **Start the development server**:
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
- Uses SQLite: `prisma/dev.sqlite`
- No setup required - database file is created automatically
- Migrations run automatically via `shopify app dev`

**Staging/Production (fly.io)**:
- Uses PostgreSQL (managed by fly.io)
- Database URL set automatically via `flyctl postgres attach`
- Migrations run during deployment via `npm run docker-start`

### Environment Variables

The app uses different environment variables per environment:

| Variable | Development | Staging | Production |
|----------|------------|---------|------------|
| `DATABASE_URL` | `file:./prisma/dev.sqlite` | Set by fly.io | Set by fly.io |
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
# - Apply the migration to your local SQLite database
# - Regenerate the Prisma Client
```

The same migration files work for both SQLite (dev) and PostgreSQL (staging/prod).

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

**SQLite locked**:
```bash
# Stop the dev server and remove the database
rm prisma/dev.sqlite
shopify app dev  # Database will be recreated
```

**Migration errors**:
```bash
# Reset your local database
npx prisma migrate reset
shopify app dev
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
