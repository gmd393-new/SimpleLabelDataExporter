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

# Search for hardcoded passwords in tracked files
if git grep -i "postgres_password.*devpassword" -- ':(exclude).env.docker' ':(exclude).env.docker.example' >/dev/null 2>&1; then
    print_result 1 "Found hardcoded password 'devpassword' in tracked files"
else
    print_result 0 "No hardcoded 'devpassword' in tracked files"
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

# Check if docker-compose.yml uses env_file
if grep -q "env_file:" docker-compose.yml; then
    print_result 0 "docker-compose.yml uses env_file for environment variables"
else
    print_result 1 "docker-compose.yml does NOT use env_file"
fi

# Verify Docker Compose can load environment variables
if docker compose config >/dev/null 2>&1; then
    print_result 0 "Docker Compose configuration is valid"
else
    print_result 1 "Docker Compose configuration is INVALID"
fi

# Check if password is loaded from .env.docker
if [ -f .env.docker ]; then
    LOADED_PASSWORD=$(docker compose config 2>/dev/null | grep "POSTGRES_PASSWORD:" | awk '{print $2}')
    EXPECTED_PASSWORD=$(grep "POSTGRES_PASSWORD=" .env.docker | cut -d'=' -f2)

    if [ "$LOADED_PASSWORD" = "$EXPECTED_PASSWORD" ]; then
        print_result 0 "Docker Compose loads password from .env.docker"
    else
        print_result 1 "Docker Compose does NOT load password from .env.docker"
    fi
fi

echo ""
echo "6. Testing pre-commit hook..."
echo "----------------------------------------"

# Create a test file with a secret
echo "password=test123" > .test-secret.txt
git add .test-secret.txt 2>/dev/null

# Try to commit (should fail)
if git commit -m "test secret detection" --no-verify >/dev/null 2>&1; then
    # Committed with --no-verify, that's expected
    git reset HEAD .test-secret.txt 2>/dev/null
    rm .test-secret.txt
    print_warning "Pre-commit hook bypassed with --no-verify (this is OK for testing)"
else
    # Clean up
    git reset HEAD .test-secret.txt 2>/dev/null
    rm .test-secret.txt
fi

# Now test that the hook actually blocks commits
echo "api_key=test123" > .test-secret.txt
git add .test-secret.txt 2>/dev/null

if timeout 5 git commit -m "test" 2>&1 | grep -q "Possible secret detected"; then
    print_result 0 "Pre-commit hook successfully blocks secrets"
    git reset HEAD .test-secret.txt 2>/dev/null
    rm .test-secret.txt
else
    print_result 1 "Pre-commit hook does NOT block secrets"
    git reset HEAD .test-secret.txt 2>/dev/null
    rm .test-secret.txt
fi

echo ""
echo "7. Checking documentation..."
echo "----------------------------------------"

# Check if SECURITY.md exists
if [ -f SECURITY.md ]; then
    print_result 0 "SECURITY.md exists"
else
    print_result 1 "SECURITY.md does NOT exist"
fi

# Check if documentation uses placeholders
if grep -q "<production-app>" DEPLOYMENT.md 2>/dev/null; then
    print_result 0 "DEPLOYMENT.md uses placeholders for URLs"
else
    print_result 1 "DEPLOYMENT.md does NOT use placeholders"
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
