# Security Guidelines

This document outlines security best practices for the Label Data Exporter app.

## Quick Security Checklist

Before committing code:
- [ ] No hardcoded passwords or API keys
- [ ] Sensitive URLs use placeholders (e.g., `<production-app>.fly.dev`)
- [ ] Database credentials in `.env.docker` (gitignored)
- [ ] Deployment info in `.claude/deployment-config.local.json` (gitignored)
- [ ] Pre-commit hooks enabled: `git config core.hooksPath .githooks`

## Secrets Management

### What Should Never Be Committed

**Never commit these to git:**
- Database passwords
- API keys or secrets
- Access tokens
- Production URLs (use placeholders instead)
- Customer data or shop domains
- SSH keys or certificates

### Where Secrets Should Go

| Secret Type | Location | Gitignored? |
|------------|----------|-------------|
| Development DB password | `.env.docker` | ✅ Yes |
| Staging API keys | fly.io secrets | N/A (not in repo) |
| Production config | fly.io secrets | N/A (not in repo) |
| Deployment URLs | `.claude/deployment-config.local.json` | ✅ Yes |
| Shopify app credentials | Shopify admin (per customer) | N/A (not in repo) |

### Environment Variables Pattern

**Bad** (hardcoded):
```yaml
POSTGRES_PASSWORD: devpassword
```

**Good** (environment variable):
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

## Deployment Security

### URL Disclosure Prevention

Deployment URLs are **not** public information. They should be:
- Stored in `.claude/deployment-config.local.json` (gitignored)
- Replaced with placeholders in documentation (e.g., `<staging-app>.fly.dev`)
- Never committed to version control

### Multi-Tenant Isolation

Each customer's data is isolated:
1. **Session Isolation**: Sessions stored with `shop` field (e.g., `customer.myshopify.com`)
2. **Token Isolation**: Access tokens are shop-specific
3. **Query Isolation**: App verifies shop domain on every request
4. **App Isolation**: Each customer has their own custom app credentials

### Database Security

- **Encryption at Rest**: Enabled by fly.io PostgreSQL
- **Connection Security**: DATABASE_URL uses SSL
- **Password Rotation**: Change production passwords regularly
- **Backup Encryption**: Backups are encrypted by fly.io

## Access Control

### Fly.io Access

- Enable 2FA on fly.io account
- Limit team access to production environment
- Use `flyctl secrets` for all sensitive configuration
- Regularly audit team access

### Shopify App Access

- Each customer has their own custom app
- Customer can revoke access at any time
- Uninstall webhook automatically cleans up sessions
- Minimal scopes: `write_products` only

## Download Token Security

The app uses secure one-time tokens for file downloads:

✅ **Good Practices**:
- Crypto.randomUUID() for token generation (cryptographically secure)
- One-time use with 60-second reuse window
- 15-minute expiration
- Shop-specific isolation
- Automatic cleanup of expired tokens

⚠️ **Potential Improvements**:
- Add rate limiting to prevent token brute-force
- Add IP-based throttling
- Log suspicious download patterns

## Code Security

### XSS Prevention

- User input is sanitized by Polaris components
- GraphQL queries use parameterized variables
- No `dangerouslySetInnerHTML` usage

### SQL Injection Prevention

- Prisma ORM prevents SQL injection
- All database queries use parameterized statements
- No raw SQL construction from user input

### CSRF Protection

- Shopify App Bridge handles CSRF tokens
- All mutations require valid session
- OAuth flow validates state parameter

## Incident Response

### If a Secret is Committed

1. **Immediately** rotate the compromised secret
2. Review git history: `git log --all --full-history -- path/to/file`
3. Revoke any tokens that may have been exposed
4. Monitor for unauthorized access
5. Consider cleaning git history (see SECURITY_REMEDIATION_PLAN.md)

### If Production URL is Exposed

1. Monitor for unusual traffic patterns
2. Review fly.io access logs
3. Consider changing production app name if actively targeted
4. Ensure all other security measures (2FA, secrets) are strong

### If Customer Data is Compromised

1. Identify affected customer(s) via session logs
2. Notify customer immediately
3. Review audit logs for unauthorized access
4. Rotate customer's access tokens
5. Document incident and remediation steps

## Security Headers

Recommended headers (consider adding to production):

```javascript
// In server.js or middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
```

Or use [helmet.js](https://helmetjs.github.io/):
```bash
npm install helmet
```

## Monitoring & Auditing

### What to Monitor

- Failed authentication attempts
- Unusual download patterns
- Database connection errors
- Unauthorized API calls
- Session creation anomalies

### Log Review Schedule

- **Daily**: Check fly.io logs for errors
- **Weekly**: Review customer sessions and active apps
- **Monthly**: Audit team access and rotate credentials
- **Quarterly**: Security review of codebase changes

## Pre-commit Hooks

Enable security checks before commits:

```bash
# One-time setup
git config core.hooksPath .githooks

# Test it works
echo "password=test123" > test.txt
git add test.txt
git commit -m "test"  # Should be blocked
rm test.txt
```

The pre-commit hook checks for:
- Hardcoded passwords
- API keys and secrets
- Deployment URLs
- Database credentials

## Security Audit Checklist

### Monthly Review

- [ ] Review fly.io access logs
- [ ] Check for failed authentication attempts
- [ ] Audit customer sessions in database
- [ ] Review recent code changes for security issues
- [ ] Verify all secrets are rotated per schedule
- [ ] Check for outdated dependencies: `npm audit`

### Quarterly Review

- [ ] Full security audit of codebase
- [ ] Review and update security documentation
- [ ] Test incident response procedures
- [ ] Review team access and permissions
- [ ] Penetration testing (if resources available)

## Dependency Security

### Keeping Dependencies Updated

```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# View outdated packages
npm outdated

# Update packages
npm update
```

### High-Risk Dependencies

Monitor these packages closely:
- `@shopify/shopify-api` - Core authentication
- `prisma` - Database ORM
- `react-router` - Framework
- `xlsx` - File generation

## Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** open a public issue
2. Contact the maintainer directly via email
3. Provide detailed information about the vulnerability
4. Allow reasonable time for fix before disclosure

## Additional Resources

- [Shopify App Security Best Practices](https://shopify.dev/docs/apps/best-practices/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Fly.io Security Documentation](https://fly.io/docs/reference/security/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## Security Contact

For security concerns, contact: [Your Email Here]

---

**Last Updated**: 2026-01-26
**Security Review**: v1.0
