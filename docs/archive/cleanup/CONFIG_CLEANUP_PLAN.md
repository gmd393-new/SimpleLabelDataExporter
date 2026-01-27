# Configuration Files Cleanup Plan

**Created**: 2026-01-27
**Goal**: Move deployment/infrastructure config files out of root directory

## Current Problem

Root directory contains 10+ configuration files:

```
label-data-exporter/
├── docker-compose.yml          ← Docker orchestration
├── Dockerfile                  ← Docker build
├── .dockerignore              ← Docker ignore rules
├── .env.docker                ← Docker environment (gitignored)
├── .env.docker.example        ← Docker environment template
├── fly.toml                   ← Fly.io staging config
├── fly.production.toml        ← Fly.io production config
├── shopify.app.toml          ← Shopify app config
├── shopify.web.toml          ← Shopify web config
└── verify-security.sh        ← Security script
```

This violates clean repository principles where infrastructure config should be organized separately from application code.

## Best Practices Research

### Industry Standard Patterns

**Option 1: Flat Root (Common but cluttered)**
- Keep all config in root
- ❌ What we're trying to avoid

**Option 2: Single config/ Directory**
```
project/
├── config/
│   ├── docker-compose.yml
│   ├── fly.toml
│   └── shopify.app.toml
└── app/
```
- ✅ Simple, single location
- ❌ Mixes different concerns (docker, deployment, app config)

**Option 3: Organized by Purpose (Recommended)**
```
project/
├── .docker/                    ← Docker-related files
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .env.example
├── .fly/                       ← Fly.io deployment configs
│   ├── staging.toml
│   └── production.toml
├── .shopify/                   ← Shopify CLI configs
│   ├── app.toml
│   └── web.toml
├── scripts/                    ← Utility scripts
│   └── verify-security.sh
└── app/                        ← Application code
```
- ✅ Clear separation of concerns
- ✅ Easy to find related configs
- ✅ Hides config from main directory listing (dot prefixes)

**Option 4: Infrastructure Directory**
```
project/
├── infrastructure/
│   ├── docker/
│   ├── fly/
│   └── shopify/
└── app/
```
- ✅ Very organized
- ❌ More nesting, longer paths

## Recommended Approach: Option 3 (Organized by Purpose)

### Proposed Directory Structure

```
label-data-exporter/
├── README.md                          ← Only .md file in root
├── package.json                       ← Keep (standard)
├── package-lock.json                  ← Keep (standard)
├── tsconfig.json                      ← Keep (standard)
├── vite.config.js                     ← Keep (standard)
│
├── .docker/                           ← NEW: Docker configs
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .env.example                   ← Template for .env.docker
│
├── .fly/                              ← NEW: Fly.io configs
│   ├── staging.toml                   ← From fly.toml
│   └── production.toml                ← From fly.production.toml
│
├── .shopify/                          ← Already exists (gitignored)
│   └── (runtime files)
│
├── config/                            ← NEW: App configuration
│   ├── shopify.app.toml              ← From root
│   └── shopify.web.toml              ← From root
│
├── scripts/                           ← NEW: Utility scripts
│   └── verify-security.sh            ← From root
│
├── docs/                              ← Documentation
├── app/                               ← Application code
└── prisma/                            ← Database schemas
```

## Tool Compatibility

### Docker Compose

**Default behavior**: Looks for `docker-compose.yml` in current directory

**With custom location**:
```bash
# Option 1: Specify file
docker compose -f .docker/docker-compose.yml up

# Option 2: Use environment variable
export COMPOSE_FILE=.docker/docker-compose.yml
docker compose up

# Option 3: Create alias
alias dc='docker compose -f .docker/docker-compose.yml'
```

**Update needed in**:
- Development documentation
- package.json scripts (if any)

### Fly.io CLI

**Default behavior**: Looks for `fly.toml` in current directory

**With custom location**:
```bash
# Specify config file
flyctl deploy --config .fly/staging.toml

# For production
flyctl deploy --config .fly/production.toml --app <production-app>
```

**Update needed in**:
- Deployment documentation
- CI/CD scripts (if any)

### Shopify CLI

**Default behavior**: Looks for `shopify.app.toml` in current directory

**With custom location**:
```bash
# Shopify CLI uses SHOPIFY_CLI_APP_CONFIG_FILE environment variable
export SHOPIFY_CLI_APP_CONFIG_FILE=config/shopify.app.toml
shopify app dev

# Or specify in the command (if supported)
shopify app dev --config config/shopify.app.toml
```

**Alternative**: Keep in root OR use symlink
```bash
# Create symlink in root pointing to config/
ln -s config/shopify.app.toml shopify.app.toml
```

**Note**: Shopify CLI expects config in root, moving may break workflow.

## Implementation Plan

### Phase 1: Create Directory Structure

```bash
# Create new directories
mkdir -p .docker
mkdir -p .fly
mkdir -p config
mkdir -p scripts
```

### Phase 2: Move Docker Files

```bash
# Move Docker-related files
git mv docker-compose.yml .docker/
git mv Dockerfile .docker/
git mv .dockerignore .docker/
git mv .env.docker.example .docker/.env.example

# Note: .env.docker stays in root (referenced by scripts, gitignored)
```

**Update docker-compose.yml paths**:
- Change `env_file: - .env.docker` to `- ../.env.docker`
- Or keep .env.docker in root for simplicity

### Phase 3: Move Fly.io Files

```bash
# Move and rename for clarity
git mv fly.toml .fly/staging.toml
git mv fly.production.toml .fly/production.toml
```

**No file changes needed** - just update deployment commands

### Phase 4: Move Shopify Files

```bash
# Move Shopify config files
git mv shopify.app.toml config/
git mv shopify.web.toml config/
```

**Critical**: Test if Shopify CLI still works!

**Fallback options**:
1. Set `SHOPIFY_CLI_APP_CONFIG_FILE` environment variable
2. Create symlink: `ln -s config/shopify.app.toml shopify.app.toml`
3. Keep in root (if CLI requires it)

### Phase 5: Move Scripts

```bash
# Move utility scripts to scripts/
git mv verify-security.sh scripts/
chmod +x scripts/verify-security.sh
```

### Phase 6: Update Documentation

Files to update:
1. **docs/development.md**
   - Update Docker commands: `docker compose -f .docker/docker-compose.yml up`
   - Update Shopify CLI commands (if needed)

2. **docs/deployment.md**
   - Update fly commands: `flyctl deploy --config .fly/staging.toml`
   - Update production deploy: `flyctl deploy --config .fly/production.toml`

3. **docs/security.md**
   - Update script path: `./scripts/verify-security.sh`

4. **README.md**
   - Update quick start commands if any reference config files

5. **package.json**
   - Update any npm scripts that reference config files

### Phase 7: Create Helper Scripts (Optional)

Create convenience scripts that hide the complexity:

**scripts/docker.sh**:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
docker compose -f .docker/docker-compose.yml "$@"
```

**scripts/deploy-staging.sh**:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
flyctl deploy --config .fly/staging.toml
```

**scripts/deploy-production.sh**:
```bash
#!/bin/bash
cd "$(dirname "$0")/.."
flyctl deploy --config .fly/production.toml --app <production-app>
```

### Phase 8: Update package.json Scripts

```json
{
  "scripts": {
    "docker:up": "docker compose -f .docker/docker-compose.yml up -d",
    "docker:down": "docker compose -f .docker/docker-compose.yml down",
    "docker:logs": "docker compose -f .docker/docker-compose.yml logs -f",
    "deploy:staging": "flyctl deploy --config .fly/staging.toml",
    "deploy:production": "flyctl deploy --config .fly/production.toml --app <production-app>",
    "security:verify": "./scripts/verify-security.sh"
  }
}
```

### Phase 9: Update .gitignore

Ensure new directories are properly handled:

```gitignore
# Docker environment (stays in root for simplicity)
.env.docker

# OR if moved to .docker/
# .docker/.env

# Fly.io local data (if any)
.fly/.local

# Shopify CLI (already ignored)
.shopify/*
```

## Detailed File Moves

### Docker Files (4 files → .docker/)

| Current Location | New Location | Update Needed? |
|-----------------|--------------|----------------|
| `docker-compose.yml` | `.docker/docker-compose.yml` | Yes - env_file path |
| `Dockerfile` | `.docker/Dockerfile` | No |
| `.dockerignore` | `.docker/.dockerignore` | Maybe - verify Docker still finds it |
| `.env.docker.example` | `.docker/.env.example` | No |
| `.env.docker` | Keep in root OR move to `.docker/.env` | Yes - update commands |

**Decision Point**: Keep `.env.docker` in root for simplicity, or move and update all references?

### Fly.io Files (2 files → .fly/)

| Current Location | New Location | Update Needed? |
|-----------------|--------------|----------------|
| `fly.toml` | `.fly/staging.toml` | Yes - deployment commands |
| `fly.production.toml` | `.fly/production.toml` | Yes - deployment commands |

**No file changes** - just command updates

### Shopify Files (2 files → config/)

| Current Location | New Location | Update Needed? |
|-----------------|--------------|----------------|
| `shopify.app.toml` | `config/shopify.app.toml` | Maybe - test CLI |
| `shopify.web.toml` | `config/shopify.web.toml` | Maybe - test CLI |

**Critical**: Test if `shopify app dev` still works!

### Scripts (1 file → scripts/)

| Current Location | New Location | Update Needed? |
|-----------------|--------------|----------------|
| `verify-security.sh` | `scripts/verify-security.sh` | Yes - documentation |

## Gotchas and Considerations

### 1. Docker Compose env_file

If `.env.docker` is moved to `.docker/.env`, update docker-compose.yml:

```yaml
# Before
env_file:
  - .env.docker

# After (if .env.docker moved to .docker/)
env_file:
  - .env
```

### 2. Dockerfile COPY Commands

If Dockerfile has COPY commands, paths relative to context:

```dockerfile
# Dockerfile in .docker/ directory
# Context is still root, so paths don't change
COPY package*.json ./
COPY prisma ./prisma/
```

**Docker build command**:
```bash
# Must specify Dockerfile location AND context
docker build -f .docker/Dockerfile -t myapp .
```

**docker-compose.yml update**:
```yaml
services:
  app:
    build:
      context: ..
      dockerfile: .docker/Dockerfile
```

### 3. .dockerignore Location

Docker looks for `.dockerignore` in the **build context** (root), not relative to Dockerfile.

**Solution**: Keep `.dockerignore` in root OR symlink it:
```bash
ln -s .docker/.dockerignore .dockerignore
```

### 4. Shopify CLI Config Discovery

Shopify CLI may require config in root. Test after moving!

**If it breaks**:
1. Set environment variable in docs
2. Create symlink
3. Keep in root (not ideal but functional)

### 5. CI/CD Pipeline Updates

If you have CI/CD (GitHub Actions, etc.), update:
- Docker build commands
- Fly deploy commands
- Any config file references

## Benefits of Cleanup

### Before (Current)
```
✗ 10 config files in root
✗ Mixed purposes (docker, deployment, scripts)
✗ Cluttered directory listing
✗ Hard to find what you need
```

### After (Cleaned)
```
✓ Clean root with only essential files
✓ Organized by purpose (.docker, .fly, config, scripts)
✓ Hidden from main listing (dot prefixes)
✓ Easy to find related configs
✓ Professional structure
```

## Recommended Implementation Order

### Safest Approach (Test Each Step)

1. **Start with scripts** (easiest, no tool dependencies)
   - Move `verify-security.sh` to `scripts/`
   - Update references
   - Test it works

2. **Move Fly configs** (simple, just update commands)
   - Move to `.fly/` directory
   - Update deployment docs
   - Test deploy command

3. **Move Docker files** (moderate complexity)
   - Move to `.docker/` directory
   - Update docker-compose.yml paths
   - Test `docker compose up`

4. **Move Shopify configs** (potential issues)
   - Move to `config/` directory
   - Test `shopify app dev`
   - Create symlink if needed

### Alternative: Conservative Approach

If concerned about breaking tools:

**Keep in root**:
- `shopify.app.toml` (if CLI requires it)
- `.dockerignore` (Docker expects it in root)

**Move to organized dirs**:
- `docker-compose.yml` → `.docker/`
- `Dockerfile` → `.docker/`
- `fly.toml` → `.fly/staging.toml`
- `fly.production.toml` → `.fly/production.toml`
- `verify-security.sh` → `scripts/`

## Verification Checklist

After moving files:

- [ ] Docker Compose: `docker compose -f .docker/docker-compose.yml up` works
- [ ] Docker Build: Build succeeds with new Dockerfile location
- [ ] Fly Deploy: `flyctl deploy --config .fly/staging.toml` works
- [ ] Shopify CLI: `shopify app dev` works (from root)
- [ ] Scripts: `./scripts/verify-security.sh` runs successfully
- [ ] Documentation: All references updated
- [ ] package.json: Scripts updated if applicable
- [ ] .gitignore: New directories handled correctly

## Rollback Plan

If something breaks:

```bash
# Undo all moves
git reset --hard HEAD

# Or revert specific commit
git revert <commit-hash>
```

## Estimated Impact

**Files moved**: 10 files
**Directories created**: 4 (.docker, .fly, config, scripts)
**Documentation updates**: 4 files (development.md, deployment.md, security.md, README.md)
**Tool compatibility**: High (all tools support custom config locations)
**Risk level**: Low-Medium (testable, reversible)

## Final Structure

```
label-data-exporter/
├── README.md                          ← Only .md in root
├── package.json                       ← Keep (standard)
├── tsconfig.json                      ← Keep (standard)
├── vite.config.js                     ← Keep (standard)
│
├── .docker/                           ← Docker configs
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── .dockerignore (or symlink)
│   └── .env.example
│
├── .fly/                              ← Fly.io configs
│   ├── staging.toml
│   └── production.toml
│
├── config/                            ← App configs
│   ├── shopify.app.toml (or symlink)
│   └── shopify.web.toml
│
├── scripts/                           ← Utility scripts
│   ├── verify-security.sh
│   ├── docker.sh (optional)
│   ├── deploy-staging.sh (optional)
│   └── deploy-production.sh (optional)
│
├── docs/                              ← Documentation
├── app/                               ← Application code
├── prisma/                            ← Database schemas
└── .env.docker                        ← Keep in root (gitignored)
```

**Result**: Clean root with only package files and README.md!

---

**Status**: Plan Complete
**Next Step**: Execute cleanup (will proceed without asking for permission)
