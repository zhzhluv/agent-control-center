# Agent B: launchd Template and Operations Scripts

**Task**: Create launchd template and operation scripts for production deployment

**Status**: COMPLETE

**Date**: 2026-06-30

---

## Files Created

### 1. `/deploy/launchd/com.zhluv.agent-control-center.plist.example`

launchd configuration template for running Agent Control Center as a background service on macOS.

**Key Features**:
- Label: `com.zhluv.agent-control-center`
- Program: `npm start` (runs compiled server from `server/dist/index.js`)
- Environment: `NODE_ENV=production`
- Working Directory: Placeholder for user's project path
- Logs: Written to `~/Library/Logs/agent-control-center.{log,error.log}`
- Auto-start: `RunAtLoad=true`, `KeepAlive=true`
- Crash Recovery: 60-second throttle interval
- Process Priority: Nice level 5 (lower priority)

**Security**:
- AUTH_TOKEN is NOT hardcoded
- Comments instruct users to load from external source
- Users must configure token separately

### 2. `/scripts/prod-health-check.sh`

Production health check script with comprehensive server validation.

**Checks Performed**:
1. HTTP Health Endpoint (`/api/health`)
   - Validates response format
   - Confirms server is responding
2. WebSocket Connectivity
   - Tests WebSocket connection if AUTH_TOKEN is available
   - Fallback to port check if wscat not installed
3. Server Process
   - Verifies node process is running
   - Counts active processes
4. Log File Access
   - Checks for log files in `~/Library/Logs/`
   - Detects recent errors in error log

**Security Features**:
- DOES NOT output token values
- Redacts tokens in WebSocket test output
- Uses AUTH_TOKEN from environment only
- Exit codes: 0 for success, 1 for failure

**Usage**:
```bash
# Run with AUTH_TOKEN from environment
# Load from env file and run health check
set -a; . ~/.agent-control-center.env; set +a
./scripts/prod-health-check.sh
```

### 3. `.env.example`

Environment variable template with security documentation.

**Variables**:
- `AUTH_TOKEN` (REQUIRED for production) - placeholder value only
- `NODE_ENV` - defaults to production
- `PORT` - defaults to 9876
- `CORS_ORIGIN` - optional, recommended for production

**Security Notes**:
- Includes token generation command: `openssl rand -hex 32`
- Documents development vs production behavior
- Emphasizes token security best practices
- Explains auto-token generation in dev mode

---

## Installation Instructions

### Prerequisites

1. Project must be built: `npm run build`
2. AUTH_TOKEN must be set in environment
3. macOS system (launchd is macOS-specific)

### Step 1: Configure Environment

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Generate secure token
openssl rand -hex 32

# 3. Edit .env and set AUTH_TOKEN to generated value
nano .env

# 4. Export for launchd (choose one method below)
```

### Step 2: Load AUTH_TOKEN for launchd

launchd services don't inherit user environment variables. Use the env file method:

**Create secure environment file (recommended)**
```bash
# 1. Create environment file (token generated, never displayed)
echo "AUTH_TOKEN=$(openssl rand -hex 32)" > ~/.agent-control-center.env
echo "NODE_ENV=production" >> ~/.agent-control-center.env
chmod 600 ~/.agent-control-center.env

# 2. Verify file exists and has correct permissions
ls -la ~/.agent-control-center.env
# Should show: -rw------- (600 permissions)

# 3. The plist.example already uses this method:
#    ProgramArguments runs: set -a; . "$HOME/.agent-control-center.env"; set +a; npm start
#    This loads the env file without outputting values
```

### Step 3: Customize plist

```bash
# 1. Copy example to working file
cp deploy/launchd/com.zhluv.agent-control-center.plist.example \
   deploy/launchd/com.zhluv.agent-control-center.plist

# 2. Edit and replace placeholders:
#    - YOUR_USERNAME → your actual username
#    - Verify npm path: which npm
nano deploy/launchd/com.zhluv.agent-control-center.plist

# 3. Verify paths
ls ~/Library/Logs/  # ensure directory exists
```

### Step 4: Install and Start Service

```bash
# 1. Copy plist to LaunchAgents directory
cp deploy/launchd/com.zhluv.agent-control-center.plist \
   ~/Library/LaunchAgents/

# 2. Load service
launchctl load ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist

# 3. Verify it's running
launchctl list | grep agent-control-center

# 4. Check logs
tail -f ~/Library/Logs/agent-control-center.log
tail -f ~/Library/Logs/agent-control-center.error.log
```

### Step 5: Verify with Health Check

```bash
# Load token from env file and run health check
set -a; . ~/.agent-control-center.env; set +a
./scripts/prod-health-check.sh

# Expected output:
# 1. HTTP Health Check... PASS
# 2. WebSocket Connectivity... PASS
# 3. Server Process Check... PASS
# 4. Log File Access... PASS
```

---

## Service Management Commands

```bash
# Check if service is loaded
launchctl list | grep agent-control-center

# View service status
launchctl print gui/$(id -u)/com.zhluv.agent-control-center

# Stop service
launchctl stop com.zhluv.agent-control-center

# Start service (if loaded)
launchctl start com.zhluv.agent-control-center

# Unload service
launchctl unload ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist

# Reload after plist changes
launchctl unload ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist
launchctl load ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist
```

---

## Security Considerations

### Token Security

1. **Never hardcode tokens in plist**
   - plist files are readable by other processes
   - Use external file or environment loading

2. **Token file permissions**
   - Set to 600 (owner read/write only)
   - Store in home directory, not in project

3. **Token rotation**
   - Regenerate tokens periodically
   - Update both storage file and server restart

4. **Logging**
   - Health check script never outputs token values
   - Server logs redact tokens (verified in `server/src/index.ts`)

### Network Security

1. **Tailscale VPN recommended**
   - Provides encrypted tunnel
   - Limits access to trusted devices
   - See README.md for Tailscale setup

2. **CORS configuration**
   - Set `CORS_ORIGIN` in .env for production
   - Restricts which origins can access API
   - Example: `CORS_ORIGIN=http://100.64.0.2:9876` (Tailscale IP)

3. **Rate limiting**
   - Built into server (30 connections/minute in production)
   - Protects against brute-force attacks
   - See `server/src/index.ts` lines 64-67

### File System Security

1. **Log file permissions**
   - Default: user-readable only
   - Location: `~/Library/Logs/` (user-private)

2. **Project directory**
   - Keep proper ownership and permissions
   - Don't run as root

3. **.env file**
   - Already in .gitignore
   - Should be 600 permissions
   - Never commit to version control

---

## Troubleshooting

### Service won't start

```bash
# Check system log for errors
log show --predicate 'process == "launchd"' --last 5m | grep agent-control

# Verify plist syntax
plutil -lint ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist

# Check npm path
which npm  # Update plist if different from /usr/local/bin/npm

# Verify AUTH_TOKEN is available to service
launchctl getenv AUTH_TOKEN
```

### Health check fails

```bash
# 1. Verify server is listening
lsof -i :9876

# 2. Check process is running
ps aux | grep agent-control-center

# 3. Check logs for errors
cat ~/Library/Logs/agent-control-center.error.log

# 4. Test manually
curl http://localhost:9876/api/health
```

### Token issues

```bash
# Verify env file exists and has correct permissions (600)
ls -la ~/.agent-control-center.env
# Should show: -rw------- (600 permissions)

# Verify env file size (non-empty)
stat -f%z ~/.agent-control-center.env
# Should show: ~90 bytes (for full env file with AUTH_TOKEN + NODE_ENV + PORT)

# Test server authentication using the health check script
./scripts/prod-health-check.sh
# This script loads AUTH_TOKEN from environment and tests all endpoints
```

---

## Production Checklist

Before deploying to production:

- [ ] Build completed: `npm run build`
- [ ] Strong AUTH_TOKEN generated (32+ hex characters)
- [ ] Token stored securely (600 permissions)
- [ ] plist customized (username, paths)
- [ ] Environment variables configured (.env file)
- [ ] CORS_ORIGIN set (if using remote access)
- [ ] Tailscale configured (for remote iPad access)
- [ ] Service loaded and running
- [ ] Health check passes all tests
- [ ] Logs are being written
- [ ] No tokens in log output
- [ ] Service survives reboot test

---

## References

- Main README: `/README.md`
- Server source: `/server/src/index.ts`
- Test documentation: `/TESTING.md`
- launchd documentation: `man launchd.plist`

---

**Notes**:
- Files are templates/examples only - NOT installed
- Manual installation required (see instructions above)
- No actual token values in any file
- All security best practices documented
