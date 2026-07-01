# Review State Implementation - Testing Guide

## Build Status
✅ TypeScript compilation successful
✅ No type errors
✅ Server builds cleanly

## Manual Testing Steps

### 1. Start the Server

```bash
cd /Users/zhluv/Projects/agent-control-center
npm start
```

Expected output:
```
╔══════════════════════════════════════════════════════╗
║       Agent Control Center is running!               ║
║                                                      ║
║   Local:   http://localhost:9876                     ║
║   Network: Check your Tailscale IP                   ║
║                                                      ║
║   Mode: MONITORING (Claude + Codex)                  ║
║   Watching: ~/.claude/ and ~/.codex/                 ║
║   Auth:  Development (see /tmp/agent-control-center-token)
╚══════════════════════════════════════════════════════╝
```

### 2. Get Auth Token

```bash
cat /tmp/agent-control-center-token
```

Save this token for API requests.

### 3. Create a needsReview Candidate

**Option A: Using Claude Code**
1. Open a Claude Code session
2. Run a simple command: `ls`
3. Wait 30+ seconds without sending new messages
4. The agent should appear with `needsReview: true, reviewState: 'pending'`

**Option B: Using Codex**
1. Open a Codex session
2. Run a command
3. Wait 30+ seconds
4. Check for needsReview status

### 4. Test API Endpoint

**Get current agents status:**
```bash
TOKEN=$(cat /tmp/agent-control-center-token)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:9876/api/agents | jq '.'
```

Look for agents with `needsReview: true` and note their `id`.

**Update review state to 'acknowledged':**
```bash
AGENT_ID="<agent-id-from-above>"
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "acknowledged"}' \
  http://localhost:9876/api/agents/$AGENT_ID/review-state | jq '.'
```

Expected response:
```json
{
  "success": true,
  "agentId": "agent-xxx",
  "reviewState": "acknowledged"
}
```

**Update to 'copied':**
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "copied"}' \
  http://localhost:9876/api/agents/$AGENT_ID/review-state | jq '.'
```

**Update to 'dismissed':**
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "dismissed"}' \
  http://localhost:9876/api/agents/$AGENT_ID/review-state | jq '.'
```

### 5. Test WebSocket Broadcast

1. Open two browser tabs at `http://localhost:9876`
2. In one terminal, update the review state via API
3. Verify both browser tabs show the updated state in real-time

### 6. Test Error Conditions

**Invalid state value:**
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "invalid"}' \
  http://localhost:9876/api/agents/$AGENT_ID/review-state
```

Expected: 400 Bad Request
```json
{
  "error": "Invalid state",
  "message": "State must be one of: pending, acknowledged, copied, dismissed"
}
```

**Non-existent agent:**
```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "acknowledged"}' \
  http://localhost:9876/api/agents/non-existent-id/review-state
```

Expected: 404 Not Found
```json
{
  "error": "Agent not found or not in review state",
  "message": "Cannot update review state for this agent"
}
```

**Agent without needsReview:**
```bash
# Try to update an agent that has needsReview: false
WORKING_AGENT_ID="<id-of-working-agent>"
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"state": "acknowledged"}' \
  http://localhost:9876/api/agents/$WORKING_AGENT_ID/review-state
```

Expected: 404 Not Found (agent not in review state)

### 7. Test Auto-Reset

1. Get an agent with `needsReview: true, reviewState: 'acknowledged'`
2. Send a new message to that agent in Claude Code/Codex
3. Verify that `needsReview` becomes `false` and `reviewState` becomes `undefined`

### 8. Test Server Restart

1. Note the reviewState of a needsReview agent
2. Restart the server: `npm start`
3. Check the agent status:
   - `needsReview` should be recalculated (likely still true if idle)
   - `reviewState` should be reset to 'pending' (server memory cleared)

## Verification Checklist

- [ ] Server starts without errors
- [ ] needsReview candidates are automatically detected after 30s idle
- [ ] reviewState is set to 'pending' when needsReview becomes true
- [ ] API accepts 'acknowledged', 'copied', 'dismissed' states
- [ ] API rejects invalid state values with 400
- [ ] API rejects non-existent agents with 404
- [ ] API rejects agents with needsReview=false with 404
- [ ] WebSocket broadcasts state changes to all clients
- [ ] reviewState resets when agent receives new message/tool_use
- [ ] Server restart resets reviewState but recalculates needsReview
- [ ] No writes to Claude/Codex session files

## Known Behaviors

### Expected
- reviewState is lost on server restart (by design, temporary state)
- needsReview is recalculated from session files (persistent)
- Only agents with needsReview=true can have reviewState updated

### By Design
- Server memory storage (not database)
- Real-time WebSocket sync
- Read-only monitoring of Claude/Codex files

## Next Steps for Agent B

1. Implement UI components for reviewState display
2. Add visual indicators:
   - 'pending': Yellow/warning badge
   - 'acknowledged': Blue/info badge
   - 'copied': Green/success badge
   - 'dismissed': Gray/muted badge
3. Add action buttons for state transitions
4. Integrate copy-to-clipboard functionality
5. Add confirmation dialogs for state changes

## Debugging

**Check server logs:**
```bash
# Look for agent_updated events
# Look for review state changes
```

**Inspect WebSocket messages:**
```javascript
// In browser console
// Messages should include { type: 'agent_updated', data: {..., reviewState: '...'}}
```

**Direct API inspection:**
```bash
# Get all agents and filter for needsReview
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:9876/api/agents | jq '.[] | select(.needsReview == true)'
```
