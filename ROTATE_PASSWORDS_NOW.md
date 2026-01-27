# 🔐 Immediate Password Rotation Guide

**Status**: Ready to Execute
**Time Required**: 10-15 minutes
**Risk Level**: Low (Development only)

## Quick Overview

Since `devpassword` was exposed in git history, we need to rotate it. This guide walks you through rotating the **development password** first (safest to test).

## Step 1: Generate New Password (1 minute)

Open PowerShell and run:

```powershell
# Generate a secure random password
$newPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | % {[char]$_})
Write-Host "Your new password: $newPassword"
Write-Host ""
Write-Host "SAVE THIS PASSWORD NOW in your password manager!"
```

Or use this bash command (Git Bash):

```bash
NEW_PASSWORD=$(openssl rand -base64 24)
echo "Your new password: $NEW_PASSWORD"
echo ""
echo "SAVE THIS PASSWORD NOW in your password manager!"
```

**✅ Action**: Copy the password and save it in your password manager (1Password, LastPass, etc.)

## Step 2: Update .env.docker (1 minute)

```bash
# Open .env.docker
notepad .env.docker

# Change the line:
# POSTGRES_PASSWORD=devpassword
# To:
POSTGRES_PASSWORD=<paste-your-new-password>

# Save and close
```

**Example**:
```
# Before
POSTGRES_PASSWORD=devpassword

# After
POSTGRES_PASSWORD=XkP9mN2qR7sT4vB6wC8zE1yA5
```

## Step 3: Recreate Docker Container (2 minutes)

**⚠️ WARNING**: This will delete your local development database. If you have important test data, back it up first!

### Option A: Fresh Start (Recommended)

```bash
cd C:\Users\kdd9a\code\ShopifyLabelData\label-data-exporter

# Stop and remove container and volume
docker compose down
docker volume rm label-data-exporter_postgres_data

# Start with new password
docker compose up -d

# Check it's running
docker ps | grep labelexporter-db
```

### Option B: Preserve Data (Advanced)

```bash
# Backup data first
docker exec labelexporter-db pg_dump -U labelexporter labelexporter_dev > backup.sql

# Then follow Option A

# After container is recreated, restore data
docker exec -i labelexporter-db psql -U labelexporter labelexporter_dev < backup.sql
```

## Step 4: Update .env File (1 minute)

```bash
# Open .env
notepad .env

# Find the DATABASE_URL line and update the password:
# OLD:
# DATABASE_URL="postgresql://labelexporter:devpassword@localhost:5432/labelexporter_dev"

# NEW (replace <new-password> with your actual password):
DATABASE_URL="postgresql://labelexporter:<new-password>@localhost:5432/labelexporter_dev"

# Save and close
```

**Example**:
```
DATABASE_URL="postgresql://labelexporter:XkP9mN2qR7sT4vB6wC8zE1yA5@localhost:5432/labelexporter_dev"
```

## Step 5: Test Database Connection (2 minutes)

```bash
cd C:\Users\kdd9a\code\ShopifyLabelData\label-data-exporter

# Run migrations (tests database connection)
npm run setup

# Expected output:
# Running migrations...
# Migration successful!

# Start the app
shopify app dev

# Expected: App starts with no database errors
```

## Step 6: Verify Old Password Doesn't Work (1 minute)

```bash
# Try connecting with old password (should fail)
docker exec -it labelexporter-db psql -U labelexporter -d labelexporter_dev

# When prompted for password, enter: devpassword
# Expected: "FATAL: password authentication failed"

# Try with new password (should work)
docker exec -it labelexporter-db psql -U labelexporter -d labelexporter_dev

# When prompted, enter your new password
# Expected: psql prompt appears
# Type: \q to exit
```

## ✅ Verification Checklist

After rotation, verify:

- [ ] New password saved in password manager
- [ ] `.env.docker` updated with new password
- [ ] `.env` updated with new DATABASE_URL
- [ ] Docker container recreated successfully
- [ ] `docker ps` shows labelexporter-db running
- [ ] `npm run setup` completes without errors
- [ ] `shopify app dev` starts without database errors
- [ ] Old password `devpassword` no longer works
- [ ] New password connects successfully

## 🎉 Success!

Your development database password has been rotated. The old `devpassword` from git history is now invalid.

### What's Changed

**Before**:
- Password: `devpassword` (exposed in git history)
- Risk: Anyone with git access could connect to your local DB

**After**:
- Password: `<your-secure-24-char-password>` (gitignored)
- Risk: ✅ Mitigated - old password no longer valid

### Update .env.example (Optional)

If you want to commit the updated .env.example:

```bash
git add .env.example PASSWORD_ROTATION_PLAN.md ROTATE_PASSWORDS_NOW.md
git commit -m "Update .env.example and add password rotation guides

- Remove hardcoded devpassword from .env.example
- Add comprehensive password rotation plan
- Add quick-start guide for immediate rotation"
```

---

## Next Steps

### Immediate (Done!)
✅ Rotate development password

### This Week
⚠️ Rotate staging password (see PASSWORD_ROTATION_PLAN.md Phase 3)

### This Month
🔴 Rotate production password (see PASSWORD_ROTATION_PLAN.md Phase 4)

### Ongoing
📅 Set up rotation schedule:
- Development: Every 6 months
- Staging: Every 3 months
- Production: Every 3 months

---

## Troubleshooting

### Docker container won't start

```bash
# Check logs
docker logs labelexporter-db

# Common issue: Password contains special characters
# Solution: Use simpler password or escape special chars
```

### Can't connect to database

```bash
# Verify password in .env.docker
cat .env.docker

# Verify container is running
docker ps

# Check container logs
docker logs labelexporter-db

# Test connection directly
docker exec -it labelexporter-db psql -U labelexporter -d labelexporter_dev
```

### Lost the new password

```bash
# Check .env.docker
cat .env.docker

# Or regenerate and start over from Step 1
```

---

**Questions?** See the full PASSWORD_ROTATION_PLAN.md for detailed information about rotating staging and production passwords.
