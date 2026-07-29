#!/bin/bash

# Security Verification Script
# Run this script to verify all security measures are in place

echo "========================================="
echo "Security Verification Script"
echo "========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
WARN=0

# Function to print test result
print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $2"
        ((PASS++))
    else
        echo -e "${RED}✗${NC} $2"
        ((FAIL++))
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
    ((WARN++))
}

echo "1. Checking .gitignore configuration..."
echo "----------------------------------------"

# Check if .env.docker is gitignored
if git check-ignore -q .env.docker; then
    print_result 0 ".env.docker is gitignored"
else
    print_result 1 ".env.docker is NOT gitignored (CRITICAL)"
fi

# Check if deployment-config.local.json is gitignored
if git check-ignore -q .claude/deployment-config.local.json; then
    print_result 0 ".claude/deployment-config.local.json is gitignored"
else
    print_result 1 ".claude/deployment-config.local.json is NOT gitignored (CRITICAL)"
fi

# Check if .env.docker.example is tracked
if ! git check-ignore -q .env.docker.example; then
    print_result 0 ".env.docker.example is tracked (should be in repo)"
else
    print_result 1 ".env.docker.example is gitignored (should be tracked)"
fi

echo ""
echo "2. Checking required files exist..."
echo "----------------------------------------"

# Check if .env.docker exists
if [ -f .env.docker ]; then
    print_result 0 ".env.docker exists"
else
    print_result 1 ".env.docker does NOT exist (run: cp .env.docker.example .env.docker)"
fi

# Check if deployment-config.local.json exists
if [ -f .claude/deployment-config.local.json ]; then
    print_result 0 ".claude/deployment-config.local.json exists"
else
    print_warning ".claude/deployment-config.local.json does NOT exist (optional)"
fi

# Check if pre-commit hook exists
if [ -f .githooks/pre-commit ]; then
    print_result 0 ".githooks/pre-commit exists"
else
    print_result 1 ".githooks/pre-commit does NOT exist"
fi

echo ""
echo "3. Checking git hooks configuration..."
echo "----------------------------------------"

# Check if git hooks path is configured
HOOKS_PATH=$(git config core.hooksPath)
if [ "$HOOKS_PATH" = ".githooks" ]; then
    print_result 0 "Git hooks path configured (.githooks)"
else
    print_result 1 "Git hooks path NOT configured (run: git config core.hooksPath .githooks)"
fi

# Check if pre-commit hook is executable (Unix-like systems only)
if [ -x .githooks/pre-commit ] || [ "$(uname -s)" = "MINGW"* ] || [ "$(uname -s)" = "MSYS"* ]; then
    print_result 0 "Pre-commit hook is executable"
else
    print_result 1 "Pre-commit hook is NOT executable (run: chmod +x .githooks/pre-commit)"
fi

echo ""
echo "4. Checking for hardcoded secrets in tracked files..."
echo "----------------------------------------"

# Search for the old rotated password in real config, not in prose about it.
# Markdown, scripts, and .githooks are excluded because security documentation, this
# script's own grep pattern, and the hook's detection rules all legitimately contain
# the string they exist to warn about. Without these exclusions the check always
# fails, which trains everyone to ignore it. Mirrors the pre-commit hook's own
# *.md / *.sh exclusions.
if git grep -i "postgres_password.*devpassword" -- \
        ':(exclude).env.docker' \
        ':(exclude).env.docker.example' \
        ':(exclude).githooks/*' \
        ':(exclude)scripts/*' \
        ':(exclude)*.md' >/dev/null 2>&1; then
    print_result 1 "Found hardcoded password 'devpassword' in tracked config"
else
    print_result 0 "No hardcoded 'devpassword' in tracked config"
fi

# Search for deployment URLs in tracked files (excluding comments and examples)
STAGED_URL_COUNT=$(git diff --cached --diff-filter=ACM | grep -c "simplelabel.*\.fly\.dev" || true)
if [ "$STAGED_URL_COUNT" -gt 0 ]; then
    print_result 1 "Found deployment URLs in staged files"
else
    print_result 0 "No deployment URLs in staged files"
fi

echo ""
echo "5. Checking Docker configuration..."
echo "----------------------------------------"

COMPOSE_FILE=".docker/docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
    print_result 1 "$COMPOSE_FILE not found"
else
    # Check if docker-compose uses env_file
    if grep -q "env_file:" "$COMPOSE_FILE"; then
        print_result 0 "docker-compose.yml uses env_file for environment variables"
    else
        print_result 1 "docker-compose.yml does NOT use env_file"
    fi

    # Docker may not be installed or running; that is not a security failure.
    if ! command -v docker >/dev/null 2>&1; then
        print_warning "docker not installed — skipping compose validation"
    elif ! docker info >/dev/null 2>&1; then
        print_warning "docker daemon not running — skipping compose validation"
    else
        if docker compose -f "$COMPOSE_FILE" config >/dev/null 2>&1; then
            print_result 0 "Docker Compose configuration is valid"
        else
            print_result 1 "Docker Compose configuration is INVALID"
        fi

        # Check the password actually comes from .env.docker
        if [ -f .env.docker ]; then
            LOADED_PASSWORD=$(docker compose -f "$COMPOSE_FILE" config 2>/dev/null | grep "POSTGRES_PASSWORD:" | awk '{print $2}')
            EXPECTED_PASSWORD=$(grep "POSTGRES_PASSWORD=" .env.docker | cut -d'=' -f2)

            if [ -n "$LOADED_PASSWORD" ] && [ "$LOADED_PASSWORD" = "$EXPECTED_PASSWORD" ]; then
                print_result 0 "Docker Compose loads password from .env.docker"
            else
                print_result 1 "Docker Compose does NOT load password from .env.docker"
            fi
        fi
    fi
fi

echo ""
echo "6. Testing pre-commit hook..."
echo "----------------------------------------"

# The hook reads `git diff --cached`, so exercising it requires staging a file —
# but NOT committing one. An earlier version of this script ran
# `git commit --no-verify`, which actually committed, leaving a junk commit
# containing a fake secret on whatever branch you happened to be on. Stage, invoke
# the hook directly, then unstage.

TEST_FILE=".security-check-tmp.txt"

cleanup_hook_test() {
    git reset -q HEAD -- "$TEST_FILE" 2>/dev/null || true
    rm -f "$TEST_FILE"
}
# Ensure cleanup even if the script is interrupted mid-test.
trap cleanup_hook_test EXIT INT TERM

echo "api_key=test123" > "$TEST_FILE"
git add "$TEST_FILE" 2>/dev/null

if bash .githooks/pre-commit 2>&1 | grep -q "Possible secret detected"; then
    print_result 0 "Pre-commit hook successfully blocks secrets"
else
    print_result 1 "Pre-commit hook does NOT block secrets"
fi

cleanup_hook_test
trap - EXIT INT TERM

echo ""
echo "7. Checking documentation..."
echo "----------------------------------------"

# Docs live in docs/ with lowercase names; these checks previously looked for
# SECURITY.md and DEPLOYMENT.md at the repo root and so never actually ran.
if [ -f docs/security.md ]; then
    print_result 0 "docs/security.md exists"
else
    print_result 1 "docs/security.md does NOT exist"
fi

# Deployment docs must use placeholders rather than real hostnames — this repo is
# public. See docs/security.md.
if grep -qE "<[a-z-]*app[a-z-]*>|<store-[a-z]+>" docs/deployment.md 2>/dev/null; then
    print_result 0 "docs/deployment.md uses placeholders for URLs"
else
    print_result 1 "docs/deployment.md does NOT use placeholders"
fi

if grep -qE "<[a-z-]*app[a-z-]*>|<store-[a-z]+>" docs/customer-onboarding.md 2>/dev/null; then
    print_result 0 "docs/customer-onboarding.md uses placeholders for URLs"
else
    print_result 1 "docs/customer-onboarding.md does NOT use placeholders"
fi

echo ""
echo "========================================="
echo "Summary"
echo "========================================="
echo -e "${GREEN}Passed:${NC} $PASS"
echo -e "${RED}Failed:${NC} $FAIL"
echo -e "${YELLOW}Warnings:${NC} $WARN"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ All critical security checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some security checks failed. Please review the output above.${NC}"
    exit 1
fi
