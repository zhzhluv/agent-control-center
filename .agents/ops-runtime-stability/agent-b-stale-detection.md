# Agent B - Stale/Status Detection Report
**Date:** 2026-06-29
**Project:** agent-control-center
**Agent:** Agent B - Stale Detection Implementation

## 목표
에이전트와 세션이 오래 업데이트되지 않았을 때 시각적으로 표시하여 운영 안정성 모니터링 향상

## Changes Made

### 1. Interface Updates
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:13-25`
  - Added `isStale?: boolean` property to `Agent` interface
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:27-33`
  - Added `isStale?: boolean` property to `Session` interface
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/components/PixelOffice.tsx:11-23`
  - Added `isStale?: boolean` property to exported `Agent` interface

### 2. Stale Detection Logic
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:101-108`
  - Added `formatTimeSince()` helper function for human-readable time display (e.g., "5분 전", "2시간 전")

- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:195-243`
  - **Constants:**
    - `AGENT_STALE_THRESHOLD = 5 * 60 * 1000` (5 minutes)
    - `SESSION_STALE_THRESHOLD = 10 * 60 * 1000` (10 minutes)
  - **Functions:**
    - `isAgentStale(agent)`: Checks if agent's last activity exceeds 5 minutes
    - `isSessionStale(session)`: Checks if session's last activity exceeds 10 minutes
    - `getLastActivityTimestamp(agent)`: Retrieves the most recent activity timestamp

### 3. State Management & Timer
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:263`
  - Added `staleCheckTick` state to trigger periodic stale recalculation

- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:289-298`
  - `agentsWithStale` memo: Computes stale status for all agents
  - `sessionsWithStale` memo: Computes stale status for all sessions
  - Recomputes on state change or timer tick

- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:532-539`
  - Added 60-second interval timer to trigger stale recalculation via `setStaleCheckTick`

### 4. UI Updates

#### PixelOffice Component
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:632`
  - Pass `agentsWithStale` instead of raw `state.agents`

- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/components/PixelOffice.tsx:336-350`
  - Stale agents rendered with gray color (`#6a6a7a`) and 40% opacity
  - Applied via `ctx.globalAlpha = 0.4` for semi-transparent rendering

#### Inspector Panel
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:647-665`
  - Added `.stale` class to profile dot and status pill
  - Added "오래됨" (stale) warning badge
  - Display "마지막 업데이트: X분 전" message in task card when stale

#### Staff Board
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:727-750`
  - Added `.stale` class to staff rows
  - Stale agents show with reduced opacity and grayed-out appearance
  - Status text also marked with `.stale-text` class

#### Logs View
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx:852`
  - Use `agentsWithStale` for agent lookup in log entries

### 5. CSS Styling
- **File:** `/Users/zhluv/Projects/agent-control-center/client/src/App.css:1463-1507`
```css
/* Stale status styles */
.profile-dot.stale {
  opacity: 0.4;
  box-shadow: none !important;
  background: #6a6a7a !important;
}

.status-pill.stale {
  opacity: 0.6;
}

.status-pill.stale-warning {
  background: rgba(255, 152, 0, 0.18);
  color: #ffb366;
  font-size: 10px;
  font-weight: 600;
}

.stale-notice {
  display: block;
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255, 152, 0, 0.12);
  color: #ffb366;
  font-size: 11px;
  font-weight: 600;
}

.staff-row.stale {
  opacity: 0.6;
  border-color: rgba(255, 255, 255, 0.04) !important;
}

.staff-row.stale strong,
.staff-row.stale small {
  color: var(--text-secondary);
}

.stale-text {
  color: var(--text-secondary) !important;
  opacity: 0.7;
}
```

## Stale Logic

### Agent Stale Detection
- **Threshold:** 5 minutes (300,000ms)
- **Criteria:** Time since last activity in `recentActivity` array
- **Logic:**
  1. Check if agent has any recent activity
  2. Get timestamp of last activity entry
  3. Compare current time - last activity time > threshold
  4. Agents with no activity yet are NOT marked stale

### Session Stale Detection
- **Threshold:** 10 minutes (600,000ms)
- **Criteria:** Time since `lastActivity` timestamp
- **Logic:**
  1. Check if session has `lastActivity` value
  2. Parse `lastActivity` string to Date
  3. Compare current time - last activity time > threshold
  4. Sessions with no lastActivity are NOT marked stale

### Automatic Refresh
- **Interval:** 1 minute (60,000ms)
- **Mechanism:** `setInterval` updates `staleCheckTick` state
- **Effect:** Triggers `useMemo` recomputation of `agentsWithStale` and `sessionsWithStale`
- **Result:** UI automatically reflects new stale states without user interaction

## Visual Changes

### Staff Board
- Stale agents display with 60% opacity
- Profile dot becomes gray (#6a6a7a) with no glow
- Text fades to secondary color
- Border becomes barely visible

### PixelOffice (Pixel Art View)
- Stale agent characters rendered at 40% opacity (semi-transparent)
- Status color changes to gray (#6a6a7a)
- Maintains animation but appears "faded out"
- Visually distinguishable from active agents

### Agent Inspector
- Profile dot: gray and dim when stale
- Status pill: faded with "오래됨" warning badge
- Task card: displays "마지막 업데이트: X분 전" notice with orange background
- Entire inspector maintains focus but shows temporal context

### Color Palette
- **Stale indicator:** Orange/amber (#ffb366)
- **Stale agent:** Gray (#6a6a7a)
- **Warning background:** rgba(255, 152, 0, 0.18)
- **Notice background:** rgba(255, 152, 0, 0.12)

## Technical Notes

### Performance
- Stale calculation runs on-demand via `useMemo`
- Only recomputes when `state.agents`, `state.sessions`, or `staleCheckTick` changes
- Minimal performance impact: O(n) iteration over agents/sessions once per minute

### Edge Cases Handled
1. **No activity yet:** Agents/sessions with empty activity arrays are NOT marked stale
2. **Invalid timestamps:** NaN checks prevent errors from malformed dates
3. **New events:** Any new agent/session update triggers immediate recalculation
4. **Component unmount:** Timer cleanup in `useEffect` return function

### Future Enhancements
- Make thresholds configurable in Settings tab
- Add tooltip to stale badge explaining threshold
- Consider different thresholds per agent type (main vs sub)
- Add "staleness percentage" visualization (e.g., progress bar)

## Testing Recommendations
1. **Manual Test:** Wait 5+ minutes after agent stops activity, verify stale state appears
2. **Visual Test:** Check opacity/color changes in all views
3. **Timer Test:** Verify automatic update every 60 seconds
4. **Edge Case:** Test with brand-new agents (no activity)
5. **Performance:** Monitor with 10+ agents to ensure smooth recalculation

## Conclusion
Stale detection successfully implemented across all UI surfaces with automatic refresh, providing operators clear visual feedback when agents/sessions become inactive.
