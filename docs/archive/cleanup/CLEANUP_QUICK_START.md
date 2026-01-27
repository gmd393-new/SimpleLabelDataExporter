# Repository Cleanup - Quick Start Guide

**Status**: Ready to Execute Tomorrow Morning
**Time Required**: 15-20 minutes
**Impact**: Reorganizes 20 .md files from root into organized docs/ directory

## Problem

Root directory has 20 markdown files creating clutter:
- Essential documentation mixed with temporary files
- Claude planning outputs committed to repo
- Session notes and implementation summaries
- Hard to find important docs

## Solution

**Before**: 20 .md files in root (messy)
**After**: 1 .md file in root (clean) + organized docs/ directory

## Quick Execute (Option 1: Automated)

```bash
cd C:\Users\kdd9a\code\ShopifyLabelData\label-data-exporter

# Run the automated cleanup script
./cleanup-repo.sh

# Review changes
git status

# Commit
git commit -m "Reorganize documentation into docs/ directory

- Move all documentation files from root to docs/
- Archive historical records in docs/archive/
- Remove Claude implementation/planning outputs
- Update .gitignore to prevent future clutter

Result: 20 .md files in root → 1 .md file in root (95% reduction)"

# Push
git push origin main
```

## Manual Execute (Option 2: Step by Step)

If you prefer to do it manually, follow these commands:

### Step 1: Create docs/ structure
```bash
mkdir -p docs/archive/deployments
```

### Step 2: Move essential docs
```bash
git mv DEVELOPMENT.md docs/development.md
git mv DEPLOYMENT.md docs/deployment.md
git mv DEPLOYMENT_STRATEGY.md docs/deployment-strategy.md
git mv CUSTOMER_ONBOARDING.md docs/customer-onboarding.md
git mv SECURITY.md docs/security.md
git mv CLAUDE.md docs/claude-instructions.md
git mv PASSWORD_ROTATION_PLAN.md docs/password-rotation.md
git mv ROTATE_PASSWORDS_NOW.md docs/password-rotation-quick-start.md
```

### Step 3: Archive historical records
```bash
git mv DEPLOYMENT_SUCCESS_2026-01-26.md docs/archive/deployments/2026-01-26-production.md
git mv DEPLOYMENT_SUCCESS_2026-01-26_MOBILE_UX.md docs/archive/deployments/2026-01-26-mobile-ux.md
git mv PASSWORD_ROTATION_COMPLETE.md docs/archive/password-rotation-2026-01-26.md
git mv CHANGELOG.md docs/archive/changelog.md
```

### Step 4: Delete Claude outputs
```bash
git rm MOBILE_DOWNLOAD_FIX.md
git rm MOBILE_UX_OPTIMIZATION_PLAN.md
git rm SECURITY_IMPLEMENTATION.md
git rm SECURITY_REMEDIATION_SUMMARY.md
rm -f PHASE_4_IMPLEMENTATION_SUMMARY.md
rm -f PHASE_4_VISUAL_COMPARISON.md
rm -f SESSION_NOTES.md
```

### Step 5: Update .gitignore
```bash
# Add these lines to .gitignore
echo "" >> .gitignore
echo "# Claude Code outputs and planning documents" >> .gitignore
echo "SESSION_NOTES.md" >> .gitignore
echo "PHASE_*.md" >> .gitignore
echo "*_IMPLEMENTATION_SUMMARY.md" >> .gitignore
echo "*_VISUAL_COMPARISON.md" >> .gitignore
echo "DEPLOYMENT_SUCCESS_*.md" >> .gitignore
```

### Step 6: Commit and push
```bash
git add .
git commit -m "Reorganize documentation into docs/ directory"
git push origin main
```

## What Gets Changed

### Files Moved to docs/ (9 files)
- ✅ DEVELOPMENT.md → docs/development.md
- ✅ DEPLOYMENT.md → docs/deployment.md
- ✅ DEPLOYMENT_STRATEGY.md → docs/deployment-strategy.md
- ✅ CUSTOMER_ONBOARDING.md → docs/customer-onboarding.md
- ✅ SECURITY.md → docs/security.md
- ✅ CLAUDE.md → docs/claude-instructions.md
- ✅ PASSWORD_ROTATION_PLAN.md → docs/password-rotation.md
- ✅ ROTATE_PASSWORDS_NOW.md → docs/password-rotation-quick-start.md
- ✅ (NEW) docs/README.md (index)

### Files Archived (4 files)
- ✅ DEPLOYMENT_SUCCESS_2026-01-26.md → docs/archive/deployments/
- ✅ DEPLOYMENT_SUCCESS_2026-01-26_MOBILE_UX.md → docs/archive/deployments/
- ✅ PASSWORD_ROTATION_COMPLETE.md → docs/archive/
- ✅ CHANGELOG.md → docs/archive/

### Files Deleted (6 files)
- ❌ MOBILE_DOWNLOAD_FIX.md (Claude planning output)
- ❌ MOBILE_UX_OPTIMIZATION_PLAN.md (Claude planning output)
- ❌ PHASE_4_IMPLEMENTATION_SUMMARY.md (Claude output)
- ❌ PHASE_4_VISUAL_COMPARISON.md (Claude output)
- ❌ SECURITY_IMPLEMENTATION.md (Claude implementation notes)
- ❌ SECURITY_REMEDIATION_SUMMARY.md (Claude remediation notes)
- ❌ SESSION_NOTES.md (temporary session notes)

### Files Staying in Root (1 file)
- ✅ README.md (standard practice)

## Result

**Before**:
```
label-data-exporter/
├── README.md
├── CLAUDE.md
├── DEPLOYMENT.md
├── DEVELOPMENT.md
├── SECURITY.md
├── DEPLOYMENT_SUCCESS_2026-01-26.md
├── PHASE_4_IMPLEMENTATION_SUMMARY.md
├── SESSION_NOTES.md
└── [12 more .md files...]
```

**After**:
```
label-data-exporter/
├── README.md
├── docs/
│   ├── README.md (documentation index)
│   ├── development.md
│   ├── deployment.md
│   ├── security.md
│   ├── [5 more docs...]
│   └── archive/
│       ├── deployments/
│       └── [historical records]
└── app/
```

## Verification

After running cleanup, verify:

```bash
# Should show only README.md
ls *.md

# Should show organized docs
ls docs/*.md

# Should show updated .gitignore
tail -10 .gitignore
```

Expected:
- ✅ Root has only README.md
- ✅ docs/ has 8 organized documentation files
- ✅ docs/archive/ has historical records
- ✅ .gitignore prevents future clutter

## Best Practices Followed

✅ **Clean root directory** - Only README.md in root (industry standard)
✅ **Organized documentation** - All docs in docs/ directory
✅ **Clear naming** - Lowercase with hyphens (deployment.md not DEPLOYMENT.md)
✅ **Archive historical** - Keep records but separate from active docs
✅ **Remove temp files** - Don't commit planning/implementation outputs
✅ **Prevent future clutter** - .gitignore rules for common patterns

## References

See `REPO_CLEANUP_PLAN.md` for:
- Detailed rationale for each decision
- Industry best practices and examples
- Alternative cleanup options
- Maintenance guidelines going forward

## Time Estimate

- **Automated (Option 1)**: 5 minutes
  - Run script (1 min)
  - Review (2 min)
  - Commit & push (2 min)

- **Manual (Option 2)**: 15-20 minutes
  - Execute commands (10 min)
  - Verify structure (5 min)
  - Commit & push (5 min)

**Recommendation**: Use Option 1 (automated) - it's faster and less error-prone.

---

**Created**: 2026-01-26
**Status**: Ready to Execute
**Next Step**: Run `./cleanup-repo.sh` tomorrow morning
