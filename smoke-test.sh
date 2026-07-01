#!/bin/bash

#################################################################
#  Agent Control Center - Comprehensive Smoke Test Suite
#################################################################
#
# Tests:
#   - Health endpoint (no auth)
#   - Status API (auth required)
#   - Diagnostics API (auth required)
#   - Reports API (auth required)
#   - Agents API (auth required)
#   - Sessions API (auth required)
#   - Metrics API (auth required)
#   - WebSocket connection (auth required)
#   - Build verification (client dist exists)
#   - Security tests (auth enforcement)
#
# Usage: ./smoke-test.sh [AUTH_TOKEN] [BASE_URL]
#   AUTH_TOKEN: Auth token (defaults to /tmp/agent-control-center-token)
#   BASE_URL: Server URL (defaults to http://localhost:9876)
#
# Dependencies: bash, curl, node (for WebSocket tests)
#

# Don't exit on first error - we want to run all tests
set +e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
if [ -n "$1" ]; then
  AUTH_TOKEN="$1"
elif [ -f "/tmp/agent-control-center-token" ]; then
  AUTH_TOKEN=$(cat /tmp/agent-control-center-token)
else
  echo -e "${RED}Usage: $0 [AUTH_TOKEN] [BASE_URL]${NC}"
  echo "Or ensure /tmp/agent-control-center-token exists (dev mode)"
  exit 1
fi

BASE_URL="${2:-http://localhost:9876}"
WS_URL="${BASE_URL/http/ws}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Test counters
PASS=0
FAIL=0
SKIP=0

# Temporary files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Helper: check HTTP status code
check_status() {
  local expected="$1"
  local actual="$2"

  if [ "$actual" -eq "$expected" ] 2>/dev/null; then
    echo -e "   ${GREEN}✓ PASS${NC}: HTTP $actual (expected $expected)"
    ((PASS++))
    return 0
  else
    echo -e "   ${RED}✗ FAIL${NC}: HTTP $actual (expected $expected)"
    ((FAIL++))
    return 1
  fi
}

# Helper: check JSON response contains field using Node.js (no jq dependency)
check_json_field() {
  local file="$1"
  local field="$2"

  if [ ! -f "$file" ]; then
    echo -e "   ${RED}✗ FAIL${NC}: Response file not found"
    ((FAIL++))
    return 1
  fi

  # Use Node.js to parse JSON (no jq required)
  local result=$(node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync('$file', 'utf8'));
      const value = data['$field'];
      if (value === undefined || value === null) {
        console.log('MISSING');
      } else if (Array.isArray(value)) {
        console.log('ARRAY:' + value.length);
      } else if (typeof value === 'object') {
        console.log('OBJECT');
      } else if (typeof value === 'string' && value.length > 50) {
        console.log('STRING:' + value.length);
      } else {
        console.log('VALUE');
      }
    } catch (e) {
      console.log('ERROR');
    }
  " 2>/dev/null)

  if [ "$result" = "MISSING" ] || [ "$result" = "ERROR" ]; then
    echo -e "   ${RED}✗ FAIL${NC}: Field '$field' missing or invalid"
    ((FAIL++))
    return 1
  elif [[ "$result" == ARRAY:* ]]; then
    local len="${result#ARRAY:}"
    echo -e "   ${GREEN}✓ PASS${NC}: Field '$field' exists (array, length: $len)"
    ((PASS++))
    return 0
  elif [ "$result" = "OBJECT" ]; then
    echo -e "   ${GREEN}✓ PASS${NC}: Field '$field' exists (object)"
    ((PASS++))
    return 0
  elif [[ "$result" == STRING:* ]]; then
    local len="${result#STRING:}"
    echo -e "   ${GREEN}✓ PASS${NC}: Field '$field' exists (string, length: $len)"
    ((PASS++))
    return 0
  else
    echo -e "   ${GREEN}✓ PASS${NC}: Field '$field' exists"
    ((PASS++))
    return 0
  fi
}

# Helper: get array length using Node.js
get_array_length() {
  local file="$1"
  local field="$2"
  node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync('$file', 'utf8'));
      const fieldName = '$field';
      const arr = fieldName ? data[fieldName] : data;
      console.log(Array.isArray(arr) ? arr.length : '?');
    } catch (e) { console.log('?'); }
  " 2>/dev/null
}

# Helper: skip test
skip_test() {
  local reason="$1"
  echo -e "   ${YELLOW}⊘ SKIP${NC}: $reason"
  ((SKIP++))
}

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║       Agent Control Center - Smoke Test Suite           ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "Base URL: $BASE_URL"
echo "Token: loaded"
echo ""

#################################################################
# Section 1: Health & Build Verification
#################################################################

echo -e "${CYAN}═══ Section 1: Health & Build Verification ═══${NC}"
echo ""

# Test 1.1: Health endpoint (no auth required)
echo "1.1 GET /api/health (no auth required)"
STATUS=$(curl -s -o "$TEMP_DIR/health.json" -w "%{http_code}" \
  "$BASE_URL/api/health")
if check_status 200 "$STATUS"; then
  check_json_field "$TEMP_DIR/health.json" "status"
  check_json_field "$TEMP_DIR/health.json" "uptime"
fi
echo ""

# Test 1.2: Client build verification
echo "1.2 Client Build Verification"
if [ -f "$PROJECT_ROOT/client/dist/index.html" ]; then
  echo -e "   ${GREEN}✓ PASS${NC}: Client build exists"
  ((PASS++))
else
  echo -e "   ${RED}✗ FAIL${NC}: Client build not found (run 'npm run build:client')"
  ((FAIL++))
fi
echo ""

# Test 1.3: Server build verification
echo "1.3 Server Build Verification"
if [ -f "$PROJECT_ROOT/server/dist/index.js" ]; then
  echo -e "   ${GREEN}✓ PASS${NC}: Server build exists"
  ((PASS++))
else
  echo -e "   ${RED}✗ FAIL${NC}: Server build not found (run 'npm run build:server')"
  ((FAIL++))
fi
echo ""

#################################################################
# Section 2: API Endpoints (Authenticated)
#################################################################

echo -e "${CYAN}═══ Section 2: API Endpoints (Authenticated) ═══${NC}"
echo ""

# Test 2.1: Status API
echo "2.1 GET /api/status"
STATUS=$(curl -s -o "$TEMP_DIR/status.json" -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/status")
if check_status 200 "$STATUS"; then
  check_json_field "$TEMP_DIR/status.json" "agents"
  check_json_field "$TEMP_DIR/status.json" "sessions"
  check_json_field "$TEMP_DIR/status.json" "metrics"
fi
echo ""

# Test 2.2: Diagnostics API
echo "2.2 GET /api/diagnostics"
STATUS=$(curl -s -o "$TEMP_DIR/diagnostics.json" -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/diagnostics")
if check_status 200 "$STATUS"; then
  check_json_field "$TEMP_DIR/diagnostics.json" "uptime"
  check_json_field "$TEMP_DIR/diagnostics.json" "activeSessions"
  check_json_field "$TEMP_DIR/diagnostics.json" "connectionStats"
  check_json_field "$TEMP_DIR/diagnostics.json" "reportsCount"
fi
echo ""

# Test 2.3: Agents API
echo "2.3 GET /api/agents"
STATUS=$(curl -s -o "$TEMP_DIR/agents.json" -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/agents")
if check_status 200 "$STATUS"; then
  AGENT_COUNT=$(get_array_length "$TEMP_DIR/agents.json" "")
  echo -e "   ${BLUE}Info${NC}: Found $AGENT_COUNT agents"
fi
echo ""

# Test 2.4: Sessions API
echo "2.4 GET /api/sessions"
STATUS=$(curl -s -o "$TEMP_DIR/sessions.json" -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/sessions")
if check_status 200 "$STATUS"; then
  SESSION_COUNT=$(get_array_length "$TEMP_DIR/sessions.json" "")
  echo -e "   ${BLUE}Info${NC}: Found $SESSION_COUNT sessions"
fi
echo ""

# Test 2.5: Metrics API
echo "2.5 GET /api/metrics"
STATUS=$(curl -s -o "$TEMP_DIR/metrics.json" -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/metrics")
if check_status 200 "$STATUS"; then
  check_json_field "$TEMP_DIR/metrics.json" "totalAgents"
  check_json_field "$TEMP_DIR/metrics.json" "activeAgents"
fi
echo ""

# Test 2.6: Reports API - List
echo "2.6 GET /api/reports (list reports)"
STATUS=$(curl -s -o "$TEMP_DIR/reports.json" -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports")
if check_status 200 "$STATUS"; then
  check_json_field "$TEMP_DIR/reports.json" "reports"
  REPORT_COUNT=$(get_array_length "$TEMP_DIR/reports.json" "reports")
  echo -e "   ${BLUE}Info${NC}: Found $REPORT_COUNT reports"

  # Test 2.7: Get specific report if available
  FIRST_REPORT=$(node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync('$TEMP_DIR/reports.json', 'utf8'));
      if (data.reports && data.reports[0]) console.log(data.reports[0].path);
    } catch (e) {}
  " 2>/dev/null)

  if [ -n "$FIRST_REPORT" ]; then
    echo ""
    echo "2.7 GET /api/reports/:path (get specific report)"
    STATUS=$(curl -s -o "$TEMP_DIR/report-detail.json" -w "%{http_code}" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      "$BASE_URL/api/reports/$FIRST_REPORT")
    if check_status 200 "$STATUS"; then
      check_json_field "$TEMP_DIR/report-detail.json" "content"
    fi
  fi
fi
echo ""

#################################################################
# Section 3: Security Tests
#################################################################

echo -e "${CYAN}═══ Section 3: Security Tests ═══${NC}"
echo ""

# Test 3.1: No auth header
echo "3.1 Security: No auth header (should return 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/status")
check_status 401 "$STATUS"
echo ""

# Test 3.2: Invalid auth token
echo "3.2 Security: Invalid auth token (should return 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid-token-12345" \
  "$BASE_URL/api/status")
check_status 401 "$STATUS"
echo ""

# Test 3.3: Path traversal attack
echo "3.3 Security: Path traversal in reports API (should return 403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --path-as-is \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports/../../../etc/passwd")
check_status 403 "$STATUS"
echo ""

# Test 3.4: Non-.md file access
echo "3.4 Security: Non-.md file access (should return 403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports/test.txt")
check_status 403 "$STATUS"
echo ""

#################################################################
# Section 4: Review State API Tests
#################################################################

echo -e "${CYAN}═══ Section 4: Review State API Tests ═══${NC}"
echo ""

# Test 4.1: No auth header
echo "4.1 POST /api/agents/:id/review-state (no auth → 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"state":"acknowledged"}' \
  "$BASE_URL/api/agents/test-agent/review-state")
check_status 401 "$STATUS"
echo ""

# Test 4.2: Invalid token
echo "4.2 POST /api/agents/:id/review-state (invalid token → 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer invalid-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"state":"acknowledged"}' \
  "$BASE_URL/api/agents/test-agent/review-state")
check_status 401 "$STATUS"
echo ""

# Test 4.3: Invalid state value
echo "4.3 POST /api/agents/:id/review-state (invalid state → 400)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state":"invalid-state-value"}' \
  "$BASE_URL/api/agents/test-agent/review-state")
check_status 400 "$STATUS"
echo ""

# Test 4.4: Non-existent agent
echo "4.4 POST /api/agents/:id/review-state (non-existent agent → 404)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state":"acknowledged"}' \
  "$BASE_URL/api/agents/non-existent-agent-id-12345/review-state")
check_status 404 "$STATUS"
echo ""

# Test 4.5: (Optional) Actual state change if needsReview=true agent exists
echo "4.5 POST /api/agents/:id/review-state (dynamic: needsReview=true agent)"
REVIEW_AGENT=$(node -e "
  const fs = require('fs');
  try {
    const data = JSON.parse(fs.readFileSync('$TEMP_DIR/agents.json', 'utf8'));
    const agent = data.find(a => a.needsReview === true);
    if (agent) console.log(agent.id);
  } catch (e) {}
" 2>/dev/null)

if [ -n "$REVIEW_AGENT" ]; then
  STATUS=$(curl -s -o "$TEMP_DIR/review-state.json" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"state":"acknowledged"}' \
    "$BASE_URL/api/agents/$REVIEW_AGENT/review-state")
  if check_status 200 "$STATUS"; then
    echo -e "   ${BLUE}Info${NC}: Agent '$REVIEW_AGENT' state changed to 'acknowledged'"
  fi
else
  skip_test "검증 시점에 needsReview=true 에이전트 없음 (동적 상태)"
fi
echo ""

#################################################################
# Section 5: WebSocket Tests
#################################################################

echo -e "${CYAN}═══ Section 5: WebSocket Tests ═══${NC}"
echo ""

# Test 5.1: WebSocket connection
echo "5.1 WebSocket Connection Test"
if command -v node &> /dev/null; then
  # Run WebSocket test from project root to access node_modules/ws
  OUTPUT=$(cd "$PROJECT_ROOT" && node -e "
    const WebSocket = require('ws');
    const token = process.argv[1];
    const wsUrl = process.argv[2];

    const ws = new WebSocket(wsUrl + '?token=' + token);
    let connected = false;
    let receivedInit = false;
    let receivedPong = false;

    const timeout = setTimeout(() => {
      if (!connected) {
        console.log('TIMEOUT');
        process.exit(1);
      }
    }, 5000);

    ws.on('open', () => {
      connected = true;
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'init') {
          receivedInit = true;
          console.log('INIT_RECEIVED');
        } else if (msg.type === 'pong') {
          receivedPong = true;
          console.log('PONG_RECEIVED');
        }
        // Require BOTH init AND pong before declaring success
        if (receivedInit && receivedPong) {
          clearTimeout(timeout);
          ws.close();
          console.log('SUCCESS');
          process.exit(0);
        }
      } catch (e) {
        console.log('PARSE_ERROR');
        process.exit(1);
      }
    });

    ws.on('error', (err) => {
      console.log('ERROR:' + err.message);
      process.exit(1);
    });

    ws.on('close', () => {
      if (!receivedInit) {
        console.log('CLOSED_EARLY');
        process.exit(1);
      }
    });
  " "$AUTH_TOKEN" "$WS_URL" 2>&1)
  WS_EXIT=$?

  if [ $WS_EXIT -eq 0 ] && echo "$OUTPUT" | grep -q "SUCCESS"; then
    echo -e "   ${GREEN}✓ PASS${NC}: WebSocket connection established"
    ((PASS++))
    if echo "$OUTPUT" | grep -q "INIT_RECEIVED"; then
      echo -e "   ${GREEN}✓ PASS${NC}: Received 'init' message"
      ((PASS++))
    fi
    if echo "$OUTPUT" | grep -q "PONG_RECEIVED"; then
      echo -e "   ${GREEN}✓ PASS${NC}: Ping/pong successful"
      ((PASS++))
    fi
  else
    echo -e "   ${RED}✗ FAIL${NC}: WebSocket connection failed"
    # Show only error type, not full details
    if echo "$OUTPUT" | grep -q "ERROR:"; then
      echo -e "   ${RED}Reason${NC}: Connection error"
    elif echo "$OUTPUT" | grep -q "TIMEOUT"; then
      echo -e "   ${RED}Reason${NC}: Connection timeout"
    elif echo "$OUTPUT" | grep -q "CLOSED_EARLY"; then
      echo -e "   ${RED}Reason${NC}: Connection closed early"
    fi
    ((FAIL++))
  fi
else
  skip_test "Node.js not available for WebSocket test"
fi
echo ""

# Test 5.2: WebSocket auth rejection
echo "5.2 WebSocket Auth Rejection Test"
if command -v node &> /dev/null; then
  # Note: WebSocket 'open' event fires first, then server checks token and closes with 4001
  OUTPUT=$(cd "$PROJECT_ROOT" && node -e "
    const WebSocket = require('ws');
    const wsUrl = process.argv[1];

    const ws = new WebSocket(wsUrl + '?token=invalid-token');
    let gotClose = false;

    ws.on('open', () => {
      // Connection opens first, then server checks token and closes
    });

    ws.on('close', (code) => {
      gotClose = true;
      if (code === 4001) {
        console.log('AUTH_REJECTED');
        process.exit(0);
      } else {
        console.log('WRONG_CODE:' + code);
        process.exit(1);
      }
    });

    ws.on('error', () => {});

    setTimeout(() => {
      if (!gotClose) {
        console.log('TIMEOUT');
        process.exit(1);
      }
    }, 5000);
  " "$WS_URL" 2>&1)
  WS_AUTH_EXIT=$?

  if [ $WS_AUTH_EXIT -eq 0 ] && echo "$OUTPUT" | grep -q "AUTH_REJECTED"; then
    echo -e "   ${GREEN}✓ PASS${NC}: WebSocket rejects invalid token (code 4001)"
    ((PASS++))
  else
    echo -e "   ${RED}✗ FAIL${NC}: WebSocket auth rejection failed"
    ((FAIL++))
  fi
else
  skip_test "Node.js not available for WebSocket auth test"
fi
echo ""

#################################################################
# Summary
#################################################################

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${GREEN}Passed:${NC}  $PASS"
echo -e "${RED}Failed:${NC}  $FAIL"
echo -e "${YELLOW}Skipped:${NC} $SKIP"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  exit 1
fi
