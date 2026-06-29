# Logs Tab Visual Changes Reference

## Before vs After

### BEFORE: Simple Log List
```
┌─────────────────────────────────────────────┐
│ Logs                                        │
│ 시스템 로그                                 │
├─────────────────────────────────────────────┤
│                                             │
│ 16:23  agent-1  project-a  tool_use  Bash   │
│        Read file config.json                │
│                                             │
│ 16:22  agent-2  project-b  result           │
│        Command executed successfully        │
│                                             │
└─────────────────────────────────────────────┘
```
**Issues:**
- No filtering capability
- English type labels (tool_use, result, message)
- Limited to 16 events
- Long content could break layout

### AFTER: Filtered Log Panel
```
┌─────────────────────────────────────────────┐
│ Logs                                        │
│ 시스템 로그                                 │
├─────────────────────────────────────────────┤
│ 타입  [전체] [도구] [결과] [메시지]         │
│ 에이전트  [▼ 전체 ▼]          42 로그     │
├─────────────────────────────────────────────┤
│                                             │
│ 16:23  agent-1  project-a  도구 사용  Bash │
│        Read file config.json                │
│                                             │
│ 16:22  agent-2  project-b  도구 결과        │
│        Command executed successfully        │
│                                             │
└─────────────────────────────────────────────┘
```
**Improvements:**
✓ Filter by type (전체/도구/결과/메시지)
✓ Filter by agent (dropdown)
✓ Log count display
✓ Korean labels (도구 사용, 도구 결과, 메시지)
✓ Full event history (not limited to 16)
✓ Truncated long content with ellipsis

## Filter UI Components

### Type Filter (Button Group)
```
┌───────────────────────────────────┐
│ 타입  [●전체] [ 도구] [ 결과] [ 메시지] │
└───────────────────────────────────┘
```
- Active button highlighted in teal
- Hover effects on inactive buttons
- Single selection

### Agent Filter (Dropdown)
```
┌──────────────────┐
│ 에이전트  [▼전체▼]  │
│         ┌────────┐
│         │ 전체   │
│         │ agent-1│
│         │ agent-2│
│         │ agent-3│
│         └────────┘
└──────────────────┘
```
- Populated with active agent names
- Sorted alphabetically
- "전체" option shows all

### Log Count Badge
```
┌──────────┐
│ 42 로그  │
└──────────┘
```
- Updates in real-time as filters change
- Teal background for visibility

## Label Translations

| English      | Korean     | Color   |
|--------------|------------|---------|
| tool_use     | 도구 사용  | Purple  |
| result       | 도구 결과  | Green   |
| message      | 메시지     | Blue    |

## Content Truncation Examples

### Long Agent Name
```
Before: very-long-agent-name-that-breaks-layout
After:  very-long-agent-na…
```

### Long Project Path
```
Before: /Users/dev/very/long/project/path/name
After:  /Users/dev/very/…
```

### Long Tool Name
```
Before: some_very_long_tool_name_example
After:  some_very_long…
```

### Long Summary
```
Before: Reading configuration file from /Users/name/project/config/settings.json with all parameters
After:  Reading configuration file from /Users/name/project/config/settings.json with…
```

## Mobile Layout

On screens < 720px, filters stack vertically:
```
┌─────────────────────┐
│ 타입                │
│ [전체][도구][결과]...│
│                     │
│ 에이전트            │
│ [▼ 전체 ▼]          │
│                     │
│      42 로그        │
└─────────────────────┘
```

## Logs Tab vs Event Stream

### Event Stream (Main View)
- Location: Right panel on Ops tab
- Purpose: Quick recent activity glance
- Limit: Last 16 events
- Filters: None
- Labels: English type names

### Logs Tab (Dedicated View)
- Location: "로그" tab
- Purpose: Full searchable history
- Limit: All available events
- Filters: Type + Agent
- Labels: Korean type names (도구 사용, etc.)

## Color Coding

| Type        | Background              | Text     |
|-------------|-------------------------|----------|
| 도구 사용   | rgba(139, 92, 246, 0.18)| #c9b8ff  |
| 도구 결과   | rgba(34, 197, 94, 0.18) | #86efac  |
| 메시지      | rgba(59, 130, 246, 0.18)| #93c5fd  |

## Implementation Details

### Filter State
```typescript
const [logTypeFilter, setLogTypeFilter] = useState<'all' | 'tool_use' | 'result' | 'message'>('all')
const [logAgentFilter, setLogAgentFilter] = useState<string>('all')
```

### Filter Logic
```typescript
const filteredLogs = useMemo(() => {
  return fullTimeline.filter(event => {
    if (logTypeFilter !== 'all' && event.type !== logTypeFilter) return false
    if (logAgentFilter !== 'all' && event.agentName !== logAgentFilter) return false
    return true
  })
}, [fullTimeline, logTypeFilter, logAgentFilter])
```

### Grid Layout
```css
grid-template-columns: 60px 120px 100px 90px auto minmax(0, 1fr);
```
Columns: Time | Agent | Project | Type | Tool | Summary

## Accessibility Features

1. Semantic HTML (button, select elements)
2. Clear labels for all filter groups
3. Keyboard navigable
4. Focus states on all interactive elements
5. Screen reader friendly structure
