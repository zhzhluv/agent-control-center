# Agent A - Server/Data Implementation Report

## Overview
Successfully implemented "needs review candidate" detection feature on the server side of the Agent Control Center. The implementation follows a conservative, read-only approach that marks agents as potential candidates for review without sending any commands to the sessions.

## Modified Files

### 1. `/server/src/claude-monitor.ts`
**Key Changes:**

#### AgentInfo Interface Enhancement (Lines 17-37)
Added three new fields to track review candidate status:
```typescript
needsReview: boolean;           // Whether this agent is a review candidate
reviewCandidateAt?: string;     // ISO timestamp when marked as candidate
reviewReason?: string;          // Reason for marking as candidate
```

#### Configuration Constants (Line 78)
Added review detection threshold:
```typescript
private readonly REVIEW_CANDIDATE_THRESHOLD_SECONDS = 30; // 30s with no new activity
```

#### Review Detection Logic (Lines 630-694)
Implemented `checkNeedsReview()` method with conservative heuristics:
- Agent must be in 'idle' status (not actively working)
- Must have recent activity logged
- At least 30 seconds must have passed since last activity
- Last tool_result must be successful (is_error: false)
- No tool_use or message activities after the last result
- No recent error results in activity log
- Returns review candidate status with reason

#### Agent Initialization Updates
- Lines 250-276: 새 활동이 없을 때만 기존 상태 유지, 새 활동/working 재진입 시 해제
- Lines 319-345: main agent도 동일 로직 적용

#### Active Session Checking Enhancement (Lines 436-498)
Modified `checkActiveSessions()` to:
- Detect when agents transition to 'idle' status
- Run review candidate detection for idle agents
- Automatically clear review candidate status when agent becomes active again
- Emit agent_updated events when review status changes
- Track both status changes and review status changes separately

### 2. `/server/src/codex-monitor.ts`
**Key Changes:**

#### Configuration Constants (Line 24)
Added same review detection threshold:
```typescript
private readonly REVIEW_CANDIDATE_THRESHOLD_SECONDS = 30;
```

#### Agent Initialization Update (Lines 195-218)
needsReview 필드 포함, 새 활동이 없을 때만 기존 상태 유지, 새 활동/working 재진입 시 해제:
```typescript
needsReview: shouldClearReview ? false : (existingAgent?.needsReview || false),
reviewCandidateAt: shouldClearReview ? undefined : existingAgent?.reviewCandidateAt,
reviewReason: shouldClearReview ? undefined : existingAgent?.reviewReason,
```

#### Review Detection Logic (Lines 360-418)
Implemented `checkNeedsReview()` method with conservative heuristics for Codex:
- Same basic checks as Claude Monitor
- Codex도 assistant/result가 있어야 검수 필요 후보가 됨
- `lastResultIndex === -1`이면 `needsReview: false` 반환
- user message만 있는 세션은 검수 필요 후보가 아님
- Returns reason: "Successful operation completed, idle for Xs"

#### Active Session Checking Enhancement (Lines 443-511)
Updated `checkActiveSessions()` with same logic as Claude Monitor:
- Status change detection
- Review candidate detection for idle agents
- Auto-clear review status when active
- Emit events on changes

## Added Fields/Logic Explanation

### needsReview (boolean)
- Indicates whether the agent is currently flagged as a review candidate
- Set to `true` only when all conservative heuristics are met
- Automatically reset to `false` when:
  - Agent receives new activity (becomes working/active)
  - Heuristics no longer satisfied on next check
  - New user messages or tool uses detected

### reviewCandidateAt (optional string)
- ISO 8601 timestamp of when the agent was first marked as review candidate
- Format: `new Date().toISOString()`
- Example: "2026-07-01T10:30:45.123Z"
- Undefined when needsReview is false
- Allows UI to show "how long has this been waiting for review"

### reviewReason (optional string)
- Human-readable explanation of why marked as candidate
- Example: "Successful operation completed, idle for 45s"
- Helps operators understand the detection reasoning
- Can be displayed in UI tooltips or detail views

## Conservative Heuristics

The implementation uses **conservative detection** to minimize false positives:

1. **Status Check**: Only idle agents are considered (not working/waiting)

2. **Time Threshold**: At least 30 seconds of inactivity required

3. **Success Verification**: Last tool_result must have is_error: false

4. **Activity Gap**: No tool_use or user messages after the last successful result

5. **Error Exclusion**: Any recent error in activity log disqualifies the agent

6. **Auto-Clear**: New activity automatically clears the review candidate flag

This approach ensures we only flag agents that appear to have genuinely completed their work and are waiting idle.

## Important Principles Maintained

### 1. Read-Only Policy
- No commands sent to Claude/Codex sessions
- No modification of session state
- Only observes and analyzes existing log data
- Purely passive monitoring

### 2. "Candidate" Not "Confirmed"
- Implementation is explicitly a "review candidate" detector
- Does NOT claim work is definitively complete
- Requires human review/approval before any action
- Does NOT interact with Claude/Codex approval mechanisms

### 3. No Confusion with Native Approval
- Independent from Claude/Codex's own completion detection
- Does not mimic or interfere with native approval requests
- Server-side analysis only, separate from agent's own state
- Can coexist with whatever approval mechanisms exist

### 4. Event-Driven Updates
- Emits 'agent_updated' events when review status changes
- Allows UI to reactively update without polling
- Status changes broadcast via existing event system
- Minimal performance impact (runs every 3 seconds with other checks)

## Testing Method

### Manual Testing Steps

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Monitor an active Claude/Codex session**:
   - Start a task that will complete (e.g., "Read this file and summarize it")
   - Watch the agent in the UI/logs

3. **Verify detection**:
   - After task completes successfully
   - Wait 30+ seconds with no new activity
   - Check agent data - should have:
     ```json
     {
       "needsReview": true,
       "reviewCandidateAt": "2026-07-01T...",
       "reviewReason": "Successful operation completed, no activity for 45s"
     }
     ```

4. **Verify auto-clear**:
   - Send new message to the agent
   - Within 3 seconds (next check cycle), needsReview should become false
   - reviewCandidateAt and reviewReason should be undefined

5. **Verify error handling**:
   - Run a task that produces an error
   - Agent should NOT be marked as review candidate
   - Even after 30s idle time

6. **Check console logs**:
   ```bash
   # Server should not show any errors
   # Events should fire: 'agent_updated', 'status_update'
   ```

### Automated Testing (Future)

To add unit tests later:
```typescript
// Test review detection
test('marks agent as review candidate after successful idle period', () => {
  // Setup agent with successful last result
  // Advance time by 30s
  // Check needsReview === true
});

test('does not mark agent with recent errors', () => {
  // Setup agent with error in recent activity
  // Advance time by 30s
  // Check needsReview === false
});

test('clears review status when agent becomes active', () => {
  // Setup agent with needsReview: true
  // Trigger new activity
  // Check needsReview === false
});
```

## Build Verification

```bash
$ npm run build:server
> tsc -p server/tsconfig.json
# SUCCESS - No TypeScript errors
```

All type definitions are correct and compatible with existing codebase.

## Next Steps (For Other Agents)

This server implementation provides the data foundation. Remaining work:

1. **Agent B - UI Display**:
   - Add visual indicator for agents with needsReview: true
   - Display reviewCandidateAt timestamp ("waiting for 2m 15s")
   - Show reviewReason in tooltip or detail panel

2. **Agent C - Human Approval**:
   - Add "Approve/Reject" UI controls
   - Implement approval workflow
   - Track approval decisions

3. **Agent D - Integration Testing**:
   - End-to-end workflow testing
   - Multiple agent scenarios
   - Edge case handling

## Summary

Successfully implemented conservative, read-only "needs review candidate" detection on the server side for both Claude and Codex monitors. The system:

- Adds 3 new fields to AgentInfo
- Detects potential completion using safe heuristics
- Auto-clears when agents resume activity
- Maintains read-only policy
- Passes TypeScript compilation
- Ready for UI integration

No breaking changes. Fully backward compatible with existing frontend code.
