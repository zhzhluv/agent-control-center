import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'
import PixelOffice from './components/PixelOffice'
import ReviewQueue from './components/ReviewQueue'
import { sanitizeForDisplay } from './utils/sanitize'

interface ActivityLog {
  timestamp: string
  type: 'tool_use' | 'message' | 'result'
  tool?: string
  summary: string
  is_error?: boolean
}

interface Agent {
  id: string
  name: string
  status: 'idle' | 'working' | 'waiting'
  agentType: 'main' | 'sub'
  currentTask?: string
  currentTaskFull?: string
  recentTools: string[]
  recentActivity: ActivityLog[]
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  cost: number
  projectPath?: string
  isStale?: boolean
  source?: 'claude' | 'codex'  // Source of the agent session
  needsReview?: boolean
  reviewCandidateAt?: string
  reviewReason?: string
  reviewState?: 'pending' | 'acknowledged' | 'copied' | 'dismissed'
}

interface Session {
  id: string
  projectPath: string
  agents: Agent[]
  isActive: boolean
  lastActivity: string
  isStale?: boolean
  source?: 'claude' | 'codex'  // Source of the session
}

interface Metrics {
  totalTokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  totalCost: number
  cacheHitRate: number
  activeAgents: number
  totalAgents: number
  activeSessions: number
  idleSessions?: number
  staleSessions?: number
  totalSessions?: number
  totalProjects?: number
}

interface ProjectInfo {
  path: string
  name: string
  sessions?: Session[]  // Server sends full sessions array
  lastActivity?: string  // ISO string (Date serialized)
}

interface AppState {
  connected: boolean
  sessions: Session[]
  agents: Agent[]
  metrics: Metrics
  projects: ProjectInfo[]
}

// WebSocket connection state for stability tracking
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

interface ConnectionState {
  status: ConnectionStatus
  lastConnectedAt: string | null
  lastMessageAt: string | null
  reconnectAttempts: number
  nextRetryDelayMs: number
}

interface TimelineEvent {
  id: string
  agentName: string
  timestamp: string
  type: ActivityLog['type']
  summary: string
  tool?: string
  source?: 'claude' | 'codex'
}

interface Report {
  path: string
  name: string
  size: number
  modified: string
}

interface ReportContent {
  path: string
  content: string
  size: number
  modified: string
}

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

const initialMetrics: Metrics = {
  totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  totalCost: 0,
  cacheHitRate: 0,
  activeAgents: 0,
  totalAgents: 0,
  activeSessions: 0,
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatTime(value?: string) {
  if (!value) return '방금'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '방금'
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function formatTimeSince(timestamp: string): string {
  const now = new Date().getTime()
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return '방금'
  const secondsAgo = Math.floor((now - then) / 1000)

  if (secondsAgo < 60) return '방금'
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}분 전`
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}시간 전`
  return `${Math.floor(secondsAgo / 86400)}일 전`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(isoString: string): string {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (days > 0) {
    return `${days}일 ${hours}시간 ${minutes}분`
  }
  if (hours > 0) {
    return `${hours}시간 ${minutes}분 ${secs}초`
  }
  if (minutes > 0) {
    return `${minutes}분 ${secs}초`
  }
  return `${secs}초`
}

function getWebSocketStatusLabel(connected: boolean): string {
  return connected ? '연결됨' : '연결 끊김'
}

function getConnectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connecting': return '연결 중...'
    case 'connected': return '연결됨'
    case 'disconnected': return '연결 끊김'
    case 'reconnecting': return '재연결 중...'
  }
}

function formatDelayMs(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(0)}초`
  }
  return `${ms}ms`
}

function getStatusLabel(status: Agent['status']) {
  if (status === 'working') return '작업 중'
  if (status === 'waiting') return '대기'
  return '휴식'
}

function getSourceBadge(source?: 'claude' | 'codex') {
  if (!source) return null
  if (source === 'claude') {
    return { label: 'C', title: 'Claude', className: 'claude' }
  }
  return { label: 'X', title: 'Codex', className: 'codex' }
}

type DerivedStatus =
  | 'error'
  | 'approval_needed'
  | 'blocked'
  | 'recently_active'
  | 'needs_review'
  | null

function getDerivedStatus(agent: Agent): DerivedStatus {
  // Check for needs_review first - highest priority
  if (agent.needsReview === true) {
    return 'needs_review'
  }

  const now = new Date().getTime()

  if (agent.recentActivity && agent.recentActivity.length > 0) {
    const lastActivity = agent.recentActivity[agent.recentActivity.length - 1]
    const lastActivityTime = new Date(lastActivity.timestamp).getTime()
    const timeSinceActivity = (now - lastActivityTime) / 1000

    if (lastActivity.type === 'result' && lastActivity.is_error) {
      if (agent.status === 'idle') {
        return 'blocked'
      }
      return 'error'
    }

    if (timeSinceActivity < 5 && agent.status === 'working') {
      return 'recently_active'
    }
  }

  return null
}

function getDerivedStatusLabel(derived: DerivedStatus): string | null {
  if (derived === 'error') return '오류 발생'
  if (derived === 'approval_needed') return '승인 대기'
  if (derived === 'blocked') return '차단됨'
  if (derived === 'recently_active') return '활발함'
  if (derived === 'needs_review') return '검수 필요'
  return null
}

// Stale detection: 5 minutes for agents, 10 minutes for sessions
const AGENT_STALE_THRESHOLD = 5 * 60 * 1000 // 5 minutes in milliseconds
const SESSION_STALE_THRESHOLD = 10 * 60 * 1000 // 10 minutes in milliseconds

function isAgentStale(agent: Agent): boolean {
  if (!agent.recentActivity || agent.recentActivity.length === 0) {
    return false // No activity yet, not stale
  }

  const now = new Date().getTime()
  const lastActivity = agent.recentActivity[agent.recentActivity.length - 1]
  const lastActivityTime = new Date(lastActivity.timestamp).getTime()

  if (Number.isNaN(lastActivityTime)) return false

  return (now - lastActivityTime) > AGENT_STALE_THRESHOLD
}

function isSessionStale(session: Session): boolean {
  if (!session.lastActivity) {
    return false
  }

  const now = new Date().getTime()
  const lastActivityTime = new Date(session.lastActivity).getTime()

  if (Number.isNaN(lastActivityTime)) return false

  return (now - lastActivityTime) > SESSION_STALE_THRESHOLD
}

function getLastActivityTimestamp(agent: Agent): string | null {
  if (!agent.recentActivity || agent.recentActivity.length === 0) {
    return null
  }
  return agent.recentActivity[agent.recentActivity.length - 1].timestamp
}

function getRole(agent: Agent) {
  const text = `${agent.name} ${agent.currentTaskFull || ''} ${agent.currentTask || ''} ${(agent.recentTools || []).join(' ')}`.toLowerCase()
  if (agent.agentType === 'main') return '지휘'
  if (text.includes('test') || text.includes('pytest') || text.includes('qa') || text.includes('검증')) return 'QA'
  if (text.includes('doc') || text.includes('readme') || text.includes('문서')) return '문서'
  if (text.includes('data') || text.includes('db') || text.includes('sql') || text.includes('database')) return '데이터'
  if (text.includes('review') || text.includes('diff') || text.includes('검토')) return '리뷰'
  if (text.includes('build') || text.includes('deploy') || text.includes('server')) return '운영'
  return '개발'
}

function shortProject(path?: string) {
  if (!path) return '프로젝트 미확인'
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) || path
}

function getTypeLabel(type: ActivityLog['type']): string {
  if (type === 'tool_use') return '도구 사용'
  if (type === 'result') return '도구 결과'
  if (type === 'message') return '메시지'
  return type
}

function buildTimeline(agents: Agent[]): TimelineEvent[] {
  return agents
    .flatMap(agent =>
      (agent.recentActivity || []).map((activity, index) => ({
        id: `${agent.id}-${activity.timestamp}-${index}`,
        agentName: agent.name,
        timestamp: activity.timestamp,
        type: activity.type,
        summary: activity.summary,
        tool: activity.tool,
        source: agent.source,
      }))
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 16)
}

function buildFullTimeline(agents: Agent[]): TimelineEvent[] {
  return agents
    .flatMap(agent =>
      (agent.recentActivity || []).map((activity, index) => ({
        id: `${agent.id}-${activity.timestamp}-${index}`,
        agentName: agent.name,
        timestamp: activity.timestamp,
        type: activity.type,
        summary: activity.summary,
        tool: activity.tool,
        source: agent.source,
      }))
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

export default function App() {
  const [state, setState] = useState<AppState>({
    connected: false,
    sessions: [],
    agents: [],
    metrics: initialMetrics,
    projects: [],
  })
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') || '')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeView, setActiveView] = useState<'ops' | 'logs' | 'reports' | 'settings'>('ops')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [staleCheckTick, setStaleCheckTick] = useState(0) // Timer trigger for stale recalculation

  // Reports state
  const [reports, setReports] = useState<Report[]>([])
  const [selectedReport, setSelectedReport] = useState<ReportContent | null>(null)
  const [loadingReports, setLoadingReports] = useState(false)
  const [loadingContent, setLoadingContent] = useState(false)
  const [reportsError, setReportsError] = useState('')
  const [reportSearchQuery, setReportSearchQuery] = useState('')
  const [selectedReportPath, setSelectedReportPath] = useState<string | null>(null)

  // Logs filter state
  const [logTypeFilter, setLogTypeFilter] = useState<'all' | 'tool_use' | 'result' | 'message'>('all')
  const [logAgentFilter, setLogAgentFilter] = useState<string>('all')

  // Next instruction state
  const [nextInstruction, setNextInstruction] = useState('')
  const [showToast, setShowToast] = useState(false)

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false)

  // Connection state for WebSocket stability
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    lastConnectedAt: null,
    lastMessageAt: null,
    reconnectAttempts: 0,
    nextRetryDelayMs: 1000,
  })

  // Notification state
  const [notificationEnabled, setNotificationEnabled] = useState(() => {
    return localStorage.getItem('notificationEnabled') === 'true'
  })
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof Notification === 'undefined') return 'default'
    return Notification.permission
  })

  // Review toast state
  interface ReviewToast {
    id: string
    agentId: string
    agentName: string
    timestamp: string
  }
  const [reviewToasts, setReviewToasts] = useState<ReviewToast[]>([])

  // Dedupe tracking for notifications
  const notifiedAgentsRef = useRef<Set<string>>(new Set())

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(true)
  const heartbeatIntervalRef = useRef<number | null>(null)
  const pongTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptsRef = useRef(0)

  // Compute stale status for agents and sessions (recomputes when state or timer changes)
  const agentsWithStale = useMemo(() => {
    return state.agents.map(agent => ({
      ...agent,
      isStale: isAgentStale(agent)
    }))
  }, [state.agents, staleCheckTick])

  const sessionsWithStale = useMemo(() => {
    return state.sessions.map(session => ({
      ...session,
      isStale: isSessionStale(session)
    }))
  }, [state.sessions, staleCheckTick])

  const selectedAgent = useMemo(
    () => agentsWithStale.find(agent => agent.id === selectedAgentId) || agentsWithStale[0] || null,
    [selectedAgentId, agentsWithStale],
  )
  const timeline = useMemo(() => buildTimeline(agentsWithStale), [agentsWithStale])
  const fullTimeline = useMemo(() => buildFullTimeline(agentsWithStale), [agentsWithStale])
  const activeProjectCount = useMemo(() => {
    // Priority: metrics.totalProjects (if number) > projects.length (if > 0) > session projectPath Set
    if (typeof state.metrics.totalProjects === 'number') {
      return state.metrics.totalProjects
    }
    if (state.projects.length > 0) {
      return state.projects.length
    }
    return new Set(sessionsWithStale.map(session => session.projectPath)).size
  }, [state.metrics.totalProjects, state.projects.length, sessionsWithStale])

  // Unique agent names for filter dropdown
  const uniqueAgentNames = useMemo(() => {
    const names = new Set(agentsWithStale.map(agent => agent.name))
    return Array.from(names).sort()
  }, [agentsWithStale])

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return fullTimeline.filter(event => {
      if (logTypeFilter !== 'all' && event.type !== logTypeFilter) return false
      if (logAgentFilter !== 'all' && event.agentName !== logAgentFilter) return false
      return true
    })
  }, [fullTimeline, logTypeFilter, logAgentFilter])

  // Filter and group reports
  const filteredReports = useMemo(() => {
    const query = reportSearchQuery.toLowerCase().trim()
    if (!query) return reports
    return reports.filter(report =>
      report.path.toLowerCase().includes(query) ||
      report.name.toLowerCase().includes(query)
    )
  }, [reports, reportSearchQuery])

  const groupedReports = useMemo(() => {
    const groups: Record<string, Report[]> = {}
    filteredReports.forEach(report => {
      const lastSlashIndex = report.path.lastIndexOf('/')
      const folder = lastSlashIndex > 0 ? report.path.substring(0, lastSlashIndex) : ''
      if (!groups[folder]) {
        groups[folder] = []
      }
      groups[folder].push(report)
    })
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [filteredReports])

  const fetchReports = useCallback(async () => {
    if (!authToken) return

    setLoadingReports(true)
    setReportsError('')

    try {
      const protocol = window.location.protocol
      const host = import.meta.env.DEV
        ? `${window.location.hostname}:9876`
        : window.location.host
      const url = `${protocol}//${host}/api/reports`

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setReports(data.reports || [])
    } catch (err) {
      setReportsError('보고서 목록을 가져올 수 없습니다.')
      setReports([])
    } finally {
      setLoadingReports(false)
    }
  }, [authToken])

  const fetchReportContent = useCallback(async (reportPath: string) => {
    if (!authToken) return

    setLoadingContent(true)
    setReportsError('')
    setSelectedReportPath(reportPath)

    try {
      const protocol = window.location.protocol
      const host = import.meta.env.DEV
        ? `${window.location.hostname}:9876`
        : window.location.host
      const url = `${protocol}//${host}/api/reports/${encodeURIComponent(reportPath)}`

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setSelectedReport(data)
    } catch (err) {
      setReportsError('보고서를 읽을 수 없습니다.')
      setSelectedReport(null)
    } finally {
      setLoadingContent(false)
    }
  }, [authToken])

  const fetchDiagnostics = useCallback(async () => {
    if (!authToken) return

    setLoadingDiagnostics(true)

    try {
      const protocol = window.location.protocol
      const host = import.meta.env.DEV
        ? `${window.location.hostname}:9876`
        : window.location.host
      const url = `${protocol}//${host}/api/diagnostics`

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setDiagnostics(data)
    } catch (err) {
      console.error('Failed to fetch diagnostics:', err)
      setDiagnostics(null)
    } finally {
      setLoadingDiagnostics(false)
    }
  }, [authToken])

  const copyNextInstruction = useCallback(async () => {
    if (!nextInstruction.trim()) return

    try {
      await navigator.clipboard.writeText(nextInstruction)

      // Update review state to 'copied' when copying
      if (selectedAgent?.needsReview && selectedAgent?.id) {
        await updateReviewState(selectedAgent.id, 'copied')
      }

      setShowToast(true)
      setTimeout(() => setShowToast(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [nextInstruction, selectedAgent])

  const updateReviewState = useCallback(async (agentId: string, state: 'pending' | 'acknowledged' | 'copied' | 'dismissed') => {
    if (!authToken) return

    try {
      const protocol = window.location.protocol
      const host = import.meta.env.DEV
        ? `${window.location.hostname}:9876`
        : window.location.host
      const url = `${protocol}//${host}/api/agents/${encodeURIComponent(agentId)}/review-state`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ state }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      // Remove toast when review state is updated
      if (state !== 'pending') {
        setReviewToasts(prev => prev.filter(toast => toast.agentId !== agentId))
      }

      // The server will broadcast the update via WebSocket
    } catch (err) {
      console.error('Failed to update review state:', err)
    }
  }, [authToken])

  // Request notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      alert('이 브라우저는 알림을 지원하지 않습니다.')
      return
    }

    if (Notification.permission === 'granted') {
      setNotificationEnabled(true)
      localStorage.setItem('notificationEnabled', 'true')
      return
    }

    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)

      if (permission === 'granted') {
        setNotificationEnabled(true)
        localStorage.setItem('notificationEnabled', 'true')
      } else {
        setNotificationEnabled(false)
        localStorage.setItem('notificationEnabled', 'false')
      }
    } catch (err) {
      console.error('Failed to request notification permission:', err)
    }
  }, [])

  // Toggle notification
  const toggleNotification = useCallback(() => {
    if (!notificationEnabled) {
      requestNotificationPermission()
    } else {
      setNotificationEnabled(false)
      localStorage.setItem('notificationEnabled', 'false')
    }
  }, [notificationEnabled, requestNotificationPermission])

  // Show browser notification
  const showBrowserNotification = useCallback((agent: Agent) => {
    if (!notificationEnabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return
    }

    const notification = new Notification('검수 필요', {
      body: `${agent.name} 작업이 완료된 것으로 보입니다.`,
      icon: '/favicon.ico',
      tag: agent.id, // Use tag to replace existing notification
      requireInteraction: false,
    })

    notification.onclick = () => {
      window.focus()
      setSelectedAgentId(agent.id)
      setActiveView('ops')
      notification.close()
    }

    // Auto-close after 10 seconds
    setTimeout(() => notification.close(), 10000)
  }, [notificationEnabled, setSelectedAgentId])

  // Show in-app toast
  const showReviewToast = useCallback((agent: Agent) => {
    const toast: ReviewToast = {
      id: `${agent.id}-${agent.reviewCandidateAt}`,
      agentId: agent.id,
      agentName: agent.name,
      timestamp: agent.reviewCandidateAt || new Date().toISOString(),
    }

    setReviewToasts(prev => {
      // Remove existing toast for this agent
      const filtered = prev.filter(t => t.agentId !== agent.id)
      // Add new toast at the beginning
      const updated = [toast, ...filtered]
      // Keep only latest 3 toasts
      return updated.slice(0, 3)
    })
  }, [])

  // Handle review toast click
  const handleReviewToastClick = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    setActiveView('ops')
  }, [])

  // Remove review toast
  const removeReviewToast = useCallback((toastId: string) => {
    setReviewToasts(prev => prev.filter(t => t.id !== toastId))
  }, [])

  // Cleanup heartbeat timers
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
    if (pongTimeoutRef.current !== null) {
      window.clearTimeout(pongTimeoutRef.current)
      pongTimeoutRef.current = null
    }
  }, [])

  // Start heartbeat: ping every 30s, close if no pong in 5s
  const startHeartbeat = useCallback((ws: WebSocket) => {
    stopHeartbeat()

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))

        // Set 5s timeout for pong response
        pongTimeoutRef.current = window.setTimeout(() => {
          console.warn('Heartbeat timeout: no pong received in 5s, closing connection')
          ws.close(4000, 'Heartbeat timeout')
        }, 5000)
      }
    }, 30000) // 30 seconds
  }, [stopHeartbeat])

  // Calculate exponential backoff delay: 1s → 2s → 4s → 8s → max 30s
  const getBackoffDelay = useCallback((attempts: number): number => {
    const baseDelay = 1000
    const maxDelay = 30000
    return Math.min(baseDelay * Math.pow(2, attempts), maxDelay)
  }, [])

  const connect = useCallback(() => {
    if (!authToken) return
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    shouldReconnectRef.current = true

    // Clear any existing reconnect timer
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    setConnectionError('')
    setConnectionState(prev => ({
      ...prev,
      status: reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting',
      reconnectAttempts: reconnectAttemptsRef.current,
    }))

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = import.meta.env.DEV
      ? `${window.location.hostname}:9876`
      : window.location.host
    const wsUrl = `${protocol}//${host}?token=${authToken}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      const now = new Date().toISOString()
      reconnectAttemptsRef.current = 0 // Reset attempts on successful connection

      setState(current => ({ ...current, connected: true }))
      setConnectionState(prev => ({
        ...prev,
        status: 'connected',
        lastConnectedAt: now,
        reconnectAttempts: 0,
        nextRetryDelayMs: 1000,
      }))
      setIsAuthenticated(true)
      setConnectionError('')
      localStorage.setItem('authToken', authToken)

      // Start heartbeat
      startHeartbeat(ws)
    }

    ws.onmessage = (event) => {
      const now = new Date().toISOString()
      setConnectionState(prev => ({ ...prev, lastMessageAt: now }))

      const { type, data } = JSON.parse(event.data)

      switch (type) {
        case 'pong':
          // Clear pong timeout on successful pong
          if (pongTimeoutRef.current !== null) {
            window.clearTimeout(pongTimeoutRef.current)
            pongTimeoutRef.current = null
          }
          break
        case 'init':
        case 'status_update':
          setState(current => ({
            ...current,
            sessions: data.sessions || current.sessions,
            agents: data.agents || current.agents,
            metrics: data.metrics || current.metrics,
            projects: data.projects || current.projects,
          }))
          break
        case 'agent_updated':
          setState(current => ({
            ...current,
            agents: current.agents.some(agent => agent.id === data.id)
              ? current.agents.map(agent => agent.id === data.id ? data : agent)
              : [...current.agents, data],
          }))

          // Check if agent needs review and send notifications
          if (data.needsReview === true && data.reviewState === 'pending') {
            const dedupeKey = `${data.id}-${data.reviewCandidateAt}`

            // Only notify if we haven't already notified for this agent+timestamp
            if (!notifiedAgentsRef.current.has(dedupeKey)) {
              notifiedAgentsRef.current.add(dedupeKey)

              // Show browser notification if enabled
              showBrowserNotification(data)

              // Always show in-app toast
              showReviewToast(data)
            }
          }
          break
        case 'session_updated':
          setState(current => ({
            ...current,
            sessions: current.sessions.some(session => session.id === data.id)
              ? current.sessions.map(session => session.id === data.id ? data : session)
              : [...current.sessions, data],
          }))
          break
        case 'error':
          setConnectionError(data.message || '서버 오류가 발생했습니다.')
          break
      }
    }

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return

      wsRef.current = null
      stopHeartbeat()
      setState(current => ({ ...current, connected: false }))
      setConnectionState(prev => ({ ...prev, status: 'disconnected' }))

      if (!shouldReconnectRef.current) return

      // 4001: Auth failure - do NOT reconnect
      if (event.code === 4001) {
        shouldReconnectRef.current = false
        reconnectAttemptsRef.current = 0
        localStorage.removeItem('authToken')
        setAuthToken('')
        setIsAuthenticated(false)
        setConnectionError('토큰이 만료되었거나 서버 토큰이 바뀌었습니다. 새 토큰을 다시 입력해 주세요.')
        setConnectionState(prev => ({
          ...prev,
          status: 'disconnected',
          reconnectAttempts: 0,
          nextRetryDelayMs: 1000,
        }))
        return
      }

      // 4029: Rate limit - show clear message and use backoff
      const isRateLimit = event.code === 4029
      const reason = isRateLimit
        ? '연결 시도가 너무 많습니다. 잠시 후 자동으로 재연결합니다.'
        : '서버 연결이 끊겼습니다. 자동으로 재연결합니다.'

      // Calculate backoff delay
      const delay = getBackoffDelay(reconnectAttemptsRef.current)
      reconnectAttemptsRef.current++

      setConnectionError(`${reason} (${formatDelayMs(delay)} 후 재시도, ${reconnectAttemptsRef.current}회차)`)
      setConnectionState(prev => ({
        ...prev,
        status: 'reconnecting',
        reconnectAttempts: reconnectAttemptsRef.current,
        nextRetryDelayMs: delay,
      }))

      // Schedule reconnect with exponential backoff
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, delay)
    }

    ws.onerror = () => {
      setConnectionError('서버에 연결하지 못했습니다. 서버 실행 상태와 토큰을 확인해 주세요.')
    }
  }, [authToken, startHeartbeat, stopHeartbeat, getBackoffDelay])

  const logout = useCallback(() => {
    shouldReconnectRef.current = false
    reconnectAttemptsRef.current = 0

    // Clear all timers
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    stopHeartbeat()

    localStorage.removeItem('authToken')
    setAuthToken('')
    setIsAuthenticated(false)
    setConnectionError('')
    setConnectionState({
      status: 'disconnected',
      lastConnectedAt: null,
      lastMessageAt: null,
      reconnectAttempts: 0,
      nextRetryDelayMs: 1000,
    })
    wsRef.current?.close(1000, 'logout')
    wsRef.current = null
  }, [stopHeartbeat])

  useEffect(() => {
    if (authToken && !wsRef.current) {
      connect()
    }
    return () => {
      shouldReconnectRef.current = false
      reconnectAttemptsRef.current = 0

      // Clear all timers on unmount
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      stopHeartbeat()

      wsRef.current?.close(1000, 'cleanup')
      wsRef.current = null
    }
  }, [authToken, connect, stopHeartbeat])


  // Load reports when switching to reports view
  useEffect(() => {
    if (activeView === 'reports' && isAuthenticated) {
      fetchReports()
    }
  }, [activeView, isAuthenticated, fetchReports])

  // Load diagnostics when switching to settings view
  useEffect(() => {
    if (activeView === 'settings' && isAuthenticated) {
      fetchDiagnostics()
      // Auto-refresh every 5 seconds when on settings tab
      const interval = setInterval(fetchDiagnostics, 5000)
      return () => clearInterval(interval)
    }
  }, [activeView, isAuthenticated, fetchDiagnostics])

  // Stale detection timer: recalculate every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setStaleCheckTick(tick => tick + 1)
    }, 60000) // 1 minute

    return () => clearInterval(interval)
  }, [])

  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-mark">ACC</div>
          <h1>Agent Control Center</h1>
          <p>맥미니 관제 서버 토큰을 입력하세요.</p>
          <input
            type="password"
            placeholder="Auth Token"
            value={authToken}
            onChange={(event) => setAuthToken(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && connect()}
          />
          {connectionError && <p className="auth-error">{connectionError}</p>}
          <button className="primary" onClick={connect}>연결</button>
        </div>
      </div>
    )
  }

  return (
    <div className="ops-app">
      <header className="ops-header">
        <div className="brand-block">
          <span className={`connection-light ${state.connected ? 'is-on' : 'is-off'}`} />
          <div>
            <h1>Agent Control Center</h1>
            <p>{state.connected ? '실시간 감시 중' : '재연결 대기 중'}</p>
          </div>
        </div>

        <div className="header-metrics">
          <div>
            <span>{state.metrics.activeAgents}</span>
            <small>작업 중</small>
          </div>
          <div>
            <span>{state.metrics.totalAgents}</span>
            <small>전체 직원</small>
          </div>
          <div>
            <span>{formatTokenCount(state.metrics.totalTokens.input + state.metrics.totalTokens.output)}</span>
            <small>토큰</small>
          </div>
          <div>
            <span>${state.metrics.totalCost.toFixed(4)}</span>
            <small>비용</small>
          </div>
        </div>
      </header>

      {connectionError && (
        <div className="connection-banner">
          <span>{connectionError}</span>
          <button type="button" onClick={connect}>재연결</button>
        </div>
      )}

      <nav className="ops-tabs" aria-label="view navigation">
        <button className={activeView === 'ops' ? 'active' : ''} onClick={() => setActiveView('ops')}>운영실</button>
        <button className={activeView === 'logs' ? 'active' : ''} onClick={() => setActiveView('logs')}>로그</button>
        <button className={activeView === 'reports' ? 'active' : ''} onClick={() => setActiveView('reports')}>보고서</button>
        <button className={activeView === 'settings' ? 'active' : ''} onClick={() => setActiveView('settings')}>설정</button>
      </nav>

      {activeView === 'ops' && (
        <main className="ops-layout">
          <section className="office-shell" aria-label="agent office">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Live Office</p>
                <h2>직원 운영실</h2>
              </div>
              <div className="office-summary">
                <span>{activeProjectCount} {activeProjectCount === 1 ? '프로젝트' : '프로젝트'}</span>
                <span>{state.sessions.length} {state.sessions.length === 1 ? '세션' : '세션'}</span>
              </div>
            </div>

            <PixelOffice
              agents={agentsWithStale}
              selectedAgentId={selectedAgent?.id || null}
              onSelectAgent={setSelectedAgentId}
            />
          </section>

          <aside className="inspector-shell" aria-label="agent inspector">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Inspector</p>
                <h2>직원 상세</h2>
              </div>
            </div>

            {selectedAgent ? (
              <div className="agent-inspector">
                {selectedAgent.needsReview && (
                  <div className="review-banner">
                    <div className="review-banner-header">
                      <span className="review-icon">✓</span>
                      <div>
                        <strong>검수 필요</strong>
                        <p>{selectedAgent.reviewReason || '이 에이전트가 작업 검수를 요청했습니다.'}</p>
                      </div>
                    </div>
                    <div className="review-actions">
                      <button
                        type="button"
                        className={`review-btn acknowledged ${selectedAgent.reviewState === 'acknowledged' ? 'active' : ''}`}
                        onClick={() => updateReviewState(selectedAgent.id, 'acknowledged')}
                      >
                        확인함
                      </button>
                      <button
                        type="button"
                        className={`review-btn copied ${selectedAgent.reviewState === 'copied' ? 'active' : ''}`}
                        onClick={() => updateReviewState(selectedAgent.id, 'copied')}
                      >
                        복사 후 대기
                      </button>
                      <button
                        type="button"
                        className={`review-btn dismissed ${selectedAgent.reviewState === 'dismissed' ? 'active' : ''}`}
                        onClick={() => updateReviewState(selectedAgent.id, 'dismissed')}
                      >
                        숨기기
                      </button>
                    </div>
                  </div>
                )}

                <div className="agent-profile">
                  <span className={`profile-dot ${selectedAgent.status} ${selectedAgent.isStale ? 'stale' : ''}`} />
                  <div>
                    <strong>
                      {selectedAgent.name}
                      {(() => {
                        const sourceBadge = getSourceBadge(selectedAgent.source)
                        return sourceBadge ? (
                          <span className={`source-badge ${sourceBadge.className}`} title={sourceBadge.title} style={{ marginLeft: '6px' }}>
                            {sourceBadge.label}
                          </span>
                        ) : null
                      })()}
                    </strong>
                    <p>{getRole(selectedAgent)} · {selectedAgent.agentType === 'sub' ? '서브 에이전트' : '메인 에이전트'}</p>
                  </div>
                  <div className="status-pills">
                    <span className={`status-pill ${selectedAgent.status} ${selectedAgent.isStale ? 'stale' : ''}`}>{getStatusLabel(selectedAgent.status)}</span>
                    {(() => {
                      const derived = getDerivedStatus(selectedAgent)
                      const label = getDerivedStatusLabel(derived)
                      return label ? <span className={`status-pill derived ${derived}`}>{label}</span> : null
                    })()}
                    {selectedAgent.isStale && (
                      <span className="status-pill stale-warning">오래됨</span>
                    )}
                  </div>
                </div>

                <div className="task-card">
                  <small>현재 미션</small>
                  <p>{sanitizeForDisplay(selectedAgent.currentTaskFull || selectedAgent.currentTask) || '대기 중인 작업이 없습니다.'}</p>
                  {selectedAgent.isStale && (() => {
                    const lastTimestamp = getLastActivityTimestamp(selectedAgent)
                    return lastTimestamp ? (
                      <small className="stale-notice">마지막 업데이트: {formatTimeSince(lastTimestamp)}</small>
                    ) : null
                  })()}
                </div>

                <div className="inspector-grid">
                  <div>
                    <span>{formatTokenCount(selectedAgent.tokens.input)}</span>
                    <small>입력</small>
                  </div>
                  <div>
                    <span>{formatTokenCount(selectedAgent.tokens.output)}</span>
                    <small>출력</small>
                  </div>
                  <div>
                    <span>{formatTokenCount(selectedAgent.tokens.cacheRead)}</span>
                    <small>캐시 읽기</small>
                  </div>
                  <div>
                    <span>${selectedAgent.cost.toFixed(4)}</span>
                    <small>비용</small>
                  </div>
                </div>

                <div className="tool-strip">
                  {(selectedAgent.recentTools || []).length > 0
                    ? selectedAgent.recentTools.slice(-8).map(tool => <span key={tool}>{tool}</span>)
                    : <p>최근 도구 사용 없음</p>}
                </div>

                <div className="mini-timeline">
                  <h3>최근 활동</h3>
                  {(selectedAgent.recentActivity || []).length > 0 ? (
                    selectedAgent.recentActivity.slice(-6).reverse().map((activity, index) => (
                      <div className="mini-event" key={`${activity.timestamp}-${index}`}>
                        <span className={`event-type ${activity.type}`} />
                        <div>
                          <strong>{sanitizeForDisplay(activity.summary)}</strong>
                          <small>{formatTime(activity.timestamp)}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">아직 기록된 활동이 없습니다.</p>
                  )}
                </div>

                {selectedAgent.needsReview && (
                  <div className="next-instruction-area">
                    <h3>다음 지시 작성</h3>
                    <textarea
                      value={nextInstruction}
                      onChange={(e) => setNextInstruction(e.target.value)}
                      placeholder="다음 작업 지시를 입력하세요..."
                      rows={4}
                      className="next-instruction-input"
                    />
                    <button
                      type="button"
                      onClick={copyNextInstruction}
                      disabled={!nextInstruction.trim()}
                      className="copy-instruction-btn"
                    >
                      클립보드에 복사
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-panel">
                <strong>감시 대기 중</strong>
                <p>Claude Code 세션이 실행되면 이곳에 직원 상세가 표시됩니다.</p>
              </div>
            )}
          </aside>

          <section className="staff-shell">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Staff Board</p>
                <h2>직원 목록</h2>
              </div>
            </div>

            <div className="staff-list">
              {agentsWithStale.length === 0 ? (
                <div className="empty-panel">
                  <strong>활성 직원 없음</strong>
                  <p>터미널에서 Claude Code 작업을 시작하면 자동으로 감지됩니다.</p>
                </div>
              ) : (
                <>
                  <ReviewQueue agents={agentsWithStale} onSelectAgent={setSelectedAgentId} />
                  {agentsWithStale.map(agent => {
                  const derived = getDerivedStatus(agent)
                  const derivedLabel = getDerivedStatusLabel(derived)
                  const sourceBadge = getSourceBadge(agent.source)

                  // Determine review state class
                  let reviewStateClass = ''
                  if (agent.needsReview && agent.reviewState) {
                    reviewStateClass = `review-${agent.reviewState}`
                  }

                  return (
                    <button
                      type="button"
                      key={agent.id}
                      className={`staff-row ${agent.status} ${derived ? `derived-${derived}` : ''} ${agent.isStale ? 'stale' : ''} ${reviewStateClass} ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
                      onClick={() => setSelectedAgentId(agent.id)}
                    >
                      <span className={`profile-dot ${agent.status} ${derived ? `derived-${derived}` : ''} ${agent.isStale ? 'stale' : ''} ${reviewStateClass}`} />
                      <span>
                        <strong>
                          {agent.name}
                          {sourceBadge && (
                            <span className={`source-badge ${sourceBadge.className}`} title={sourceBadge.title} style={{ marginLeft: '6px' }}>
                              {sourceBadge.label}
                            </span>
                          )}
                        </strong>
                        <small>{getRole(agent)} · {shortProject(agent.projectPath)}{derivedLabel ? ` · ${derivedLabel}` : ''}</small>
                      </span>
                      <em className={agent.isStale ? 'stale-text' : ''}>{getStatusLabel(agent.status)}</em>
                    </button>
                  )
                })}
                </>
              )}
            </div>
          </section>

          <section className="event-shell">
            <div className="panel-head compact">
              <div>
                <p className="eyebrow">Event Stream</p>
                <h2>활동 타임라인</h2>
              </div>
            </div>

            <div className="event-list">
              {timeline.length === 0 ? (
                <div className="empty-panel">
                  <strong>이벤트 대기 중</strong>
                  <p>도구 사용, 결과, 상태 변화가 여기에 쌓입니다.</p>
                </div>
              ) : (
                timeline.map(event => {
                  const sourceBadge = getSourceBadge(event.source)
                  return (
                    <div className="event-row" key={event.id}>
                      <span className={`event-type ${event.type}`} />
                      <div>
                        <strong>{sanitizeForDisplay(event.summary)}</strong>
                        <p>
                          {event.agentName}
                          {sourceBadge && (
                            <>
                              {' '}
                              <span className={`source-badge ${sourceBadge.className}`} title={sourceBadge.title} style={{ marginLeft: '4px' }}>
                                {sourceBadge.label}
                              </span>
                            </>
                          )}
                          {event.tool ? ` · ${event.tool}` : ''}
                        </p>
                      </div>
                      <time>{formatTime(event.timestamp)}</time>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </main>
      )}

      {activeView === 'logs' && (
        <main className="simple-page">
          <section className="terminal-panel logs-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Logs</p>
                <h2>시스템 로그</h2>
              </div>
            </div>

            <div className="log-filters">
              <div className="filter-group">
                <label>타입</label>
                <div className="filter-buttons">
                  <button
                    className={logTypeFilter === 'all' ? 'active' : ''}
                    onClick={() => setLogTypeFilter('all')}
                  >
                    전체
                  </button>
                  <button
                    className={logTypeFilter === 'tool_use' ? 'active' : ''}
                    onClick={() => setLogTypeFilter('tool_use')}
                  >
                    도구
                  </button>
                  <button
                    className={logTypeFilter === 'result' ? 'active' : ''}
                    onClick={() => setLogTypeFilter('result')}
                  >
                    결과
                  </button>
                  <button
                    className={logTypeFilter === 'message' ? 'active' : ''}
                    onClick={() => setLogTypeFilter('message')}
                  >
                    메시지
                  </button>
                </div>
              </div>

              <div className="filter-group">
                <label>에이전트</label>
                <select value={logAgentFilter} onChange={(e) => setLogAgentFilter(e.target.value)}>
                  <option value="all">전체</option>
                  {uniqueAgentNames.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>

              <div className="filter-stats">
                {filteredLogs.length} 로그
              </div>
            </div>

            <div className="terminal-output">
              {filteredLogs.length === 0 ? (
                <div className="empty-panel">
                  <strong>로그 없음</strong>
                  <p>선택한 필터에 해당하는 로그가 없습니다.</p>
                </div>
              ) : (
                filteredLogs.map(event => {
                  const agent = agentsWithStale.find(a => a.name === event.agentName)
                  const projectName = shortProject(agent?.projectPath)
                  const sourceBadge = getSourceBadge(event.source)
                  return (
                    <div className="log-entry" key={event.id}>
                      <span className="log-time">{formatTime(event.timestamp)}</span>
                      <span className="log-agent">
                        {event.agentName}
                        {sourceBadge && (
                          <span className={`source-badge ${sourceBadge.className}`} title={sourceBadge.title} style={{ marginLeft: '4px' }}>
                            {sourceBadge.label}
                          </span>
                        )}
                      </span>
                      <span className="log-project">{projectName}</span>
                      <span className={`log-type ${event.type}`}>{getTypeLabel(event.type)}</span>
                      {event.tool && <span className="log-tool">{event.tool}</span>}
                      <span className="log-summary">{sanitizeForDisplay(event.summary)}</span>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </main>
      )}

      {activeView === 'reports' && (
        <main className="simple-page">
          <section className="reports-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Reports</p>
                <h2>에이전트 보고서</h2>
              </div>
              <button type="button" onClick={fetchReports} disabled={loadingReports}>
                {loadingReports ? '불러오는 중...' : '새로고침'}
              </button>
            </div>

            {reportsError && (
              <div className="reports-error">
                <span>{reportsError}</span>
              </div>
            )}

            <div className="reports-layout">
              <div className="reports-list">
                <div className="reports-search">
                  <input
                    type="text"
                    placeholder="보고서 검색..."
                    value={reportSearchQuery}
                    onChange={(e) => setReportSearchQuery(e.target.value)}
                    className="search-input"
                  />
                </div>
                {loadingReports ? (
                  <div className="empty-panel">
                    <strong>불러오는 중...</strong>
                  </div>
                ) : reports.length === 0 ? (
                  <div className="empty-panel">
                    <strong>보고서 없음</strong>
                    <p>.agents 폴더에 마크다운 파일이 없습니다.</p>
                  </div>
                ) : filteredReports.length === 0 ? (
                  <div className="empty-panel">
                    <strong>검색 결과 없음</strong>
                    <p>"{reportSearchQuery}"와 일치하는 보고서가 없습니다.</p>
                  </div>
                ) : (
                  <div className="reports-groups">
                    {groupedReports.map(([folder, folderReports]) => (
                      <div key={folder} className="report-group">
                        {folder && <div className="report-group-header">{folder}/</div>}
                        {folderReports.map(report => (
                          <button
                            key={report.path}
                            type="button"
                            className={`report-item ${selectedReportPath === report.path ? 'selected' : ''}`}
                            onClick={() => fetchReportContent(report.path)}
                          >
                            <strong>{report.name}</strong>
                            <small>{formatFileSize(report.size)} · {formatDate(report.modified)}</small>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="reports-content">
                {loadingContent ? (
                  <div className="empty-panel">
                    <strong>읽는 중...</strong>
                  </div>
                ) : selectedReport ? (
                  <div className="report-viewer">
                    <div className="report-header">
                      <h3>{selectedReport.path}</h3>
                      <small>{formatFileSize(selectedReport.size)} · {formatDate(selectedReport.modified)}</small>
                    </div>
                    <pre className="report-content">{selectedReport.content}</pre>
                  </div>
                ) : (
                  <div className="empty-panel">
                    <strong>보고서를 선택하세요</strong>
                    <p>왼쪽 목록에서 보고서를 선택하면 내용이 표시됩니다.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      )}

      {activeView === 'settings' && (
        <main className="simple-page">
          <section className="settings-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Settings</p>
                <h2>연결 설정</h2>
              </div>
            </div>
            <div className="setting-item">
              <span>연결 상태</span>
              <strong className={connectionState.status === 'connected' ? 'status-connected' : connectionState.status === 'reconnecting' ? 'status-reconnecting' : 'status-disconnected'}>
                {getConnectionStatusLabel(connectionState.status)}
              </strong>
            </div>
            <div className="setting-item">
              <span>서버</span>
              <strong>{window.location.host}</strong>
            </div>
            <div className="setting-item">
              <span>모드</span>
              <strong>읽기 전용 관제</strong>
            </div>
            {connectionState.lastConnectedAt && (
              <div className="setting-item">
                <span>마지막 연결 성공</span>
                <strong>{formatDate(connectionState.lastConnectedAt)}</strong>
              </div>
            )}
            {connectionState.lastMessageAt && (
              <div className="setting-item">
                <span>마지막 메시지 수신</span>
                <strong>{formatDate(connectionState.lastMessageAt)}</strong>
              </div>
            )}
            {connectionState.status === 'reconnecting' && (
              <>
                <div className="setting-item">
                  <span>재연결 시도</span>
                  <strong>{connectionState.reconnectAttempts}회</strong>
                </div>
                <div className="setting-item">
                  <span>다음 시도까지</span>
                  <strong>{formatDelayMs(connectionState.nextRetryDelayMs)}</strong>
                </div>
              </>
            )}
            <button className="danger" onClick={logout}>로그아웃</button>
          </section>

          <section className="settings-panel notification-settings-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Notifications</p>
                <h2>알림 설정</h2>
              </div>
            </div>
            <div className="setting-item">
              <span>검수 대기 알림</span>
              <div className="notification-toggle-group">
                <button
                  type="button"
                  onClick={toggleNotification}
                  className={`notification-toggle ${notificationEnabled ? 'active' : ''}`}
                >
                  {notificationEnabled ? 'ON' : 'OFF'}
                </button>
                <span className="notification-status">
                  {notificationPermission === 'granted' && notificationEnabled && '활성화됨'}
                  {notificationPermission === 'granted' && !notificationEnabled && '비활성화됨'}
                  {notificationPermission === 'denied' && '브라우저에서 차단됨'}
                  {notificationPermission === 'default' && '권한 없음'}
                </span>
              </div>
            </div>
            <div className="notification-info">
              <p>
                에이전트가 검수 대기 상태(needsReview=true, reviewState=pending)가 되면
                브라우저 알림과 앱 내 토스트를 표시합니다.
              </p>
              {notificationPermission === 'denied' && (
                <p className="warning-text">
                  브라우저 설정에서 알림 권한을 허용해 주세요.
                </p>
              )}
            </div>
          </section>

          <section className="settings-panel diagnostics-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Diagnostics</p>
                <h2>시스템 진단</h2>
              </div>
              <button type="button" onClick={fetchDiagnostics} disabled={loadingDiagnostics} className="refresh-btn">
                {loadingDiagnostics ? '새로고침 중...' : '새로고침'}
              </button>
            </div>

            {diagnostics ? (
              <>
                <div className="diagnostics-section">
                  <h3>서버 상태</h3>
                  <div className="setting-item">
                    <span>서버 시작 시각</span>
                    <strong>{formatDate(diagnostics.startTime)}</strong>
                  </div>
                  <div className="setting-item">
                    <span>가동 시간</span>
                    <strong>{formatUptime(diagnostics.uptime)}</strong>
                  </div>
                  <div className="setting-item">
                    <span>클라이언트 버전</span>
                    <strong>v{diagnostics.clientVersion}</strong>
                  </div>
                </div>

                <div className="diagnostics-section">
                  <h3>WebSocket 연결</h3>
                  <div className="setting-item">
                    <span>연결 상태</span>
                    <strong className={state.connected ? 'status-connected' : 'status-disconnected'}>
                      {getWebSocketStatusLabel(state.connected)}
                    </strong>
                  </div>
                  <div className="setting-item">
                    <span>활성 연결 수</span>
                    <strong>{diagnostics.connectionStats.activeConnections}</strong>
                  </div>
                  <div className="setting-item">
                    <span>마지막 연결</span>
                    <strong>
                      {diagnostics.connectionStats.lastConnected
                        ? formatDate(diagnostics.connectionStats.lastConnected)
                        : '없음'}
                    </strong>
                  </div>
                  <div className="setting-item">
                    <span>마지막 클라이언트 메시지</span>
                    <strong>
                      {diagnostics.connectionStats.lastClientMessageAt
                        ? formatDate(diagnostics.connectionStats.lastClientMessageAt)
                        : '없음'}
                    </strong>
                  </div>
                  <div className="setting-item">
                    <span>총 연결 수</span>
                    <strong>{diagnostics.connectionStats.totalConnections}</strong>
                  </div>
                  <div className="setting-item">
                    <span>총 메시지 수</span>
                    <strong>{diagnostics.connectionStats.totalMessages}</strong>
                  </div>
                </div>

                <div className="diagnostics-section">
                  <h3>모니터링 현황</h3>
                  <div className="setting-item">
                    <span>활성 세션</span>
                    <strong>{diagnostics.activeSessions} / {diagnostics.totalSessions}</strong>
                  </div>
                  <div className="setting-item">
                    <span>활성 에이전트</span>
                    <strong>{diagnostics.activeAgents} / {diagnostics.totalAgents}</strong>
                  </div>
                  <div className="setting-item">
                    <span>감시 중인 프로젝트</span>
                    <strong>{diagnostics.watchedProjects}</strong>
                  </div>
                  <div className="setting-item">
                    <span>총 이벤트 수</span>
                    <strong>{diagnostics.totalEvents}</strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-panel">
                <strong>진단 정보를 불러오는 중...</strong>
              </div>
            )}
          </section>
        </main>
      )}

      {showToast && (
        <div className="toast">
          클립보드에 복사되었습니다
        </div>
      )}

      {/* Review toasts - top right */}
      {reviewToasts.length > 0 && (
        <div className="review-toast-container">
          {reviewToasts.map(toast => (
            <div
              key={toast.id}
              className="review-toast"
              onClick={() => handleReviewToastClick(toast.agentId)}
            >
              <div className="review-toast-content">
                <strong>검수 필요</strong>
                <p>{toast.agentName} 작업이 완료된 것으로 보입니다.</p>
              </div>
              <button
                type="button"
                className="review-toast-close"
                onClick={(e) => {
                  e.stopPropagation()
                  removeReviewToast(toast.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
