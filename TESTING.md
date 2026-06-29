# Testing Guide - Agent Control Center

Quick reference for running tests and understanding test coverage.

## Test Scripts

### 1. Comprehensive Smoke Tests
**File**: `smoke-test.sh`
**Coverage**: Health, all API endpoints, WebSocket, security, build verification

```bash
# Development mode (uses /tmp/agent-control-center-token)
./smoke-test.sh

# Production mode (explicit token and URL)
./smoke-test.sh "your-auth-token" "http://localhost:9876"
```

**Tests Included:**
- Health endpoint (no auth required)
- Build verification (client + server dist files)
- All 8 API endpoints with schema validation
- Security tests (auth rejection, path traversal, etc.)
- WebSocket connection, init, ping/pong, auth rejection

**Exit Codes:**
- `0` = All tests passed
- `1` = One or more tests failed

### 2. Reports API Security Tests
**File**: `test-reports-api.sh`
**Coverage**: Focused security testing for Reports API

```bash
# Development mode
./test-reports-api.sh

# Explicit token
./test-reports-api.sh "your-auth-token"
```

**Tests Included:**
- List reports endpoint
- Get specific report
- Path traversal attacks (plain, encoded, double-encoded)
- Non-.md file access prevention
- Auth enforcement (no auth, invalid token)

## Test Coverage Summary

| Category | Coverage | Tools |
|----------|----------|-------|
| API Endpoints | 100% (8/8) | bash + curl + node |
| WebSocket | 80% | Node.js |
| Build Verification | 100% | bash |
| Security | 100% | bash + curl |
| Visual Regression | Manual only | N/A |

## Pre-Deployment Checklist

```bash
# 1. Build
npm run build

# 2. Verify builds exist
test -f server/dist/index.js && echo "Server build OK"
test -f client/dist/index.html && echo "Client build OK"

# 3. Run smoke tests
./smoke-test.sh

# 4. Run security tests
./test-reports-api.sh

# 5. Manual UI check
# - Open http://localhost:9876
# - Verify dashboard loads
# - Check Pixel Office renders
# - Test authentication flow
```

## CI/CD Integration

Example GitHub Actions:
```yaml
- name: Build
  run: npm run build

- name: Smoke Tests
  run: |
    export AUTH_TOKEN=$(openssl rand -hex 16)
    npm start &
    sleep 3
    ./smoke-test.sh "$AUTH_TOKEN"
```

## Dependencies

**Required:**
- bash (system)
- curl (system)
- node (project dependency, used for JSON parsing and WebSocket tests)

**NO heavy frameworks:**
- No Playwright
- No Puppeteer
- No Cypress
- No Jest (yet)

## When to Add More Testing

Consider adding heavier testing frameworks when:
- Team grows beyond 2-3 developers
- UI complexity increases significantly
- API becomes more complex (CRUD operations)
- Frequent bugs in production
- Client requests formal coverage reports

## Troubleshooting

### Tests fail with "Connection refused"
Server not running. Start with:
```bash
npm start
# or
npm run dev
```

### WebSocket tests skipped
Node.js not found in PATH. Verify:
```bash
which node
```

### "Unauthorized" errors
Token mismatch. In dev mode, token is stored at `/tmp/agent-control-center-token`.

## For More Details

See: `.agents/visual-qa-runtime-acceptance/agent-c-tooling-report.md`
