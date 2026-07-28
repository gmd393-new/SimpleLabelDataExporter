#!/bin/bash

# Deploy All Production Stores
#
# Every customer store runs its own Fly deployment of the SAME image, because each
# store needs its own custom-distribution Partners app (Shopify custom apps install
# on a single store, and distribution method can never be changed). Nothing enforces
# that these deployments run the same code — so deploy them together, always, with
# this script. Drift between them is the main operational risk of this architecture.
#
# Usage:
#   ./scripts/deploy-all.sh              # deploy every production store
#   ./scripts/deploy-all.sh --check      # health-check only, deploy nothing
#
# See docs/superpowers/specs/2026-07-28-second-store-deployment-design.md

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

# Stores are discovered from .fly/production*.toml — one config file per store.
# Onboarding a store means adding its config file; nothing here changes.
# App names are read from each file rather than hardcoded, keeping real deployment
# names out of this (public) repo. See docs/security.md.
DEPLOYMENTS=()
for config in .fly/production*.toml; do
    [ -e "$config" ] || continue
    app_name="$(grep -m1 -E "^[[:space:]]*app[[:space:]]*=" "$config" \
        | sed -E "s/^[^=]*=[[:space:]]*['\"]?([^'\"]+)['\"]?.*/\1/" \
        | tr -d '[:space:]')"
    if [ -z "$app_name" ]; then
        echo "✗ Could not read app name from $config" >&2
        exit 1
    fi
    DEPLOYMENTS+=("${app_name}:${config}")
done

if [ ${#DEPLOYMENTS[@]} -eq 0 ]; then
    echo "✗ No .fly/production*.toml files found." >&2
    exit 1
fi

DEPLOYED=()
FAILED=()

echo "========================================="
echo "Production Deployment"
echo "========================================="
echo "Stores discovered: ${#DEPLOYMENTS[@]}"
echo ""

# --- Health check ------------------------------------------------------------

health_check() {
    local app="$1"
    if curl -fsS --max-time 30 "https://${app}.fly.dev/healthz" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} ${app} healthy"
        return 0
    fi
    echo -e "  ${RED}✗${NC} ${app} did NOT return healthy"
    return 1
}

if [ "$CHECK_ONLY" -eq 1 ]; then
    echo "Health checks only — deploying nothing."
    echo ""
    rc=0
    for entry in "${DEPLOYMENTS[@]}"; do
        health_check "${entry%%:*}" || rc=1
    done
    exit $rc
fi

# --- Preflight (deploy only) -------------------------------------------------

if ! command -v flyctl >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} flyctl not found on PATH"
    exit 1
fi

if ! flyctl auth whoami >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} Not logged in to fly.io. Run: flyctl auth login"
    exit 1
fi

for entry in "${DEPLOYMENTS[@]}"; do
    config="${entry#*:}"
    if [ ! -f "$config" ]; then
        echo -e "${RED}✗${NC} Missing config: $config"
        exit 1
    fi
done

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo -e "${YELLOW}!${NC} Working tree has uncommitted changes."
    echo "  You are about to deploy code that is not committed anywhere."
    if [ ! -t 0 ]; then
        echo -e "  ${RED}✗${NC} Not an interactive shell; refusing to deploy uncommitted code."
        exit 1
    fi
    read -r -p "  Continue? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || exit 1
    echo ""
fi

# --- Deploy ------------------------------------------------------------------

for entry in "${DEPLOYMENTS[@]}"; do
    app="${entry%%:*}"
    config="${entry#*:}"

    echo -e "${BLUE}▶${NC} Deploying ${app} (${config})"

    if flyctl deploy --config "$config" --app "$app"; then
        echo -e "  ${GREEN}✓${NC} ${app} deployed"
        DEPLOYED+=("$app")
    else
        echo -e "  ${RED}✗${NC} ${app} FAILED to deploy"
        FAILED+=("$app")

        # Keep going. Stopping here would guarantee drift; continuing at least
        # gives every store a chance to land on the new version, and the summary
        # below reports exactly which ones did not.
    fi
    echo ""
done

# --- Verify ------------------------------------------------------------------

if [ ${#DEPLOYED[@]} -gt 0 ]; then
    echo "Verifying health of deployed apps..."
    for app in "${DEPLOYED[@]}"; do
        health_check "$app" || FAILED+=("$app (unhealthy after deploy)")
    done
    echo ""
fi

# --- Summary -----------------------------------------------------------------

echo "========================================="
echo "Summary"
echo "========================================="
echo -e "  Deployed: ${GREEN}${#DEPLOYED[@]}${NC} / ${#DEPLOYMENTS[@]}"

if [ ${#FAILED[@]} -gt 0 ]; then
    echo -e "  ${RED}Failed:${NC}"
    for app in "${FAILED[@]}"; do
        echo "    - $app"
    done
    echo ""
    echo -e "${RED}✗ PRODUCTION STORES ARE NOW RUNNING DIFFERENT VERSIONS.${NC}"
    echo "  Fix the failure and re-run this script before doing anything else."
    echo "  To roll the successful ones back instead:"
    echo "    flyctl releases --app <app>"
    echo "    flyctl releases rollback <version> --app <app>"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ All production stores deployed and healthy.${NC}"
