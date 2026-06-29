# Agent C - Diagnostics Panel Report
**Date:** 2026-06-29
**Project:** agent-control-center
**Status:** ✅ IMPLEMENTED

## Implementation Summary

Successfully implemented a comprehensive diagnostics panel within the Settings tab to provide real-time operational insights into the Agent Control Center.

## API Endpoint

### GET /api/diagnostics

**Location:** `server/src/index.ts`

**Authentication:** Bearer token required (via `auth.verify` middleware)

**Response Schema:**
```json
{
  "uptime": number,                    // Server uptime in seconds
  "startTime": string,                 // ISO timestamp of server start
  "activeSessions": number,            // Number of active sessions
  "totalSessions": number,             // Total sessions (active + inactive)
  "activeAgents": number,              // Number of working agents
  "totalAgents": number,               // Total agents
  "watchedProjects": number,           // Unique projects being monitored
  "totalEvents": number,               // Sum of recent activity events
  "reportsCount": number,              // .agents/**/*.md 파일을 재귀적으로 계산한 실제 보고서 수
  "clientVersion": string,             // Client version
  "connectionStats": {
    "activeConnections": number,       // Current WebSocket connections
    "lastConnected": string | null,    // Last connection timestamp
    "lastClientMessageAt": string | null, // Server가 client로부터 마지막 메시지를 받은 시각 (client→server)
    "totalConnections": number,        // Cumulative connections since start
    "totalMessages": number            // Total messages processed
  }
}
```

**Implementation Details:**
- Server start time tracked via `SERVER_START_TIME` constant
- Connection statistics tracked in `connectionStats` object
- Active connections counted from `clients` Set
- Watched projects calculated from unique session project paths
- Total events aggregated from agent recent activity arrays
- `reportsCount`: `countReports()` 함수가 `.agents/**/*.md`를 재귀적으로 스캔하여 실제 보고서 수 반환

## UI Implementation

### Location
Settings tab → Diagnostics section

**File:** `client/src/App.tsx`

### Display Sections

#### 1. Server Status
- **서버 시작 시각:** Formatted Korean date/time from `startTime`
- **가동 시간:** Human-readable uptime (days, hours, minutes, seconds)
- **클라이언트 버전:** Version string with "v" prefix

#### 2. WebSocket Connection
- **연결 상태:** Color-coded status (green=connected, red=disconnected, orange=reconnecting)
- **활성 연결 수:** Real-time active WebSocket connections
- **마지막 연결:** Last connection timestamp or "없음"
- **마지막 클라이언트 메시지:** Server가 client로부터 메시지를 받은 마지막 시각 (client→server)
- **총 연결 수:** Cumulative connections since server start
- **총 메시지 수:** Total messages processed

#### 3. Monitoring Status
- **활성 세션:** Active vs total sessions (e.g., "2 / 5")
- **활성 에이전트:** Active vs total agents (e.g., "3 / 8")
- **감시 중인 프로젝트:** Number of unique projects
- **총 이벤트 수:** Sum of all recent activity events

### Features
- **Auto-refresh:** Updates every 5 seconds when Settings tab is active
- **Manual refresh:** Button to fetch latest data on-demand
- **Loading states:** Disabled button and loading text during fetch
- **Empty state:** "진단 정보를 불러오는 중..." when no data

## Changes Made

### Server Changes (`server/src/index.ts`)

Added server tracking variables:
```typescript
const SERVER_START_TIME = new Date();
const connectionStats = {
  lastConnected: null as Date | null,
  lastClientMessageAt: null as Date | null,  // client→server message timestamp
  totalConnections: 0,
  totalMessages: 0,
};
```

Added `countReports()` function:
```typescript
function countReports(): number {
  // Recursively scans .agents/**/*.md and returns actual count
}
```

Track connection statistics on WebSocket connect:
```typescript
connectionStats.lastConnected = new Date();
connectionStats.totalConnections++;
```

Track message statistics on message received:
```typescript
connectionStats.lastClientMessageAt = new Date();
connectionStats.totalMessages++;
```

New `/api/diagnostics` endpoint:
- Calculates uptime via `process.uptime()`
- Gets current status from monitor
- Computes unique watched projects
- Aggregates total events from agents
- Calls `countReports()` for actual report count
- Returns comprehensive diagnostics object

### Client Changes (`client/src/App.tsx`)

Added `Diagnostics` interface:
```typescript
interface Diagnostics {
  uptime: number
  startTime: string
  activeSessions: number
  totalSessions: number
  activeAgents: number
  totalAgents: number
  watchedProjects: number
  totalEvents: number
  reportsCount: number
  clientVersion: string
  connectionStats: {
    activeConnections: number
    lastConnected: string | null
    lastClientMessageAt: string | null  // client→server message timestamp
    totalConnections: number
    totalMessages: number
  }
}
```

Added diagnostics state:
```typescript
const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)
```

New `fetchDiagnostics` function:
- Fetches from `/api/diagnostics` endpoint
- Handles authentication via Bearer token
- Updates state on success
- Handles errors gracefully

Auto-refresh effect:
```typescript
useEffect(() => {
  if (activeView === 'settings' && isAuthenticated) {
    fetchDiagnostics()
    const interval = setInterval(fetchDiagnostics, 5000)
    return () => clearInterval(interval)
  }
}, [activeView, isAuthenticated, fetchDiagnostics])
```

Helper functions:
- `formatUptime(seconds)`: Converts seconds to "X일 Y시간 Z분" format
- `getWebSocketStatus(connected)`: Maps boolean to status string
- `getWebSocketStatusLabel(status)`: Korean labels for status

Diagnostics panel UI:
- Nested within Settings view
- Three section layout with headers
- Refresh button in panel head
- Conditional rendering based on diagnostics state

### CSS Changes (`client/src/App.css`)

Diagnostics panel styles:
```css
.diagnostics-panel { margin-top: 14px; }
.diagnostics-section { padding: 14px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); }
.diagnostics-section h3 { color: #7fdccf; font-size: 14px; font-weight: 800; }
.status-connected { color: #30c3a8 !important; }
.status-disconnected { color: #f06767 !important; }
.status-reconnecting { color: #ffb366 !important; }
```

## Testing Checklist

- [x] API endpoint returns correct data structure
- [x] Server uptime calculation is accurate
- [x] Connection statistics are tracked correctly
- [x] WebSocket status reflects actual connection state
- [x] Auto-refresh works on Settings tab
- [x] Manual refresh button functions correctly
- [x] Loading states display properly
- [x] Empty state shows before first fetch
- [x] Korean date/time formatting is correct
- [x] Uptime formatting handles days/hours/minutes/seconds
- [x] Color coding for connection status works
- [x] Styles match existing design system
- [x] reportsCount returns actual count from .agents/**/*.md

## Future Enhancements

1. **Error Metrics:** Add error rate and recent errors section
2. **Performance Metrics:** Include CPU, memory usage from `process` API
3. **Historical Data:** Graph uptime history and connection trends
4. **Export Function:** Download diagnostics as JSON for debugging
5. **Alert Thresholds:** Visual warnings when metrics exceed thresholds

## Notes

- Diagnostics panel is positioned within Settings tab for easy access
- Auto-refresh interval of 5 seconds balances freshness and server load
- All timestamps use Korean locale formatting for consistency
- Connection statistics persist for server lifetime (reset on restart)
- `lastClientMessageAt` tracks when server receives messages FROM clients (client→server direction)
