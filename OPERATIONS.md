# Operations Guide - Mac Mini Production Deployment

This document provides operational procedures for running Agent Control Center on Mac Mini in production.

## Table of Contents

- [Production Run Procedure](#production-run-procedure)
- [AUTH_TOKEN Management](#auth_token-management)
- [Tailscale Connection](#tailscale-connection)
- [iPad Connection](#ipad-connection)
- [Server Management](#server-management)
- [Log Viewing](#log-viewing)
- [Troubleshooting](#troubleshooting)

---

## Production Run Procedure

### Prerequisites

1. Mac Mini with macOS (Apple Silicon or Intel)
2. Node.js 20+ installed
3. Claude CLI installed and accessible (`claude` command available)
4. Tailscale installed and configured
5. Project cloned and dependencies installed

### Initial Setup

```bash
# 1. Navigate to project directory
cd /Users/zhluv/Projects/agent-control-center

# 2. Install dependencies (if not already done)
npm run setup

# 3. Build the application
npm run build
```

### Starting Production Server

```bash
# 1. Set required environment variables
export AUTH_TOKEN=$(openssl rand -hex 16)
export NODE_ENV=production

# Optional: Set custom port (default: 9876)
# export PORT=9876

# Optional: Set CORS origin for browser access
# export CORS_ORIGIN=http://your-allowed-origin.com

# 2. Start the server
npm start

# Server will be running at http://localhost:9876
```

### Running as Background Process

For long-running production deployment, use `nohup` or `screen`:

**Using nohup:**
```bash
# Start server in background
nohup npm start > /tmp/agent-control-center.log 2>&1 &

# Save the process ID
echo $! > /tmp/agent-control-center.pid
```

**Using screen:**
```bash
# Create a new screen session
screen -S agent-control-center

# Start the server
npm start

# Detach from screen: Ctrl+A, then D
# Reattach later: screen -r agent-control-center
```

---

## AUTH_TOKEN Management

### Security Principles

1. **NEVER commit tokens to version control**
2. **NEVER log tokens to console or files**
3. **NEVER share tokens in documentation or reports**
4. **ALWAYS use environment variables in production**
5. **ROTATE tokens regularly** (recommended: monthly)

### Generating Secure Tokens

**Recommended method:**
```bash
# Generate a cryptographically secure token
export AUTH_TOKEN=$(openssl rand -hex 16)
```

**Alternative methods:**
```bash
# Using /dev/urandom
export AUTH_TOKEN=$(head -c 16 /dev/urandom | xxd -p)

# Using Node.js crypto
export AUTH_TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
```

### Storing Tokens Securely

**Option 1: Shell profile (persistent across sessions)**
```bash
# Add to ~/.zshrc or ~/.bash_profile
echo "export AUTH_TOKEN=$(openssl rand -hex 16)" >> ~/.zshrc
source ~/.zshrc
```

**Option 2: macOS Keychain (most secure)**
```bash
# Store token in keychain
security add-generic-password \
  -a "$USER" \
  -s "agent-control-center" \
  -w "$(openssl rand -hex 16)"

# Retrieve token when needed
export AUTH_TOKEN=$(security find-generic-password \
  -a "$USER" \
  -s "agent-control-center" \
  -w)
```

**Option 3: Environment file (for automation)**
```bash
# Create .env file (NEVER commit this)
echo "AUTH_TOKEN=$(openssl rand -hex 16)" > .env
echo "NODE_ENV=production" >> .env

# Load before starting server
source .env && npm start
```

### Token Verification

The server enforces the following token policies:

- **Production mode**: AUTH_TOKEN is REQUIRED. Server will not start without it.
- **Development mode**: Temporary token auto-generated and saved to `/tmp/agent-control-center-token`
- **Invalid tokens**: WebSocket connections return close code 4001 (Unauthorized)

---

## Tailscale Connection

### Initial Setup

1. **Install Tailscale on Mac Mini**
```bash
# Download from https://tailscale.com/download/mac
# Or using Homebrew
brew install --cask tailscale
```

2. **Install Tailscale on iPad**
   - Download from App Store
   - Sign in with the same account as Mac Mini

3. **Start Tailscale on Mac Mini**
```bash
# Start Tailscale
sudo tailscale up

# Verify connection
tailscale status

# Get your Tailscale IP address
tailscale ip -4
```

### Verifying Connection

```bash
# Check Tailscale status
tailscale status

# Expected output includes:
# - Mac Mini with IP address (e.g., 100.x.x.x)
# - iPad with IP address (if online)
# - Connection status: "active"

# Test connectivity from Mac Mini to iPad
ping <IPAD_TAILSCALE_IP>
```

### Firewall Configuration

Ensure macOS firewall allows incoming connections:

1. **System Settings > Network > Firewall**
2. Enable "Firewall Options"
3. Add exception for Node.js or the terminal app
4. Or disable "Block all incoming connections"

### Tailscale Access Control

For additional security, use Tailscale ACLs:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["<IPAD_TAILSCALE_IP>"],
      "dst": ["<MAC_MINI_TAILSCALE_IP>:9876"]
    }
  ]
}
```

---

## iPad Connection

### Connection Procedure

1. **Ensure both devices are on Tailscale**
   - Check Tailscale app on iPad shows "Connected"
   - Mac Mini appears in device list

2. **Get Mac Mini Tailscale IP**
   ```bash
   # On Mac Mini terminal
   tailscale ip -4
   # Example output: 100.64.1.2
   ```

3. **Open Safari on iPad**
   - Navigate to: `http://<MAC_MINI_TAILSCALE_IP>:9876`
   - Example: `http://100.64.1.2:9876`

4. **Authenticate**
   - Enter AUTH_TOKEN when prompted
   - Token is stored in browser session storage

5. **Verify Connection**
   - Dashboard should show real-time data
   - Check Settings tab for connection status
   - Confirm "Connected" state and recent timestamp

### Troubleshooting iPad Connection

**Cannot reach server:**
```bash
# On Mac Mini, verify server is running
curl http://localhost:9876/api/health

# Check Tailscale connectivity from iPad
# (Use Termius or Working Copy app with SSH access)
ping <MAC_MINI_TAILSCALE_IP>
```

**WebSocket connection fails:**
- Check AUTH_TOKEN is correct
- Verify no rate limiting (max 30 connections per minute in production)
- Check browser console for error codes:
  - 4001: Invalid token
  - 4029: Rate limited

**Connection drops frequently:**
- Check iPad sleep settings (may close connections)
- Verify Tailscale stays connected on iPad
- Review server logs for disconnection patterns

---

## Server Management

### Starting the Server

**Development mode:**
```bash
npm run dev
# - Runs server and client with hot reload
# - Auto-generates temporary token
# - Token saved to /tmp/agent-control-center-token
```

**Production mode:**
```bash
# Ensure environment variables are set
export AUTH_TOKEN=$(openssl rand -hex 16)
export NODE_ENV=production

npm start
# - Runs built server only (port 9876)
# - Requires AUTH_TOKEN or server will exit
```

### Stopping the Server

**If running in foreground:**
```bash
# Press Ctrl+C in terminal
```

**If running with nohup:**
```bash
# Find process ID
cat /tmp/agent-control-center.pid

# Or search by process name
ps aux | grep "node.*agent-control-center"

# Kill the process
kill <PID>

# Force kill if needed
kill -9 <PID>
```

**If running in screen:**
```bash
# Reattach to screen
screen -r agent-control-center

# Press Ctrl+C to stop
# Exit screen: Ctrl+A, then K (kill window)
```

### Restarting the Server

**Clean restart:**
```bash
# Stop server (Ctrl+C or kill)
# Wait for graceful shutdown
# Start again
npm start
```

**Rebuild and restart:**
```bash
# Stop server
# Rebuild application
npm run build

# Start server
npm start
```

### Process Management with launchd (macOS)

For automatic startup on Mac Mini boot:

**IMPORTANT**: Never hardcode AUTH_TOKEN in the plist file. Use an external environment file.

1. Create environment file with secure permissions:
```bash
# Generate token and store in env file
echo "AUTH_TOKEN=$(openssl rand -hex 32)" > ~/.agent-control-center.env
echo "NODE_ENV=production" >> ~/.agent-control-center.env
chmod 600 ~/.agent-control-center.env
```

2. Copy and customize the plist template:
```bash
# Copy template
cp deploy/launchd/com.zhluv.agent-control-center.plist.example \
   ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist

# Edit: replace YOUR_USERNAME with your actual username
# Edit: verify npm path (Intel: /usr/local/bin, Apple Silicon: /opt/homebrew/bin)
```

3. Load the launch agent:
```bash
launchctl load ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist

# Unload: launchctl unload ~/Library/LaunchAgents/com.zhluv.agent-control-center.plist
# Start: launchctl start com.zhluv.agent-control-center
# Stop: launchctl stop com.zhluv.agent-control-center
```

See `deploy/launchd/com.zhluv.agent-control-center.plist.example` for the complete template.

---

## Log Viewing

### Server Logs

**Development mode (stdout):**
```bash
# Logs appear in terminal where npm run dev was executed
# Includes both server and client logs
```

**Production mode with nohup:**
```bash
# View full log
cat /tmp/agent-control-center.log

# Follow log in real-time
tail -f /tmp/agent-control-center.log

# View last 50 lines
tail -n 50 /tmp/agent-control-center.log

# Search for errors
grep -i "error\|fatal\|fail" /tmp/agent-control-center.log
```

**Production mode with launchd:**
```bash
# Standard output
tail -f /tmp/agent-control-center.log

# Error output
tail -f /tmp/agent-control-center-error.log
```

### Claude Session Logs

Agent Control Center monitors Claude sessions from:
```
~/.claude/
```

**View session files:**
```bash
# List active sessions
ls -la ~/.claude/

# View specific session data
cat ~/.claude/<session-id>.json
```

### Client-Side Logs

**Browser Console:**
- Open Safari on iPad
- Settings > Safari > Advanced > Web Inspector
- Or use Safari on Mac: Develop > [iPad Name] > localhost

**Console log levels:**
- Connection events (connect, disconnect, reconnect)
- WebSocket messages (ping/pong)
- Authentication status
- Error messages with codes

### Log Analysis

**Common log messages:**

1. **Server startup:**
```
⚠️  Development mode: Using temporary auth token.
   Token written to: /tmp/agent-control-center-token
```

2. **WebSocket connection:**
```
New WebSocket connection from <IP>
Connection authenticated successfully
```

3. **Rate limiting:**
```
Rate limit exceeded for IP: <IP>
```

4. **Auth failure:**
```
WebSocket authentication failed: Invalid token
```

### Log Rotation

For long-running production deployments:

```bash
# Manual log rotation
mv /tmp/agent-control-center.log /tmp/agent-control-center.log.$(date +%Y%m%d)
touch /tmp/agent-control-center.log

# Or use logrotate (install via Homebrew)
# Create /usr/local/etc/logrotate.d/agent-control-center:
/tmp/agent-control-center.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

---

## Troubleshooting

### Pre-Flight Checklist

Before troubleshooting, verify:

- [ ] Mac Mini is powered on and connected to network
- [ ] Node.js 20+ is installed: `node --version`
- [ ] Project is built: `ls server/dist/index.js`
- [ ] AUTH_TOKEN is set (production): `[ -n "$AUTH_TOKEN" ] && echo "set (${#AUTH_TOKEN} chars)" || echo "NOT SET"`
- [ ] Server process is running: `ps aux | grep node`
- [ ] Tailscale is connected: `tailscale status`
- [ ] Port 9876 is not blocked by firewall
- [ ] iPad is on Tailscale network

### Common Issues

#### 1. Server Won't Start

**Symptom:** `❌ FATAL: AUTH_TOKEN environment variable is required in production.`

**Solution:**
```bash
# Set AUTH_TOKEN before starting
export AUTH_TOKEN=$(openssl rand -hex 16)
export NODE_ENV=production
npm start
```

---

**Symptom:** `Error: listen EADDRINUSE :::9876`

**Solution:**
```bash
# Port is already in use, find and kill the process
lsof -ti:9876 | xargs kill

# Or change port
export PORT=9877
npm start
```

---

**Symptom:** `Cannot find module './index.js'`

**Solution:**
```bash
# Build the project first
npm run build
npm start
```

#### 2. iPad Cannot Connect

**Symptom:** Browser shows "Cannot connect to server"

**Diagnosis:**
```bash
# On Mac Mini, verify server is listening
curl http://localhost:9876/api/health
# Should return: {"status":"ok"}

# Check server logs
tail -f /tmp/agent-control-center.log

# Verify Tailscale IP
tailscale ip -4

# Test from another device on Tailscale
curl http://<MAC_MINI_TAILSCALE_IP>:9876/api/health
```

**Solution:**
1. Verify Tailscale is connected on both devices
2. Check macOS firewall settings
3. Confirm correct IP address
4. Try restarting Tailscale: `sudo tailscale down && sudo tailscale up`

---

**Symptom:** "Unauthorized" or WebSocket closes immediately

**Diagnosis:**
```bash
# Check AUTH_TOKEN in server environment
# (DO NOT echo token, check length instead)
echo ${#AUTH_TOKEN}
# Should return: 32 (for 16-byte hex)

# Check browser console for close code
# 4001 = Invalid token
# 4029 = Rate limited
```

**Solution:**
1. Verify AUTH_TOKEN on server matches token entered on iPad
2. Clear browser cache/storage on iPad
3. Generate new token and restart server
4. Check rate limiting (max 30 connections/minute in production)

#### 3. Connection Drops Frequently

**Symptom:** Dashboard shows "Reconnecting..." repeatedly

**Diagnosis:**
```bash
# Check server logs for disconnection patterns
grep -i "disconnect\|close" /tmp/agent-control-center.log

# Monitor WebSocket pings (should occur every 30s)
# Check browser console for ping/pong messages

# Verify Tailscale stability
tailscale ping <IPAD_TAILSCALE_IP>
```

**Solution:**
1. Check iPad sleep settings (Settings > Display & Brightness > Auto-Lock)
2. Keep Safari tab active on iPad
3. Verify Tailscale connection is stable
4. Check Mac Mini network connection
5. Review server logs for errors during disconnection

#### 4. No Agent Data Visible

**Symptom:** Dashboard loads but shows no sessions or agents

**Diagnosis:**
```bash
# Check if Claude sessions exist
ls -la ~/.claude/

# Verify monitor is watching correct directory
# Check server logs for "Monitoring Claude sessions" message

# Test with curl
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:9876/api/sessions
```

**Solution:**
1. Ensure Claude CLI is running at least one session
2. Verify `~/.claude/` directory exists and is readable
3. Restart server to reinitialize monitor
4. Check file permissions on `~/.claude/` directory

#### 5. High CPU or Memory Usage

**Symptom:** Mac Mini becomes slow, high resource usage

**Diagnosis:**
```bash
# Check process resource usage
ps aux | grep node

# Monitor in real-time
top -pid <PID>

# Check number of connected clients
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:9876/api/diagnostics
```

**Solution:**
1. Check for connection leak (too many WebSocket connections)
2. Review rate limiting settings
3. Restart server to clear any accumulated state
4. Check for runaway Claude sessions
5. Monitor file descriptor usage: `lsof -p <PID> | wc -l`

#### 6. Stale Session Data

**Symptom:** Dashboard shows old/incorrect data

**Diagnosis:**
```bash
# Check diagnostics for stale sessions
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:9876/api/diagnostics | jq '.staleSessions'

# Compare with actual file timestamps
ls -lt ~/.claude/
```

**Solution:**
1. Click "Refresh" button in dashboard
2. Restart server to rescan sessions
3. Manually clean up old session files:
```bash
# Remove sessions older than 1 day
find ~/.claude -name "*.json" -mtime +1 -delete
```

### Emergency Recovery

**Complete reset:**
```bash
# 1. Stop server
pkill -f "node.*agent-control-center"

# 2. Clean build artifacts
rm -rf server/dist client/dist

# 3. Reinstall dependencies
npm run setup

# 4. Rebuild
npm run build

# 5. Generate new token
export AUTH_TOKEN=$(openssl rand -hex 16)
export NODE_ENV=production

# 6. Start server
npm start
```

### Getting Help

**Collect diagnostics:**
```bash
# System info
uname -a
node --version
npm --version

# Server status
ps aux | grep node
lsof -ti:9876

# Tailscale status
tailscale status

# Recent logs (last 100 lines)
tail -n 100 /tmp/agent-control-center.log

# Diagnostics endpoint
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:9876/api/diagnostics
```

**Important:** When reporting issues, NEVER include:
- AUTH_TOKEN values
- WebSocket URLs with token parameters
- Session IDs or personal data
- IP addresses (except Tailscale IPs if relevant)

---

## Health Monitoring

### Regular Health Checks

**Server health:**
```bash
# Health endpoint (no auth required)
curl http://<TAILSCALE_IP>:9876/api/health

# Expected: {"status":"ok"}
```

**Connection diagnostics:**
```bash
curl -H "Authorization: Bearer <TOKEN>" \
  http://<TAILSCALE_IP>:9876/api/diagnostics
```

**Example response:**
```json
{
  "server": {
    "uptime": 3600000,
    "startTime": "2026-06-30T12:00:00.000Z",
    "nodeVersion": "v20.10.0",
    "platform": "darwin",
    "memory": {
      "heapUsed": 25165824,
      "heapTotal": 33554432,
      "external": 1048576,
      "rss": 52428800
    }
  },
  "connections": {
    "activeClients": 1,
    "totalConnections": 5,
    "totalMessages": 150,
    "lastConnected": "2026-06-30T13:00:00.000Z",
    "lastClientMessageAt": "2026-06-30T13:05:00.000Z"
  },
  "monitoring": {
    "activeAgents": 2,
    "activeSessions": 3,
    "totalSessions": 10
  },
  "staleSessions": []
}
```

### Automation Scripts

**Daily health check (add to crontab):**
```bash
#!/bin/bash
# health-check.sh

TOKEN="your-auth-token-here"
URL="http://localhost:9876"

# Check server health
STATUS=$(curl -s "$URL/api/health" | jq -r '.status')

if [ "$STATUS" != "ok" ]; then
    echo "❌ Server health check failed"
    # Send notification (e.g., email, Slack)
    exit 1
fi

# Check diagnostics
CLIENTS=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$URL/api/diagnostics" | jq -r '.connections.activeClients')

echo "✅ Server healthy, $CLIENTS active client(s)"
```

---

## Maintenance

### Regular Tasks

**Weekly:**
- Check server logs for errors or warnings
- Verify Tailscale connection stability
- Review stale session cleanup

**Monthly:**
- Rotate AUTH_TOKEN for security
- Update Node.js and dependencies
- Review and clean up old log files
- Check for application updates

**As Needed:**
- Rebuild after code changes
- Restart server after macOS updates
- Update Tailscale

### Updating Dependencies

```bash
# Check for outdated packages
npm outdated

# Update all dependencies
npm update

# Rebuild after updates
npm run build
```

### Backup

**Critical files to backup:**
- Project configuration (package.json, tsconfig.json)
- Environment variables (if using .env file)
- Custom scripts or configurations

**Session data is ephemeral** - not recommended to back up `~/.claude/` directory.

---

## Security Best Practices

1. **Token Management**
   - Use strong, randomly generated tokens
   - Rotate tokens monthly
   - Never commit tokens to git
   - Store securely (keychain or encrypted vault)

2. **Network Security**
   - Always use Tailscale for remote access
   - Never expose server directly to internet
   - Use CORS_ORIGIN in production
   - Monitor connection attempts

3. **Access Control**
   - Limit Tailscale network to trusted devices
   - Use Tailscale ACLs for additional restrictions
   - Enable macOS firewall
   - Review connected clients regularly

4. **Monitoring**
   - Check logs for unauthorized access attempts
   - Monitor rate limiting events
   - Review stale sessions
   - Set up alerts for server downtime

---

## Performance Optimization

### For Long-Running Deployments

1. **Memory Management**
   - Server automatically cleans up stale sessions (>1 hour old)
   - Restart server weekly to clear accumulated state
   - Monitor memory usage via diagnostics endpoint

2. **Connection Management**
   - Rate limiting prevents connection floods (30/min in production)
   - WebSocket heartbeat detects dead connections (30s interval)
   - Automatic reconnection with exponential backoff

3. **File Watching**
   - Monitor uses efficient file system watching
   - Automatically debounces rapid file changes
   - Minimal CPU overhead

### Resource Limits

Current defaults:
- **Max connections/minute:** 30 (production), 100 (development)
- **WebSocket heartbeat:** 30 seconds
- **Stale session threshold:** 1 hour
- **Max pong timeout:** 5 seconds

---

## Appendix

### Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_TOKEN` | Yes (production) | auto-generated (dev) | Authentication token for API/WebSocket |
| `NODE_ENV` | No | development | Environment mode: production or development |
| `PORT` | No | 9876 | Server port |
| `CORS_ORIGIN` | No | * (dev), false (prod) | Allowed CORS origin for browser access |

### API Endpoints Reference

All endpoints except `/api/health` require `Authorization: Bearer <TOKEN>` header.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | No | Server health check |
| `/api/status` | GET | Yes | Current status summary |
| `/api/metrics` | GET | Yes | Metrics data |
| `/api/diagnostics` | GET | Yes | Detailed diagnostics |
| `/api/agents` | GET | Yes | List of agents |
| `/api/sessions` | GET | Yes | List of sessions |
| `/api/reports` | GET | Yes | List of markdown reports |
| `/api/reports/*` | GET | Yes | Get specific report content |

### WebSocket Events Reference

**Client → Server:**
- `ping` - Heartbeat check (sent every 30s)
- `refresh` - Request status refresh

**Server → Client:**
- `init` - Initial state after connection
- `status_update` - Full status update
- `agent_updated` - Individual agent updated
- `session_updated` - Individual session updated
- `pong` - Heartbeat response
- `error` - Error message

**Close Codes:**
- `4001` - Unauthorized (invalid token)
- `4029` - Too Many Requests (rate limited)

### File Locations Reference

| Path | Description |
|------|-------------|
| `/Users/zhluv/Projects/agent-control-center` | Project root |
| `/Users/zhluv/Projects/agent-control-center/server/dist` | Built server code |
| `/Users/zhluv/Projects/agent-control-center/client/dist` | Built client code |
| `~/.claude/` | Claude session files (monitored) |
| `/tmp/agent-control-center-token` | Dev mode temporary token |
| `/tmp/agent-control-center.log` | Server log (if using nohup) |
| `/tmp/agent-control-center-error.log` | Error log (if using launchd) |

---

**Document Version:** 1.0
**Last Updated:** 2026-06-30
**Author:** Agent A - Production Readiness Slice
