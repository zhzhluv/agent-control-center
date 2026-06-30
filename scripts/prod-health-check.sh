#!/bin/bash

#############################################################################
# Production Health Check Script for Agent Control Center
#############################################################################
# This script checks if the server is running correctly:
# - HTTP health endpoint
# - WebSocket connectivity
# - No token values in output (security)
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
#############################################################################

set -e

# Configuration
PORT="${PORT:-9876}"
HOST="${HOST:-localhost}"
TIMEOUT=5

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Exit code tracker
EXIT_CODE=0

echo "============================================"
echo "Agent Control Center - Production Health Check"
echo "============================================"
echo ""

#############################################################################
# Check 1: HTTP Health Endpoint
#############################################################################
echo -n "1. HTTP Health Check... "

if HTTP_RESPONSE=$(curl -fsS -m $TIMEOUT "http://${HOST}:${PORT}/api/health" 2>&1); then
    # Verify response contains expected fields
    if echo "$HTTP_RESPONSE" | grep -q '"status".*"ok"' && echo "$HTTP_RESPONSE" | grep -q '"uptime"'; then
        echo -e "${GREEN}PASS${NC}"
        echo "   Status: OK, Response: $HTTP_RESPONSE"
    else
        echo -e "${RED}FAIL${NC}"
        echo "   Unexpected response format: $HTTP_RESPONSE"
        EXIT_CODE=1
    fi
else
    echo -e "${RED}FAIL${NC}"
    echo "   Cannot reach health endpoint at http://${HOST}:${PORT}/api/health"
    echo "   Error: $HTTP_RESPONSE"
    EXIT_CODE=1
fi

echo ""

#############################################################################
# Check 2: WebSocket Connectivity
#############################################################################
echo -n "2. WebSocket Connectivity... "

# Read token from environment (DO NOT hardcode)
if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${YELLOW}SKIP${NC}"
    echo "   AUTH_TOKEN not set. Cannot test WebSocket."
    echo "   Set AUTH_TOKEN environment variable to enable this check."
    EXIT_CODE=1
else
    # Use Node.js to test WebSocket (avoids token in command line args)
    if command -v node &> /dev/null; then
        # Node-based WebSocket test - token passed via environment, never in args or output
        WS_RESULT=$(timeout $TIMEOUT node -e "
const ws = require('ws');
const token = process.env.AUTH_TOKEN;
if (!token) { console.log('NO_TOKEN'); process.exit(1); }
const client = new ws.WebSocket('ws://${HOST}:${PORT}?token=' + token);
let gotInit = false;
client.on('open', () => { client.send(JSON.stringify({type:'ping'})); });
client.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'init' || msg.type === 'pong') { gotInit = true; client.close(); }
  } catch(e) {}
});
client.on('close', () => { console.log(gotInit ? 'SUCCESS' : 'FAIL'); process.exit(gotInit ? 0 : 1); });
client.on('error', () => { console.log('ERROR'); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT'); client.close(); process.exit(1); }, 4000);
" 2>/dev/null)

        if [ "$WS_RESULT" = "SUCCESS" ]; then
            echo -e "${GREEN}PASS${NC}"
            echo "   WebSocket connection and ping/pong verified"
        else
            echo -e "${RED}FAIL${NC}"
            echo "   WebSocket connection failed (result: $WS_RESULT)"
            EXIT_CODE=1
        fi
    else
        # Fallback: just check if port is listening
        if nc -z -w $TIMEOUT "$HOST" "$PORT" 2>/dev/null; then
            echo -e "${GREEN}PASS${NC}"
            echo "   Port ${PORT} is listening (node not available for full WebSocket test)"
        else
            echo -e "${RED}FAIL${NC}"
            echo "   Port ${PORT} is not accessible"
            EXIT_CODE=1
        fi
    fi
fi

echo ""

#############################################################################
# Check 3: Server Process
#############################################################################
echo -n "3. Server Process Check... "

if pgrep -f "node.*agent-control-center" > /dev/null; then
    echo -e "${GREEN}PASS${NC}"
    PROCESS_COUNT=$(pgrep -f "node.*agent-control-center" | wc -l)
    echo "   Found ${PROCESS_COUNT} agent-control-center process(es)"
else
    echo -e "${RED}FAIL${NC}"
    echo "   No agent-control-center process found"
    EXIT_CODE=1
fi

echo ""

#############################################################################
# Check 4: Log File Access
#############################################################################
echo -n "4. Log File Access... "

LOG_DIR="${HOME}/Library/Logs"
LOG_FILE="${LOG_DIR}/agent-control-center.log"
ERROR_LOG="${LOG_DIR}/agent-control-center.error.log"

if [ -f "$LOG_FILE" ] || [ -f "$ERROR_LOG" ]; then
    echo -e "${GREEN}PASS${NC}"

    if [ -f "$LOG_FILE" ]; then
        LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || echo "0")
        echo "   Standard log: ${LOG_FILE} (${LOG_SIZE} bytes)"
    fi

    if [ -f "$ERROR_LOG" ]; then
        ERROR_SIZE=$(stat -f%z "$ERROR_LOG" 2>/dev/null || echo "0")
        echo "   Error log: ${ERROR_LOG} (${ERROR_SIZE} bytes)"

        # Check for recent errors
        if [ -s "$ERROR_LOG" ]; then
            RECENT_ERRORS=$(tail -5 "$ERROR_LOG" 2>/dev/null | grep -i "error\|fatal\|exception" || echo "")
            if [ -n "$RECENT_ERRORS" ]; then
                echo -e "   ${YELLOW}WARNING: Recent errors detected in log${NC}"
            fi
        fi
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    echo "   Log files not found (expected if service just started)"
fi

echo ""

#############################################################################
# Summary
#############################################################################
echo "============================================"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}All checks passed!${NC}"
else
    echo -e "${RED}Some checks failed. Please review above.${NC}"
fi
echo "============================================"

exit $EXIT_CODE
