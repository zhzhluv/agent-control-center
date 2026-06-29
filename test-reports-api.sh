#!/bin/bash

# Test script for Reports API
# Usage: ./test-reports-api.sh [AUTH_TOKEN]
# If no token provided, reads from /tmp/agent-control-center-token

if [ -n "$1" ]; then
  AUTH_TOKEN="$1"
elif [ -f "/tmp/agent-control-center-token" ]; then
  AUTH_TOKEN=$(cat /tmp/agent-control-center-token)
else
  echo "Usage: $0 [AUTH_TOKEN]"
  echo "Or ensure /tmp/agent-control-center-token exists (dev mode)"
  exit 1
fi

BASE_URL="http://localhost:9876"
PASS=0
FAIL=0

# Helper: check HTTP status code
check_status() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"

  if [ "$actual" -eq "$expected" ]; then
    echo "   ✅ PASS: HTTP $actual (expected $expected)"
    ((PASS++))
  else
    echo "   ❌ FAIL: HTTP $actual (expected $expected)"
    ((FAIL++))
  fi
}

echo "=== Reports API Test Suite ==="
echo "Base URL: $BASE_URL"
echo ""

# Test 1: List reports (should return 200)
echo "1. GET /api/reports (list all reports)"
STATUS=$(curl -s -o /tmp/test-response.json -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports")
check_status 200 "$STATUS" "List reports"

# Show report count if successful
if [ "$STATUS" -eq 200 ]; then
  COUNT=$(cat /tmp/test-response.json 2>/dev/null | jq -r '.reports | length' 2>/dev/null || echo "?")
  echo "   Found $COUNT reports"
fi
echo ""

# Test 2: Get specific report (should return 200)
echo "2. GET /api/reports/:path (get first report)"
FIRST_REPORT=$(cat /tmp/test-response.json 2>/dev/null | jq -r '.reports[0].path' 2>/dev/null || echo "")

if [ -n "$FIRST_REPORT" ] && [ "$FIRST_REPORT" != "null" ]; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    "$BASE_URL/api/reports/$FIRST_REPORT")
  check_status 200 "$STATUS" "Get report"
  echo "   Report: $FIRST_REPORT"
else
  echo "   ⚠️ SKIP: No reports available"
fi
echo ""

# Test 3: Path traversal - plain with --path-as-is (should return 403)
# Note: --path-as-is prevents curl from normalizing ../ in URLs
echo "3. Security: path traversal ../../../etc/passwd (should return 403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --path-as-is \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports/../../../etc/passwd")
check_status 403 "$STATUS" "Path traversal (plain)"
echo ""

# Test 4: Path traversal - URL encoded (should return 403)
echo "4. Security: path traversal URL-encoded %2e%2e%2f (should return 403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports/..%2F..%2F..%2Fetc%2Fpasswd")
check_status 403 "$STATUS" "Path traversal (encoded)"
echo ""

# Test 5: Path traversal - double encoded (should return 403)
echo "5. Security: path traversal double-encoded %252e%252e (should return 403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports/%2e%2e%252f%2e%2e%252fetc%252fpasswd")
check_status 403 "$STATUS" "Path traversal (double-encoded)"
echo ""

# Test 6: Non-.md file (should return 403)
echo "6. Security: non-.md file request (should return 403)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BASE_URL/api/reports/test.txt")
check_status 403 "$STATUS" "Non-.md file"
echo ""

# Test 7: No auth (should return 401)
echo "7. Security: no auth header (should return 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE_URL/api/reports")
check_status 401 "$STATUS" "No auth"
echo ""

# Test 8: Invalid auth (should return 401)
echo "8. Security: invalid auth token (should return 401)"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer invalid-token-12345" \
  "$BASE_URL/api/reports")
check_status 401 "$STATUS" "Invalid auth"
echo ""

# Cleanup
rm -f /tmp/test-response.json

# Summary
echo "=== Test Summary ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "✅ All tests passed!"
  exit 0
else
  echo "❌ Some tests failed"
  exit 1
fi
