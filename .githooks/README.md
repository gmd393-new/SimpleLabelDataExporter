# Git Hooks

This directory contains custom git hooks to prevent security issues.

## Setup

To enable these hooks, run:

```bash
git config core.hooksPath .githooks
```

## Pre-commit Hook

The pre-commit hook prevents:
- Hardcoded passwords (e.g., `password=secret123`)
- API keys and secrets (e.g., `api_key=abc123`)
- Deployment URLs (e.g., `simplelabeldataexporter.fly.dev`)
- Database passwords (e.g., `POSTGRES_PASSWORD: devpassword`)

### Testing the Hook

Try committing a file with `password=test123` - it should be blocked.

### Bypassing the Hook (Emergency Only)

If you need to bypass the hook (not recommended):
```bash
git commit --no-verify -m "message"
```

## Maintenance

To update the hook:
1. Edit `.githooks/pre-commit`
2. Test locally before committing
3. Commit changes to the repository
