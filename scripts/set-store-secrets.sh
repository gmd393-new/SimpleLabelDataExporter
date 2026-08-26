#!/bin/bash

# Set a store's production secrets on its Fly app from a local env file.
#
# Exists so credentials never have to be typed or pasted into a terminal, a chat
# window, or a shell history. Values are read from the file and handed to flyctl
# directly; this script never prints them.
#
# Usage:
#   bash scripts/set-store-secrets.sh .env-<store-slug>
#   bash scripts/set-store-secrets.sh .env-<store-slug> --dry-run
#
# Create the env file from .env-store.example. It must stay gitignored.

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REQUIRED_KEYS=(FLY_APP SHOPIFY_API_KEY SHOPIFY_API_SECRET SHOPIFY_APP_URL SCOPES UPC_PREFIX NODE_ENV)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

ENV_FILE="${1:-}"
DRY_RUN=0
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1

if [ -z "$ENV_FILE" ]; then
    echo "Usage: bash scripts/set-store-secrets.sh <env-file> [--dry-run]"
    echo ""
    echo "Create the env file from .env-store.example first."
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}✗${NC} No such file: $ENV_FILE"
    echo "  Copy .env-store.example to $ENV_FILE and fill it in."
    exit 1
fi

# --- Refuse to run against a file git would commit -----------------------------

if ! git check-ignore -q "$ENV_FILE" 2>/dev/null; then
    echo -e "${RED}✗${NC} $ENV_FILE is NOT gitignored."
    echo "  It holds an API secret. Refusing to proceed — add it to .gitignore first."
    exit 1
fi

if git ls-files --error-unmatch "$ENV_FILE" >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} $ENV_FILE is already TRACKED by git."
    echo "  Its contents are in your history. Run:"
    echo "    git rm --cached $ENV_FILE"
    echo "  and rotate the credentials before continuing."
    exit 1
fi

# --- Parse ---------------------------------------------------------------------

declare -A VALUES
line_no=0
while IFS= read -r line || [ -n "$line" ]; do
    line_no=$((line_no + 1))
    line="${line%$'\r'}"                       # tolerate CRLF
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue

    if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
        echo -e "${YELLOW}!${NC} Ignoring unparseable line $line_no"
        continue
    fi

    key="${BASH_REMATCH[1]}"
    value="${BASH_REMATCH[2]}"
    value="${value#"${value%%[![:space:]]*}"}"  # trim leading space
    value="${value%"${value##*[![:space:]]}"}"  # trim trailing space
    # Strip one layer of matching quotes
    if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
    fi

    VALUES["$key"]="$value"
done < "$ENV_FILE"

# --- Validate ------------------------------------------------------------------

missing=()
for key in "${REQUIRED_KEYS[@]}"; do
    if [ -z "${VALUES[$key]:-}" ]; then
        missing+=("$key")
    fi
done

if [ ${#missing[@]} -gt 0 ]; then
    echo -e "${RED}✗${NC} Missing or empty in $ENV_FILE:"
    printf '    %s\n' "${missing[@]}"
    exit 1
fi

APP="${VALUES[FLY_APP]}"

# A trailing slash or http:// in SHOPIFY_APP_URL causes an OAuth redirect loop
# that looks like a Shopify problem rather than a typo. Catch it here.
if [[ "${VALUES[SHOPIFY_APP_URL]}" != https://* ]]; then
    echo -e "${RED}✗${NC} SHOPIFY_APP_URL must start with https://"
    exit 1
fi
if [[ "${VALUES[SHOPIFY_APP_URL]}" == */ ]]; then
    echo -e "${RED}✗${NC} SHOPIFY_APP_URL must not end with a trailing slash"
    exit 1
fi

if ! command -v flyctl >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} flyctl not found on PATH"
    exit 1
fi

if ! flyctl auth whoami >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} Not logged in to fly.io. Run: flyctl auth login"
    exit 1
fi

if ! flyctl status --app "$APP" >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} Fly app '$APP' not found (or no access)."
    echo "  Create it first: flyctl apps create $APP"
    exit 1
fi

# --- Apply ---------------------------------------------------------------------

echo "Setting secrets on: $APP"
echo "Source: $ENV_FILE"
echo ""
for key in "${REQUIRED_KEYS[@]}"; do
    [ "$key" = "FLY_APP" ] && continue
    case "$key" in
        SHOPIFY_API_SECRET|SHOPIFY_API_KEY) echo "  $key = (hidden)" ;;
        *)                                  echo "  $key = ${VALUES[$key]}" ;;
    esac
done
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
    echo -e "${YELLOW}Dry run — nothing was changed.${NC}"
    exit 0
fi

# One invocation so the app restarts once, not five times.
args=()
for key in "${REQUIRED_KEYS[@]}"; do
    [ "$key" = "FLY_APP" ] && continue
    args+=("${key}=${VALUES[$key]}")
done

if flyctl secrets set "${args[@]}" --app "$APP"; then
    echo ""
    echo -e "${GREEN}✓ Secrets set on $APP${NC}"
    echo ""
    flyctl secrets list --app "$APP"
    echo ""
    echo "Next: ./scripts/deploy-all.sh"
else
    echo ""
    echo -e "${RED}✗ flyctl secrets set failed${NC}"
    exit 1
fi
