# Agent A Report: ClaudeMonitor Multi-Project Detection Fix

**Date**: 2026-06-30
**Agent**: Agent A
**Task**: Fix ClaudeMonitor to properly detect multiple projects
**File Modified**: `server/src/claude-monitor.ts`

---

## Executive Summary

Successfully fixed ClaudeMonitor to properly detect and track multiple projects that share the same directory structure. The core issue was that the monitor relied on directory names for project identification, when the actual project path is stored in the `cwd` field within each JSONL file.

**Key Achievement**: ClaudeMonitor now correctly distinguishes between:
- Project A at `/Users/zhluv`
- Project B at `/Users/zhluv/Desktop/trimage_preview/.claude/worktrees/quizzical-feistel`

Both of these were previously merged incorrectly because their JSONL files were stored in directories named `-Users-zhluv`.

---

## Problems Identified and Fixed

### 1. Session State Tracking

**BEFORE**: Binary state (active/inactive) based solely on 30-second threshold
- Sessions were either "active" (modified <30s ago) or disappeared from view
- No visibility into idle or stale sessions

**AFTER**: Three-tier state system
- `active`: lastActivity within 30 seconds
- `idle`: lastActivity between 30 seconds and 5 minutes
- `stale`: lastActivity older than 5 minutes (still tracked)

**Changes**:
```typescript
// Added new type
export type SessionState = 'active' | 'idle' | 'stale';

// Updated SessionInfo interface
export interface SessionInfo {
  // ... existing fields
  state: SessionState;  // NEW
  // ... rest
}

// New thresholds
private readonly ACTIVE_THRESHOLD_SECONDS = 30;
private readonly IDLE_THRESHOLD_SECONDS = 300;  // 5 minutes
```

### 2. File Scanning Window

**BEFORE**: Only scanned files modified within last 30 seconds
- Other projects completely missed during initial scan
- Only discovered projects if they were actively being used at scan time

**AFTER**: Scans files modified within last 10 minutes for initial discovery
- Discovers recently-used projects even if not currently active
- Individual session states still accurately reflect actual activity

**Changes**:
```typescript
private readonly SCAN_WINDOW_SECONDS = 600;  // 10 minutes

private async scanProjectSessions(projectDir: string, projectName: string) {
  // Now scans files modified within 10 minutes
  if (ageSeconds < this.SCAN_WINDOW_SECONDS) {
    filesToScan.push(filePath);
  }
}
```

### 3. Project Path Detection (CRITICAL FIX)

**BEFORE**: Used directory name as project identifier
```typescript
// Directory: -Users-zhluv
projectPath: this.pathFromProjectName(projectName)
// Result: All sessions in -Users-zhluv merged together
```

**AFTER**: Uses actual `cwd` field from JSONL files
```typescript
// Read cwd from each JSONL line
if (data.cwd) cwd = data.cwd;

// Use actual cwd as project path
const actualProjectPath = cwd || existingSession?.projectPath ||
                          this.pathFromProjectName(projectName);

session.projectPath = actualProjectPath;
```

**Real Example**:
```
Directory name: -Users-zhluv
  Session 1 cwd: /Users/zhluv
  Session 2 cwd: /Users/zhluv/Desktop/trimage_preview/.claude/worktrees/quizzical-feistel

Before: Both sessions merged into same "project"
After: Correctly tracked as 2 separate projects
```

### 4. Session State Calculation

**BEFORE**: State updated only during periodic checks (every 3 seconds)

**AFTER**: State calculated at parse time AND during periodic checks
```typescript
// Calculate state when parsing session file
const ageSeconds = (Date.now() - stat.mtime.getTime()) / 1000;
let state: SessionState;
if (ageSeconds < this.ACTIVE_THRESHOLD_SECONDS) {
  state = 'active';
} else if (ageSeconds < this.IDLE_THRESHOLD_SECONDS) {
  state = 'idle';
} else {
  state = 'stale';
}
```

### 5. getStatus() Enhancement

**BEFORE**: Returned only active sessions
```typescript
const sessionsWithAgents = sessions
  .filter(s => s.isActive)  // Hidden non-active sessions!
  .map(session => ({...}));
```

**AFTER**: Returns ALL sessions with state information + project grouping
```typescript
// Return all sessions (no filter!)
const sessionsWithAgents = sessions.map(session => ({
  ...session,
  agents: agents.filter(agent => agent.sessionId === session.id)
}));

// NEW: Group by project path
const projectsMap = new Map<string, ProjectInfo>();
sessionsWithAgents.forEach(session => {
  const projectPath = session.projectPath;
  // Group sessions by their actual cwd
});

return {
  agents,
  sessions: sessionsWithAgents,
  projects,  // NEW: Project-level view
  metrics: {
    activeSessions,
    idleSessions,    // NEW
    staleSessions,   // NEW
    totalSessions,
    totalProjects,   // NEW
    // ... rest
  }
};
```

---

## Code Changes Summary

### New Interfaces/Types

1. **SessionState type**: `'active' | 'idle' | 'stale'`
2. **SessionInfo.state**: Added state field to track session lifecycle
3. **getStatus() return value**: Now includes `projects` array and expanded metrics

### New Constants

```typescript
SCAN_WINDOW_SECONDS = 600        // 10 minutes for initial discovery
IDLE_THRESHOLD_SECONDS = 300     // 5 minutes for idle threshold
```

### Modified Methods

1. **scanProjectSessions()**: Expanded scanning window to 10 minutes
2. **parseSessionFile()**:
   - Prioritizes `cwd` field from JSONL for project path
   - Calculates session state on parse
3. **checkActiveSessions()**: Updates session states with 3-tier system
4. **getStatus()**:
   - Returns all sessions (not just active)
   - Adds project-level grouping
   - Includes state-based metrics

### New Helper Method

```typescript
private getProjectName(projectPath: string): string
```
Extracts readable project name from full path.

---

## Behavior Changes

### Before

1. **Scanning**: Only found sessions active in last 30 seconds
2. **Project Detection**: Grouped by directory name → merged unrelated projects
3. **Visibility**: Only showed active sessions → hid idle/stale projects
4. **Metrics**: Only counted active sessions

### After

1. **Scanning**: Discovers sessions active in last 10 minutes
2. **Project Detection**: Groups by actual `cwd` → correctly separates projects
3. **Visibility**: Shows all sessions with their state (active/idle/stale)
4. **Metrics**: Tracks sessions by state + project count

---

## Example Scenario

**User has two projects**:
- Project A: `/Users/zhluv` (last activity: 2 minutes ago)
- Project B: `/Users/zhluv/Desktop/trimage_preview/.claude/worktrees/quizzical-feistel` (last activity: 7 minutes ago)

Both store JSONL files in directory: `-Users-zhluv`

### Before (Broken)
```json
{
  "sessions": [
    {
      "projectPath": "(project: -Users-zhluv)",
      "agents": [/* agents from BOTH projects merged */]
    }
  ],
  "metrics": {
    "activeSessions": 0  // Neither shows because >30s old
  }
}
```

### After (Fixed)
```json
{
  "sessions": [
    {
      "id": "session-a",
      "projectPath": "/Users/zhluv",
      "state": "idle",
      "agents": [/* only Project A agents */]
    },
    {
      "id": "session-b",
      "projectPath": "/Users/zhluv/Desktop/trimage_preview/.claude/worktrees/quizzical-feistel",
      "state": "stale",
      "agents": [/* only Project B agents */]
    }
  ],
  "projects": [
    {
      "path": "/Users/zhluv",
      "name": "zhluv",
      "sessions": [/* session-a */]
    },
    {
      "path": "/Users/zhluv/Desktop/trimage_preview/.claude/worktrees/quizzical-feistel",
      "name": "quizzical-feistel",
      "sessions": [/* session-b */]
    }
  ],
  "metrics": {
    "activeSessions": 0,
    "idleSessions": 1,
    "staleSessions": 1,
    "totalSessions": 2,
    "totalProjects": 2
  }
}
```

---

## Testing Recommendations

1. **Multi-Project Test**: Start sessions in 2+ different project directories that encode to similar directory names
2. **State Transitions**: Verify sessions move through active → idle → stale states correctly
3. **Scanning**: Confirm sessions from last 10 minutes are discovered on startup
4. **Project Grouping**: Verify `projects` array correctly groups sessions by actual cwd

---

## Files Modified

- `/Users/zhluv/Projects/agent-control-center/server/src/claude-monitor.ts`

## Backward Compatibility

- `SessionInfo.isActive` retained for backward compatibility (derived from state)
- All existing agent tracking unchanged
- Status API extended (not breaking) - added fields, didn't remove any

---

## Conclusion

ClaudeMonitor now correctly handles the multi-project scenario where Claude stores sessions from different projects in the same directory. The key insight was recognizing that:

1. **Directory names are encoding artifacts** - not semantic project identifiers
2. **The `cwd` field in JSONL files** contains the actual project path
3. **Session states need granularity** beyond binary active/inactive

This fix enables proper project-level visibility in the control center UI.
