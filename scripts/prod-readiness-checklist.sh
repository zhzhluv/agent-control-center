#!/bin/bash

#################################################################
# Agent Control Center - Production Readiness Verification
#################################################################
#
# This script performs comprehensive production readiness checks:
#   1. Production mode without AUTH_TOKEN (should fail)
#   2. Production mode with AUTH_TOKEN (should succeed)
#   3. Health endpoint availability
#   4. Protected API authentication
#   5. Full test suite execution
#
# Usage: ./scripts/prod-readiness-checklist.sh
#
# WARNING: This script will start/stop servers on PORT 9876 (configurable).
#          It may kill existing processes on that port during cleanup.
#          Do NOT run while a production server is active on the same port.
#
# Requirements:
#   - Node.js >=20.0.0
#   - Built server (npm run build)
#   - curl
#   - timeout command
#
#################################################################

set +e  # Don't exit on first error - we want to run all checks

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT=9876
BASE_URL="http://localhost:$PORT"

# Test counters
PASS=0
FAIL=0
SKIP=0

# Track server PIDs for cleanup
SERVER_PIDS=()

# Cleanup function
cleanup() {
  if [ ${#SERVER_PIDS[@]} -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Cleaning up server processes...${NC}"
    for pid in "${SERVER_PIDS[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null
        echo "  Killed PID $pid"
      fi
    done
  fi

  # Clean up any leftover node processes on configured PORT
  # WARNING: This will kill processes on PORT $PORT - ensure no other services use this port
  lsof -ti:$PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Helper: wait for server to be down
wait_for_server_down() {
  local max_wait=5
  local waited=0
  while lsof -ti:$PORT >/dev/null 2>&1; do
    if [ $waited -ge $max_wait ]; then
      echo -e "   ${YELLOW}Warning${NC}: Port still in use, forcing cleanup"
      lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
      sleep 1
      return
    fi
    sleep 1
    ((waited++))
  done
}

# Helper: wait for server to be ready
wait_for_server() {
  local max_wait=10
  local waited=0
  while [ $waited -lt $max_wait ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((waited++))
  done
  return 1
}

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     Agent Control Center - Production Readiness          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "Project: $PROJECT_ROOT"
echo "Port: $PORT"
echo ""

#################################################################
# Check 1: Production mode WITHOUT AUTH_TOKEN (should fail)
#################################################################

echo -e "${CYAN}═══ Check 1: Production Mode Security ═══${NC}"
echo ""

echo "1.1 Testing: NODE_ENV=production without AUTH_TOKEN (should exit with error)"

# Ensure port is free
wait_for_server_down

# Run server in production mode without token
cd "$PROJECT_ROOT"
PROD_OUTPUT=$(timeout 3 sh -c 'NODE_ENV=production npm start 2>&1' || echo "EXIT_CODE:$?")

if echo "$PROD_OUTPUT" | grep -q "FATAL: AUTH_TOKEN environment variable is required"; then
  echo -e "   ${GREEN}✓ PASS${NC}: Server correctly rejects startup without AUTH_TOKEN"
  ((PASS++))
elif echo "$PROD_OUTPUT" | grep -q "EXIT_CODE:1"; then
  echo -e "   ${GREEN}✓ PASS${NC}: Server exited with error (code 1)"
  ((PASS++))
else
  echo -e "   ${RED}✗ FAIL${NC}: Server did not reject startup as expected"
  echo -e "   ${YELLOW}Output:${NC} $PROD_OUTPUT" | head -5
  ((FAIL++))
fi
echo ""

#################################################################
# Check 2: Production mode WITH AUTH_TOKEN (should succeed)
#################################################################

echo -e "${CYAN}═══ Check 2: Production Mode with AUTH_TOKEN ═══${NC}"
echo ""

echo "2.1 Generating temporary AUTH_TOKEN for testing"
TEMP_TOKEN=$(openssl rand -hex 16)
echo -e "   ${GREEN}✓${NC} Generated token: ${TEMP_TOKEN:0:8}******** (masked)"
echo ""

echo "2.2 Starting server in production mode with AUTH_TOKEN"

# Ensure port is free
wait_for_server_down

# Start server in background
cd "$PROJECT_ROOT"
NODE_ENV=production AUTH_TOKEN="$TEMP_TOKEN" PORT=$PORT npm start > /tmp/prod-server.log 2>&1 &
SERVER_PID=$!
SERVER_PIDS+=($SERVER_PID)

echo -e "   Server PID: $SERVER_PID"

# Wait for server to start
if wait_for_server; then
  echo -e "   ${GREEN}✓ PASS${NC}: Server started successfully in production mode"
  ((PASS++))
else
  echo -e "   ${RED}✗ FAIL${NC}: Server failed to start"
  echo -e "   ${YELLOW}Last 10 lines of log:${NC}"
  tail -10 /tmp/prod-server.log
  ((FAIL++))
  # Continue anyway to test shutdown
fi
echo ""

#################################################################
# Check 3: Health Endpoint (no auth required)
#################################################################

echo -e "${CYAN}═══ Check 3: Health Endpoint ═══${NC}"
echo ""

echo "3.1 Testing: GET /api/health (no authentication required)"
HEALTH_STATUS=$(curl -s -o /tmp/health-check.json -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null)

if [ "$HEALTH_STATUS" = "200" ]; then
  echo -e "   ${GREEN}✓ PASS${NC}: Health endpoint returned 200"
  ((PASS++))

  # Check response structure
  if grep -q '"status"' /tmp/health-check.json && grep -q '"uptime"' /tmp/health-check.json; then
    echo -e "   ${GREEN}✓ PASS${NC}: Health response contains required fields"
    ((PASS++))
  else
    echo -e "   ${RED}✗ FAIL${NC}: Health response missing required fields"
    ((FAIL++))
  fi
else
  echo -e "   ${RED}✗ FAIL${NC}: Health endpoint returned $HEALTH_STATUS (expected 200)"
  ((FAIL++))
fi
echo ""

#################################################################
# Check 4: Protected APIs without token (should return 401)
#################################################################

echo -e "${CYAN}═══ Check 4: Protected API Authentication ═══${NC}"
echo ""

# Test multiple protected endpoints
PROTECTED_ENDPOINTS=(
  "/api/status"
  "/api/sessions"
  "/api/agents"
  "/api/metrics"
  "/api/diagnostics"
  "/api/reports"
)

for endpoint in "${PROTECTED_ENDPOINTS[@]}"; do
  echo "4.$(( ${#PROTECTED_ENDPOINTS[@]} - ${#PROTECTED_ENDPOINTS[@]} + $(echo "${PROTECTED_ENDPOINTS[@]}" | tr ' ' '\n' | grep -n "^$endpoint$" | cut -d: -f1) )) Testing: GET $endpoint without auth token (should return 401)"

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint" 2>/dev/null)

  if [ "$STATUS" = "401" ]; then
    echo -e "   ${GREEN}✓ PASS${NC}: Endpoint correctly returns 401 without auth"
    ((PASS++))
  else
    echo -e "   ${RED}✗ FAIL${NC}: Endpoint returned $STATUS (expected 401)"
    ((FAIL++))
  fi
done
echo ""

#################################################################
# Check 5: Protected APIs WITH valid token (should return 200)
#################################################################

echo -e "${CYAN}═══ Check 5: Protected APIs with Valid Token ═══${NC}"
echo ""

for endpoint in "${PROTECTED_ENDPOINTS[@]}"; do
  idx=$(echo "${PROTECTED_ENDPOINTS[@]}" | tr ' ' '\n' | grep -n "^$endpoint$" | cut -d: -f1)
  echo "5.$idx Testing: GET $endpoint with valid auth token (should return 200)"

  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $TEMP_TOKEN" \
    "$BASE_URL$endpoint" 2>/dev/null)

  if [ "$STATUS" = "200" ]; then
    echo -e "   ${GREEN}✓ PASS${NC}: Endpoint returns 200 with valid auth"
    ((PASS++))
  else
    echo -e "   ${RED}✗ FAIL${NC}: Endpoint returned $STATUS (expected 200)"
    ((FAIL++))
  fi
done
echo ""

#################################################################
# Check 6: Graceful shutdown
#################################################################

echo -e "${CYAN}═══ Check 6: Graceful Shutdown ═══${NC}"
echo ""

echo "6.1 Sending SIGTERM to server (PID $SERVER_PID)"
if kill -0 "$SERVER_PID" 2>/dev/null; then
  kill -TERM "$SERVER_PID" 2>/dev/null

  # Wait for graceful shutdown
  shutdown_timeout=5
  shutdown_waited=0
  while kill -0 "$SERVER_PID" 2>/dev/null && [ $shutdown_waited -lt $shutdown_timeout ]; do
    sleep 1
    ((shutdown_waited++))
  done

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "   ${GREEN}✓ PASS${NC}: Server shutdown gracefully"
    ((PASS++))
  else
    echo -e "   ${YELLOW}⚠ WARNING${NC}: Server did not shutdown gracefully, forcing"
    kill -9 "$SERVER_PID" 2>/dev/null
    ((FAIL++))
  fi
else
  echo -e "   ${YELLOW}⚠ WARNING${NC}: Server process already stopped"
fi

# Remove from tracking
SERVER_PIDS=()
echo ""

#################################################################
# Check 7: Full Test Suite
#################################################################

echo -e "${CYAN}═══ Check 7: Full Test Suite ═══${NC}"
echo ""

echo "7.1 Running npm test (includes smoke tests and reports API tests)"
echo ""

# Ensure server is down before running tests (tests start their own server)
wait_for_server_down

cd "$PROJECT_ROOT"
if npm test 2>&1 | tee /tmp/test-output.log; then
  echo ""
  echo -e "   ${GREEN}✓ PASS${NC}: All tests passed"
  ((PASS++))
else
  echo ""
  echo -e "   ${RED}✗ FAIL${NC}: Some tests failed"
  ((FAIL++))
fi
echo ""

#################################################################
# Summary
#################################################################

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              Production Readiness Summary                ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${GREEN}Passed:${NC}  $PASS checks"
echo -e "${RED}Failed:${NC}  $FAIL checks"
echo -e "${YELLOW}Skipped:${NC} $SKIP checks"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  ✓ PRODUCTION READY - All checks passed!          ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Set AUTH_TOKEN in production environment"
  echo "  2. Optionally set CORS_ORIGIN for security"
  echo "  3. Deploy with: NODE_ENV=production npm start"
  echo ""
  exit 0
else
  echo -e "${RED}╔════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  ✗ NOT PRODUCTION READY - Some checks failed      ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "Please review the failed checks above and fix issues before deployment."
  echo ""
  exit 1
fi
