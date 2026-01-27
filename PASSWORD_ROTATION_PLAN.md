# Password Rotation Plan

**Purpose**: Rotate database passwords to mitigate risk from git history exposure
**Date**: 2026-01-26
**Status**: Ready for Implementation

## Overview

Instead of cleaning git history (which is disruptive), we'll rotate all database passwords. This makes any exposed passwords from git history immediately invalid.

## Environments to Rotate

1. **Development (Docker)** - Local PostgreSQL container
2. **Staging (fly.io)** - `<staging-app>-db` PostgreSQL cluster
3. **Production (fly.io)** - `<production-app>-db` PostgreSQL cluster

---

## Phase 1: Development Password Rotation (Local Docker)

### Current Setup

The development database uses:
- **Container**: `labelexporter-db` (PostgreSQL 16)
- **Username**: `labelexporter`
- **Password**: `devpassword` (exposed in git history)
- **Database**: `labelexporter_dev`

Password is stored in:
- `.env.docker` (gitignored) - Used by docker-compose
- `.env` (gitignored) - Used by the app via DATABASE_URL

### Rotation Steps

#### Step 1: Generate New Password

```bash
# Generate a secure random password
NEW_PASSWORD=$(openssl rand -base64 24)
echo "New password: $NEW_PASSWORD"

# Or manually choose a secure password
# NEW_PASSWORD="your-new-secure-password-here"
```

#### Step 2: Update .env.docker

```bash
# Edit .env.docker
nano .env.docker

# Change:
# POSTGRES_PASSWORD=devpassword
# To:
POSTGRES_PASSWORD=<new-password>
```

#### Step 3: Recreate Docker Container

```bash
# Stop and remove the existing container and volume
docker compose down
docker volume rm label-data-exporter_postgres_data

# Start with new password
docker compose up -d

# Verify container is running
docker ps | grep labelexporter-db
```

**⚠️ Warning**: This will delete all local development data. If you have important test data, export it first:

```bash
# Export before rotation
docker exec labelexporter-db pg_dump -U labelexporter labelexporter_dev > backup.sql

# After rotation, import
docker exec -i labelexporter-db psql -U labelexporter labelexporter_dev < backup.sql
```

#### Step 4: Update .env File

```bash
# Edit .env
nano .env

# Update DATABASE_URL with new password:
DATABASE_URL="postgresql://labelexporter:<new-password>@localhost:5432/labelexporter_dev"
```

#### Step 5: Verify Application Connects

```bash
# Test database connection
npm run setup  # Should run migrations successfully

# Start the app
shopify app dev

# Verify no database connection errors
```

### Verification Checklist

- [ ] New password generated and stored in password manager
- [ ] `.env.docker` updated with new password
- [ ] Docker container recreated with new password
- [ ] `.env` updated with new DATABASE_URL
- [ ] Migrations run successfully
- [ ] App connects to database
- [ ] Old password `devpassword` no longer works

---

## Phase 2: Fly.io Database Password Management

### Understanding Fly.io PostgreSQL

Fly.io PostgreSQL databases are created with:
1. **Automatic password generation** when created with `flyctl postgres create`
2. **Automatic DATABASE_URL secret** set when attached with `flyctl postgres attach`
3. **Connection string** stored as a secret in the app

**Key Point**: Fly.io manages the password automatically. When you attach a database, it:
- Creates a PostgreSQL user
- Generates a secure password
- Sets `DATABASE_URL` as an app secret
- You never see or set the password manually

### How to View Current Database Connection

```bash
# Staging
flyctl secrets list --app <staging-app>
# Look for: DATABASE_URL

# Production
flyctl secrets list --app <production-app>
# Look for: DATABASE_URL
```

The DATABASE_URL format is:
```
postgres://username:password@hostname:port/database
```

### Password Rotation Strategy for Fly.io

Fly.io PostgreSQL doesn't have a built-in "rotate password" command. Options:

#### Option A: Create New User with New Password (Recommended)

**Pros**: Zero downtime, can test new credentials before switching
**Cons**: Slightly more complex

**Steps**:

1. **Connect to database**:
   ```bash
   flyctl postgres connect --app <staging-app>-db
   ```

2. **Create new user with secure password**:
   ```sql
   -- Generate password securely (outside of SQL)
   -- Then create user
   CREATE USER labelexporter_new WITH PASSWORD 'new-secure-password-here';
   GRANT ALL PRIVILEGES ON DATABASE labelexporter_dev TO labelexporter_new;
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labelexporter_new;
   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labelexporter_new;
   GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO labelexporter_new;

   -- Make new user the owner
   ALTER DATABASE labelexporter_dev OWNER TO labelexporter_new;
   \q
   ```

3. **Get current DATABASE_URL format**:
   ```bash
   flyctl secrets list --app <staging-app>
   ```

4. **Update DATABASE_URL secret with new user**:
   ```bash
   flyctl secrets set DATABASE_URL="postgres://labelexporter_new:new-password@hostname:port/database" --app <staging-app>
   ```

5. **Verify app restarts and connects**:
   ```bash
   flyctl logs --app <staging-app>
   ```

6. **Once verified, drop old user**:
   ```bash
   flyctl postgres connect --app <staging-app>-db
   ```
   ```sql
   DROP USER labelexporter;
   \q
   ```

#### Option B: Detach and Re-attach Database (Nuclear Option)

**Pros**: Fly.io handles everything automatically
**Cons**: Brief downtime, DATABASE_URL changes

**Steps**:

```bash
# 1. Detach database (removes DATABASE_URL secret)
flyctl postgres detach <staging-app>-db --app <staging-app>

# 2. Re-attach database (creates new user/password, sets new DATABASE_URL)
flyctl postgres attach <staging-app>-db --app <staging-app>

# 3. App will restart with new credentials
flyctl status --app <staging-app>
```

**Note**: This creates a NEW database user, not rotating the existing one.

#### Option C: Change Password via PostgreSQL (Manual)

**Pros**: Simple, direct
**Cons**: Need to manually update DATABASE_URL

**Steps**:

1. **Connect to database**:
   ```bash
   flyctl postgres connect --app <staging-app>-db
   ```

2. **Change password**:
   ```sql
   ALTER USER labelexporter WITH PASSWORD 'new-secure-password-here';
   \q
   ```

3. **Update DATABASE_URL**:
   ```bash
   # Get current DATABASE_URL
   flyctl secrets list --app <staging-app>

   # Update with new password (keep same username/hostname/port/database)
   flyctl secrets set DATABASE_URL="postgres://labelexporter:new-password@hostname:port/database" --app <staging-app>
   ```

4. **Verify**:
   ```bash
   flyctl logs --app <staging-app>
   ```

---

## Phase 3: Staging Database Rotation

### Pre-Rotation Checklist

- [ ] **Backup staging database**:
  ```bash
  flyctl postgres backup create --app <staging-app>-db
  flyctl postgres backup list --app <staging-app>-db
  ```

- [ ] **Document current DATABASE_URL** (save to password manager):
  ```bash
  flyctl secrets list --app <staging-app>
  ```

- [ ] **Check app status**:
  ```bash
  flyctl status --app <staging-app>
  ```

### Rotation Process (Option A - Recommended)

```bash
# 1. Generate secure password
NEW_PASSWORD=$(openssl rand -base64 24)
echo "New password: $NEW_PASSWORD"
# Store in password manager!

# 2. Connect to staging database
flyctl postgres connect --app <staging-app>-db
```

```sql
-- 3. Create new user
CREATE USER labelexporter_v2 WITH PASSWORD 'paste-new-password-here';
GRANT ALL PRIVILEGES ON DATABASE labelexporter_dev TO labelexporter_v2;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labelexporter_v2;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labelexporter_v2;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO labelexporter_v2;
ALTER DATABASE labelexporter_dev OWNER TO labelexporter_v2;
\q
```

```bash
# 4. Get current DATABASE_URL hostname/port/database
flyctl secrets list --app <staging-app>

# 5. Update DATABASE_URL with new credentials
# Format: postgres://labelexporter_v2:NEW_PASSWORD@hostname:port/database
flyctl secrets set DATABASE_URL="postgres://labelexporter_v2:NEW_PASSWORD@db.hostname.internal:5432/labelexporter_dev" --app <staging-app>

# 6. Monitor app restart
flyctl logs --app <staging-app>

# 7. Test staging app
flyctl open --app <staging-app>

# 8. Once verified (after 24 hours), drop old user
flyctl postgres connect --app <staging-app>-db
```

```sql
DROP USER labelexporter;
\q
```

### Verification

- [ ] App logs show successful database connection
- [ ] Staging app loads correctly
- [ ] Can create test exports
- [ ] No authentication errors in logs
- [ ] Old password no longer works

---

## Phase 4: Production Database Rotation

### ⚠️ Critical Considerations

**Before rotating production**:
1. **Test rotation on staging first** (Phase 3)
2. **Schedule rotation during low-traffic period**
3. **Notify any active users** (if applicable)
4. **Have rollback plan ready**

### Pre-Rotation Checklist

- [ ] **Staging rotation completed successfully**
- [ ] **Create production backup**:
  ```bash
  flyctl postgres backup create --app <production-app>-db
  flyctl postgres backup list --app <production-app>-db
  ```

- [ ] **Document current DATABASE_URL** (save to password manager)
- [ ] **Check customer sessions**:
  ```bash
  flyctl postgres connect --app <production-app>-db
  ```
  ```sql
  SELECT COUNT(*) FROM "Session";
  \q
  ```

- [ ] **Schedule maintenance window** (optional)

### Rotation Process (Same as Staging)

```bash
# 1. Generate secure password
NEW_PASSWORD=$(openssl rand -base64 24)
echo "New password: $NEW_PASSWORD"
# Store in password manager!

# 2. Connect to production database
flyctl postgres connect --app <production-app>-db
```

```sql
-- 3. Create new user
CREATE USER labelexporter_v2 WITH PASSWORD 'paste-new-password-here';
GRANT ALL PRIVILEGES ON DATABASE labelexporter_dev TO labelexporter_v2;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO labelexporter_v2;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO labelexporter_v2;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO labelexporter_v2;
ALTER DATABASE labelexporter_dev OWNER TO labelexporter_v2;
\q
```

```bash
# 4. Update DATABASE_URL
flyctl secrets list --app <production-app>
flyctl secrets set DATABASE_URL="postgres://labelexporter_v2:NEW_PASSWORD@db.hostname.internal:5432/labelexporter_dev" --app <production-app>

# 5. Monitor app restart
flyctl logs --app <production-app>

# 6. Test production app (using test store)
flyctl open --app <production-app>

# 7. Monitor for errors
flyctl logs --app <production-app> --time 1h

# 8. After 48 hours of stable operation, drop old user
flyctl postgres connect --app <production-app>-db
```

```sql
DROP USER labelexporter;
\q
```

### Rollback Plan

If rotation fails:

```bash
# Option 1: Revert to old DATABASE_URL
flyctl secrets set DATABASE_URL="<old-database-url-from-backup>" --app <production-app>

# Option 2: Restore from backup (nuclear option)
flyctl postgres backup restore <backup-id> --app <production-app>-db
```

---

## Phase 5: Update Documentation

After successful rotation:

### Update .env.example

```bash
# Edit .env.example
nano .env.example
```

Change:
```bash
# Before
DATABASE_URL="postgresql://labelexporter:devpassword@localhost:5432/labelexporter_dev"

# After
DATABASE_URL="postgresql://labelexporter:your_secure_password@localhost:5432/labelexporter_dev"
```

### Update .env.docker.example

Already updated in security commit to:
```
POSTGRES_PASSWORD=your_secure_password_here
```

### Document Rotation

Add to `SECURITY.md`:

```markdown
## Password Rotation Schedule

### Development (Docker)
- **Last Rotated**: 2026-01-26
- **Next Rotation**: 2026-07-26 (6 months)
- **Owner**: Development Team

### Staging
- **Last Rotated**: 2026-01-26
- **Next Rotation**: 2026-04-26 (3 months)
- **Owner**: DevOps

### Production
- **Last Rotated**: 2026-01-26
- **Next Rotation**: 2026-04-26 (3 months)
- **Owner**: DevOps
```

---

## Rotation Schedule Recommendations

### Development (Docker)
- **Frequency**: Every 6 months
- **Trigger**: When exposed or on schedule
- **Impact**: Low (only affects local development)

### Staging
- **Frequency**: Every 3 months
- **Trigger**: When exposed, on schedule, or before major releases
- **Impact**: Medium (testing environment)

### Production
- **Frequency**: Every 3-6 months
- **Trigger**: When exposed, on schedule, or security audit
- **Impact**: High (live customer data)

---

## Security Best Practices

1. **Password Generation**:
   ```bash
   # Use cryptographically secure random passwords
   openssl rand -base64 24  # 24 characters, base64 encoded
   ```

2. **Password Storage**:
   - Store in password manager (1Password, LastPass, etc.)
   - Never commit to git
   - Never share via email/Slack

3. **Verification**:
   - Always test connection after rotation
   - Monitor logs for authentication errors
   - Keep old credentials for 24-48 hours before deletion

4. **Documentation**:
   - Update rotation dates
   - Document who has access
   - Maintain backup of connection strings

---

## Troubleshooting

### "Authentication failed" after rotation

```bash
# Check if DATABASE_URL was set correctly
flyctl secrets list --app <app-name>

# Verify password in database
flyctl postgres connect --app <app-name>-db
```
```sql
\du  -- List users and their roles
```

### App won't start after rotation

```bash
# Check logs for specific error
flyctl logs --app <app-name>

# Rollback if necessary
flyctl secrets set DATABASE_URL="<old-url>" --app <app-name>
```

### Database locked after rotation

```sql
-- Check active connections
SELECT * FROM pg_stat_activity WHERE datname = 'labelexporter_dev';

-- Terminate connections if needed (be careful!)
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'labelexporter_dev';
```

---

## Summary

### Immediate Actions (Phase 1)

✅ **Rotate Development Password** - Low risk, immediate benefit
- Generate new password
- Update `.env.docker` and `.env`
- Recreate Docker container

### Short-term Actions (Phase 2-3)

⚠️ **Rotate Staging Password** - Test rotation process
- Backup database
- Create new user with new password
- Update DATABASE_URL secret
- Verify app functionality

### Long-term Actions (Phase 4)

🔴 **Rotate Production Password** - Critical security
- Complete staging rotation first
- Schedule during low-traffic window
- Backup database
- Follow same process as staging
- Monitor closely for 48 hours

### Maintenance (Phase 5)

📅 **Set Rotation Schedule**
- Development: Every 6 months
- Staging: Every 3 months
- Production: Every 3 months
- Document rotation dates
- Update SECURITY.md

---

**Next Steps**: Review this plan and execute Phase 1 (Development rotation) first to validate the process.
