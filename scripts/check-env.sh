#!/usr/bin/env bash
set -euo pipefail

# Environment check script for the security scanning orchestrator.
# Uses Wrangler CLI to verify secrets, bindings, and resources.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASS=0
WARN=0
FAIL=0

# Wrangler command (prefer local npx if global not found)
if command -v wrangler &>/dev/null; then
  WRANGLER="wrangler"
elif command -v npx &>/dev/null; then
  WRANGLER="npx wrangler"
else
  echo -e "${RED}ERROR: wrangler or npx not found.${NC}"
  echo "Install with: npm install -g wrangler"
  exit 1
fi

echo "============================================"
echo "  Security Scanning Orchestrator - Env Check"
echo "============================================"
echo ""

# --- 1. Login Check ---
echo -e "${BLUE}[1/6] Checking Wrangler login...${NC}"
if $WRANGLER whoami &>/dev/null; then
  ACCOUNT=$($WRANGLER whoami 2>/dev/null | head -n1)
  echo -e "  ${GREEN}PASS${NC} Logged in as: $ACCOUNT"
  ((PASS++))
else
  echo -e "  ${RED}FAIL${NC} Not logged in. Run: $WRANGLER login"
  ((FAIL++))
fi
echo ""

# --- 2. Secrets Check ---
echo -e "${BLUE}[2/6] Checking secrets...${NC}"

REQUIRED_SECRETS=(
  "CF_ACCOUNT_ID"
  "CF_AI_API_TOKEN"
  "GITHUB_APP_ID"
  "GITHUB_PRIVATE_KEY"
  "GITHUB_WEBHOOK_SECRET"
  "GITHUB_APP_INSTALLATION_ID"
)

OPTIONAL_SECRETS=(
  "TELEGRAM_BOT_TOKEN"
  "TELEGRAM_CHAT_ID"
  "EMAIL_PROVIDER"
  "SENDGRID_API_KEY"
  "MAILGUN_API_KEY"
  "MAILGUN_DOMAIN"
  "EMAIL_FROM"
  "EMAIL_TO"
  "ALERT_MIN_SEVERITY"
  "SANDBOX_JWT_SECRET"
)

SECRET_JSON=""
if $WRANGLER secret list --format json &>/dev/null; then
  SECRET_JSON=$($WRANGLER secret list --format json 2>/dev/null)
elif $WRANGLER secret list &>/dev/null; then
  SECRET_JSON=$($WRANGLER secret list 2>/dev/null | jq -R -s -c 'split("\n") | map(select(length > 0)) | map({name: .})')
else
  echo -e "  ${RED}FAIL${NC} Could not list secrets. Run this from the project root."
  ((FAIL++))
fi

if [[ -n "$SECRET_JSON" ]]; then
  for secret in "${REQUIRED_SECRETS[@]}"; do
    if echo "$SECRET_JSON" | grep -q "$secret"; then
      echo -e "  ${GREEN}PASS${NC} $secret"
      ((PASS++))
    else
      echo -e "  ${RED}FAIL${NC} $secret (missing)"
      ((FAIL++))
    fi
  done

  for secret in "${OPTIONAL_SECRETS[@]}"; do
    if echo "$SECRET_JSON" | grep -q "$secret"; then
      echo -e "  ${GREEN}PASS${NC} $secret (optional)"
      ((PASS++))
    else
      echo -e "  ${YELLOW}WARN${NC} $secret (optional, not set)"
      ((WARN++))
    fi
  done
fi
echo ""

# --- 3. D1 Database Check ---
echo -e "${BLUE}[3/6] Checking D1 databases...${NC}"
if $WRANGLER d1 list --json &>/dev/null; then
  D1_LIST=$($WRANGLER d1 list --json 2>/dev/null)
  if echo "$D1_LIST" | grep -q "security-findings"; then
    DB_ID=$(echo "$D1_LIST" | jq -r '.[] | select(.name=="security-findings") | .uuid')
    echo -e "  ${GREEN}PASS${NC} D1 database 'security-findings' exists (ID: $DB_ID)"
    ((PASS++))

    # Check wrangler.toml matches
    if grep -q "$DB_ID" wrangler.toml; then
      echo -e "  ${GREEN}PASS${NC} database_id matches wrangler.toml"
      ((PASS++))
    else
      echo -e "  ${YELLOW}WARN${NC} database_id in wrangler.toml does not match 'security-findings'"
      ((WARN++))
    fi
  else
    echo -e "  ${RED}FAIL${NC} D1 database 'security-findings' not found"
    echo "        Create with: $WRANGLER d1 create security-findings"
    ((FAIL++))
  fi
else
  echo -e "  ${RED}FAIL${NC} Could not list D1 databases"
  ((FAIL++))
fi
echo ""

# --- 4. KV Namespace Check ---
echo -e "${BLUE}[4/6] Checking KV namespaces...${NC}"
if $WRANGLER kv:namespace list --json &>/dev/null; then
  KV_LIST=$($WRANGLER kv:namespace list --json 2>/dev/null)
  if echo "$KV_LIST" | grep -q "CACHE"; then
    KV_ID=$(echo "$KV_LIST" | jq -r '.[] | select(.title | contains("CACHE")) | .id')
    echo -e "  ${GREEN}PASS${NC} KV namespace 'CACHE' exists (ID: $KV_ID)"
    ((PASS++))

    if grep -q "$KV_ID" wrangler.toml; then
      echo -e "  ${GREEN}PASS${NC} KV id matches wrangler.toml"
      ((PASS++))
    else
      echo -e "  ${YELLOW}WARN${NC} KV id in wrangler.toml does not match 'CACHE'"
      ((WARN++))
    fi
  else
    echo -e "  ${RED}FAIL${NC} KV namespace 'CACHE' not found"
    echo "        Create with: $WRANGLER kv:namespace create CACHE"
    ((FAIL++))
  fi
else
  echo -e "  ${RED}FAIL${NC} Could not list KV namespaces"
  ((FAIL++))
fi
echo ""

# --- 5. R2 Bucket Check ---
echo -e "${BLUE}[5/6] Checking R2 buckets...${NC}"
if $WRANGLER r2 bucket list --json &>/dev/null; then
  R2_LIST=$($WRANGLER r2 bucket list --json 2>/dev/null)
  if echo "$R2_LIST" | jq -r '.[].name' 2>/dev/null | grep -q "security-raw-reports"; then
    echo -e "  ${GREEN}PASS${NC} R2 bucket 'security-raw-reports' exists"
    ((PASS++))
  else
    echo -e "  ${YELLOW}WARN${NC} R2 bucket 'security-raw-reports' not found"
    echo "        Create with: $WRANGLER r2 bucket create security-raw-reports"
    ((WARN++))
  fi
else
  echo -e "  ${YELLOW}WARN${NC} Could not list R2 buckets (check permissions)"
  ((WARN++))
fi
echo ""

# --- 6. Queue Check ---
echo -e "${BLUE}[6/6] Checking queues...${NC}"
REQUIRED_QUEUES=(
  "scanner-jobs"
  "ai-validation"
  "ai-validation-priority"
  "fix-validation"
  "rule-testing"
)

if $WRANGLER queues list --json &>/dev/null; then
  QUEUE_LIST=$($WRANGLER queues list --json 2>/dev/null)
  for queue in "${REQUIRED_QUEUES[@]}"; do
    if echo "$QUEUE_LIST" | jq -r '.[].queue_name' 2>/dev/null | grep -q "^${queue}$"; then
      echo -e "  ${GREEN}PASS${NC} Queue '$queue' exists"
      ((PASS++))
    else
      echo -e "  ${RED}FAIL${NC} Queue '$queue' not found"
      echo "        Create with: $WRANGLER queues create $queue"
      ((FAIL++))
    fi
  done
else
  echo -e "  ${RED}FAIL${NC} Could not list queues"
  ((FAIL++))
fi
echo ""

# --- Summary ---
echo "============================================"
echo "              Summary"
echo "============================================"
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${YELLOW}WARN: $WARN${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo ""

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}All critical checks passed!${NC}"
  echo "You can now run:"
  echo "  $WRANGLER d1 migrations apply security-findings --local"
  echo "  $WRANGLER deploy"
  exit 0
else
  echo -e "${RED}Some critical checks failed.${NC}"
  echo "Fix the FAIL items above, then re-run this script."
  exit 1
fi
