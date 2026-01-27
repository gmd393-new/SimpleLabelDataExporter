# Repository Cleanup Plan

**Created**: 2026-01-26
**Status**: Ready for Review

## Problem Statement

The repository root has accumulated 20+ markdown files, many of which are:
- Claude planning/implementation outputs
- Session notes and temporary documentation
- Redundant deployment success logs
- Files that should be in a docs/ directory

This violates best practices for clean repository organization.

## Best Practices for Repository Organization

### Industry Standards

**Root Directory Should Contain**:
- README.md (project overview)
- LICENSE (if applicable)
- .gitignore
- Configuration files (package.json, tsconfig.json, etc.)
- Source directories (app/, prisma/, etc.)
- docs/ directory for all documentation

**Root Directory Should NOT Contain**:
- Multiple documentation files (move to docs/)
- Planning/implementation notes (archive or delete)
- Session notes (never commit)
- Temporary/work-in-progress files

### Reference Examples

**Good Repository Structure**:
```
project/
├── README.md              # Project overview
├── LICENSE
├── package.json
├── .gitignore
├── docs/                  # All documentation
│   ├── deployment.md
│   ├── development.md
│   └── security.md
├── app/                   # Application code
├── prisma/               # Database schemas
└── tests/                # Test files
```

**Bad Repository Structure** (Current State):
```
project/
├── README.md
├── CLAUDE.md
├── DEPLOYMENT.md
├── DEPLOYMENT_SUCCESS_*.md
├── PHASE_4_*.md
├── SESSION_NOTES.md
├── [15+ other .md files]
└── app/
```

## Current File Inventory (20 .md files)

### Category 1: Essential Documentation (KEEP in docs/)
1. **README.md** - Keep in root (standard)
2. **DEVELOPMENT.md** - Development setup guide
3. **DEPLOYMENT.md** - Deployment procedures
4. **CUSTOMER_ONBOARDING.md** - Customer setup guide
5. **SECURITY.md** - Security guidelines
6. **CLAUDE.md** - Instructions for Claude Code

### Category 2: Useful Reference (KEEP in docs/)
7. **DEPLOYMENT_STRATEGY.md** - Architecture overview
8. **PASSWORD_ROTATION_PLAN.md** - Password rotation procedures
9. **ROTATE_PASSWORDS_NOW.md** - Quick rotation guide

### Category 3: Historical Records (ARCHIVE in docs/archive/)
10. **DEPLOYMENT_SUCCESS_2026-01-26.md** - Deployment log
11. **DEPLOYMENT_SUCCESS_2026-01-26_MOBILE_UX.md** - Deployment log
12. **PASSWORD_ROTATION_COMPLETE.md** - Rotation completion log
13. **CHANGELOG.md** - Change history (consider consolidating)

### Category 4: Implementation Notes (ARCHIVE or DELETE)
14. **MOBILE_DOWNLOAD_FIX.md** - Claude planning output
15. **MOBILE_UX_OPTIMIZATION_PLAN.md** - Claude planning output
16. **PHASE_4_IMPLEMENTATION_SUMMARY.md** - Claude output
17. **PHASE_4_VISUAL_COMPARISON.md** - Claude output
18. **SECURITY_IMPLEMENTATION.md** - Claude implementation notes
19. **SECURITY_REMEDIATION_SUMMARY.md** - Claude remediation notes

### Category 5: Temporary Files (DELETE - should never be committed)
20. **SESSION_NOTES.md** - Temporary session notes

## Proposed Directory Structure

```
label-data-exporter/
├── README.md                          # Keep in root
├── package.json
├── .gitignore
├── docker-compose.yml
├── fly.toml
├── fly.production.toml
│
├── docs/                              # NEW: All documentation
│   ├── README.md                      # Documentation index
│   ├── development.md                 # From DEVELOPMENT.md
│   ├── deployment.md                  # From DEPLOYMENT.md
│   ├── deployment-strategy.md         # From DEPLOYMENT_STRATEGY.md
│   ├── customer-onboarding.md         # From CUSTOMER_ONBOARDING.md
│   ├── security.md                    # From SECURITY.md
│   ├── password-rotation.md           # From PASSWORD_ROTATION_PLAN.md
│   ├── claude-instructions.md         # From CLAUDE.md
│   │
│   └── archive/                       # Historical records
│       ├── deployments/
│       │   ├── 2026-01-26-production.md
│       │   └── 2026-01-26-mobile-ux.md
│       ├── password-rotation-2026-01-26.md
│       └── changelog.md
│
├── app/                               # Application code
├── prisma/                            # Database schemas
├── .githooks/                         # Git hooks
└── .claude/                           # Claude Code settings (gitignored)
```

## Cleanup Actions

### Phase 1: Create Documentation Structure

```bash
# Create docs directory structure
mkdir -p docs/archive/deployments

# Create docs index
cat > docs/README.md << 'EOF'
# Documentation

This directory contains all project documentation.

## Quick Links

- [Development Setup](./development.md) - Local development guide
- [Deployment](./deployment.md) - Deployment procedures
- [Customer Onboarding](./customer-onboarding.md) - Adding new customers
- [Security](./security.md) - Security guidelines and best practices
- [Password Rotation](./password-rotation.md) - Password rotation procedures

## Architecture

- [Deployment Strategy](./deployment-strategy.md) - Three-tier architecture overview

## For Claude Code

- [Claude Instructions](./claude-instructions.md) - Instructions for Claude Code AI

## Archive

Historical records and deprecated documentation: [archive/](./archive/)
EOF
```

### Phase 2: Move Essential Documentation

```bash
# Move essential docs to docs/ directory
git mv DEVELOPMENT.md docs/development.md
git mv DEPLOYMENT.md docs/deployment.md
git mv DEPLOYMENT_STRATEGY.md docs/deployment-strategy.md
git mv CUSTOMER_ONBOARDING.md docs/customer-onboarding.md
git mv SECURITY.md docs/security.md
git mv CLAUDE.md docs/claude-instructions.md

# Move password rotation docs
git mv PASSWORD_ROTATION_PLAN.md docs/password-rotation.md
git mv ROTATE_PASSWORDS_NOW.md docs/password-rotation-quick-start.md
```

### Phase 3: Archive Historical Records

```bash
# Move deployment success logs to archive
git mv DEPLOYMENT_SUCCESS_2026-01-26.md docs/archive/deployments/2026-01-26-production.md
git mv DEPLOYMENT_SUCCESS_2026-01-26_MOBILE_UX.md docs/archive/deployments/2026-01-26-mobile-ux.md

# Move completed rotation log to archive
git mv PASSWORD_ROTATION_COMPLETE.md docs/archive/password-rotation-2026-01-26.md

# Move changelog to archive (if you want to keep it)
git mv CHANGELOG.md docs/archive/changelog.md
```

### Phase 4: Remove Claude Implementation Notes

These are temporary planning/implementation outputs that aren't needed in the repo:

```bash
# Delete Claude planning/implementation files
git rm MOBILE_DOWNLOAD_FIX.md
git rm MOBILE_UX_OPTIMIZATION_PLAN.md
git rm PHASE_4_IMPLEMENTATION_SUMMARY.md
git rm PHASE_4_VISUAL_COMPARISON.md
git rm SECURITY_IMPLEMENTATION.md
git rm SECURITY_REMEDIATION_SUMMARY.md
```

**Rationale**: These files document the implementation process but aren't needed for:
- Understanding the codebase (code is self-documenting + comments)
- Using the application (covered in user docs)
- Deploying/maintaining (covered in deployment docs)

### Phase 5: Delete Temporary Files

```bash
# Delete session notes (should never be committed)
git rm SESSION_NOTES.md

# Also delete any other untracked temporary files
rm -f PHASE_4_IMPLEMENTATION_SUMMARY.md
rm -f PHASE_4_VISUAL_COMPARISON.md
rm -f SESSION_NOTES.md
```

### Phase 6: Update .gitignore

```bash
# Add to .gitignore to prevent future clutter
cat >> .gitignore << 'EOF'

# Claude Code outputs and session notes
SESSION_NOTES.md
PHASE_*.md
*_IMPLEMENTATION_SUMMARY.md
*_VISUAL_COMPARISON.md
PLAN_*.md

# Temporary documentation
*.tmp.md
*.draft.md
EOF
```

### Phase 7: Update Root README.md

Update README.md to reference the docs/ directory:

```markdown
## Documentation

All project documentation is in the [`docs/`](./docs/) directory:

- **[Development Setup](./docs/development.md)** - Getting started with local development
- **[Deployment Guide](./docs/deployment.md)** - Deploying to staging and production
- **[Security](./docs/security.md)** - Security guidelines and best practices

See [docs/README.md](./docs/README.md) for the complete documentation index.
```

### Phase 8: Update Internal References

Update any internal links that reference old file locations:

**Files to update**:
- docs/development.md - Update links to other docs
- docs/deployment.md - Update links to other docs
- docs/deployment-strategy.md - Update links to other docs
- docs/security.md - Update links to other docs

**Find and replace**:
```bash
# Find all internal markdown links
grep -r "DEPLOYMENT.md" docs/
grep -r "SECURITY.md" docs/
grep -r "CLAUDE.md" docs/

# Replace with new paths
# [DEPLOYMENT.md](./DEPLOYMENT.md) -> [deployment guide](./deployment.md)
```

## Benefits of Cleanup

### Before (Current State)
```
❌ 20 .md files in root directory
❌ Mix of documentation, planning, and temporary files
❌ Hard to find essential documentation
❌ Cluttered root makes project look messy
❌ New contributors confused by file organization
```

### After (Cleaned Up)
```
✅ Clean root directory (only README.md)
✅ All docs organized in docs/ directory
✅ Clear separation: essential vs archive vs deleted
✅ Professional appearance
✅ Easy for contributors to navigate
✅ Prevents future clutter with .gitignore rules
```

## Files Summary

### Keep in Root (1 file)
- README.md

### Move to docs/ (9 files)
- DEVELOPMENT.md → docs/development.md
- DEPLOYMENT.md → docs/deployment.md
- DEPLOYMENT_STRATEGY.md → docs/deployment-strategy.md
- CUSTOMER_ONBOARDING.md → docs/customer-onboarding.md
- SECURITY.md → docs/security.md
- CLAUDE.md → docs/claude-instructions.md
- PASSWORD_ROTATION_PLAN.md → docs/password-rotation.md
- ROTATE_PASSWORDS_NOW.md → docs/password-rotation-quick-start.md
- (NEW) docs/README.md

### Archive in docs/archive/ (4 files)
- DEPLOYMENT_SUCCESS_2026-01-26.md → docs/archive/deployments/2026-01-26-production.md
- DEPLOYMENT_SUCCESS_2026-01-26_MOBILE_UX.md → docs/archive/deployments/2026-01-26-mobile-ux.md
- PASSWORD_ROTATION_COMPLETE.md → docs/archive/password-rotation-2026-01-26.md
- CHANGELOG.md → docs/archive/changelog.md

### Delete from Repo (6 files)
- MOBILE_DOWNLOAD_FIX.md
- MOBILE_UX_OPTIMIZATION_PLAN.md
- PHASE_4_IMPLEMENTATION_SUMMARY.md
- PHASE_4_VISUAL_COMPARISON.md
- SECURITY_IMPLEMENTATION.md
- SECURITY_REMEDIATION_SUMMARY.md
- SESSION_NOTES.md

**Total**: 20 → 1 file in root (95% reduction)

## Execution Plan

### Option A: All at Once (Recommended)
Execute all phases in one session and commit:

```bash
# Execute Phase 1-8
# Then commit
git add .
git commit -m "Reorganize documentation into docs/ directory

- Move all documentation files from root to docs/
- Archive historical records in docs/archive/
- Remove Claude implementation/planning outputs
- Update .gitignore to prevent future clutter
- Update internal documentation links

Benefits:
- Clean root directory (only README.md)
- Professional repository structure
- Easy navigation for contributors
- Prevents future documentation clutter

Files: 20 .md files in root → 1 .md file in root (95% reduction)"
```

### Option B: Gradual (Safer)
Execute in three separate commits:

1. **Commit 1: Create structure and move docs**
   - Phase 1-2 (create docs/, move essential files)

2. **Commit 2: Archive and cleanup**
   - Phase 3-5 (archive historical, delete temporary)

3. **Commit 3: Finalize**
   - Phase 6-8 (update .gitignore, README, fix links)

## Maintenance Going Forward

### Do's
✅ Keep README.md in root
✅ Put all documentation in docs/
✅ Use descriptive filenames (lowercase with hyphens)
✅ Create docs/archive/ for historical records
✅ Update docs/README.md when adding new documentation

### Don'ts
❌ Don't commit Claude planning outputs
❌ Don't commit session notes
❌ Don't commit temporary/work-in-progress .md files
❌ Don't put multiple documentation files in root
❌ Don't commit files with PHASE_*, *_SUMMARY.md patterns

### .gitignore Rules to Add

```gitignore
# Claude Code outputs and planning documents
SESSION_NOTES.md
PHASE_*.md
*_IMPLEMENTATION_SUMMARY.md
*_VISUAL_COMPARISON.md
*_OPTIMIZATION_PLAN.md
PLAN_*.md

# Temporary documentation
*.tmp.md
*.draft.md
*.wip.md

# Archive before committing
DEPLOYMENT_SUCCESS_*.md
```

## Verification Checklist

After cleanup:

- [ ] Root directory contains only README.md (plus config files)
- [ ] All docs in docs/ directory with clear organization
- [ ] docs/README.md provides documentation index
- [ ] Internal links updated to new paths
- [ ] .gitignore prevents future clutter
- [ ] All commits pushed to remote
- [ ] README.md references docs/ directory
- [ ] No broken links in documentation
- [ ] Archive directory contains historical records
- [ ] Claude implementation outputs removed

## Alternative: Minimal Cleanup

If full reorganization is too much work, minimal cleanup:

### Keep (in root)
- README.md
- DEVELOPMENT.md
- DEPLOYMENT.md
- SECURITY.md
- CLAUDE.md

### Delete
- All PHASE_*.md files
- All *_IMPLEMENTATION_*.md files
- SESSION_NOTES.md
- DEPLOYMENT_SUCCESS_*.md (move info to CHANGELOG if needed)
- MOBILE_*.md planning files

### Archive (create docs/archive/)
- CHANGELOG.md
- PASSWORD_ROTATION_COMPLETE.md

**Result**: 20 files → 5-7 files (65-70% reduction)

## Recommended Approach

**For tonight**: Create the plan (this file)

**Tomorrow morning**:
1. Review the plan
2. Execute Option A (all at once) - takes 15-20 minutes
3. Verify links and structure
4. Commit and push

**Estimated time**: 20-30 minutes total

---

**Status**: Plan Complete - Ready for Review and Execution
**Next Step**: Review plan and execute cleanup (recommend Option A - all at once)
