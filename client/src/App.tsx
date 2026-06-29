import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import './App.css'
import PixelOffice from './components/PixelOffice'

interface ActivityLog {
  timestamp: string
  type: 'tool_use' | 'message' | 'result'
  tool?: string
  summary: string
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
}

interface Session {
  id: string
  projectPath: string
  agents: Agent[]
  isActive: boolean
  lastActivity: string
}

interface Metrics {
  totalTokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  totalCost: number
  cacheHitRate: number
  activeAgents: number
  totalAgents: number
  activeSessions: number
}

interface AppState {
  connected: boolean
  sessions: Session[]
  agents: Agent[]
  metrics: Metrics
  output: string[]
}

interface TimelineEvent {
  id: string
  agentName: string
  timestamp: string
  type: ActivityLog['type']
  summary: string
  tool?: string
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

function getStatusLabel(status: Agent['status']) {
  if (status === 'working') return '작업 중'
  if (status === 'waiting') return '대기'
  return '휴식'
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
      }))
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 16)
}

export default function App() {
  const [state, setState] = useState<AppState>({
    connected: false,
    sessions: [],
    agents: [],
    metrics: initialMetrics,
    output: [],
  })
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') || '')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeView, setActiveView] = useState<'ops' | 'logs' | 'settings'>('ops')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const shouldReconnectRef = useRef(true)
  const outputRef = useRef<HTMLDivElement>(null)

  const selectedAgent = useMemo(
    () => state.agents.find(agent => agent.id === selectedAgentId) || state.agents[0] || null,
    [selectedAgentId, state.agents],
  )
  const timeline = useMemo(() => buildTimeline(state.agents), [state.agents])
  const activeProjectCount = useMemo(
    () => new Set(state.sessions.map(session => session.projectPath)).size,
    [state.sessions],
  )

  const connect = useCallback(() => {
    if (!authToken) return
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return
    }

    shouldReconnectRef.current = true
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    setConnectionError('')

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = import.meta.env.DEV
      ? `${window.location.hostname}:9876`
      : window.location.host
    const wsUrl = `${protocol}//${host}?token=${authToken}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setState(current => ({ ...current, connected: true }))
      setIsAuthenticated(true)
      setConnectionError('')
      localStorage.setItem('authToken', authToken)
    }

    ws.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data)

      switch (type) {
        case 'init':
        case 'status_update':
          setState(current => ({
            ...current,
            sessions: data.sessions || current.sessions,
            agents: data.agents || current.agents,
            metrics: data.metrics || current.metrics,
          }))
          break
        case 'agent_updated':
          setState(current => ({
            ...current,
            agents: current.agents.some(agent => agent.id === data.id)
              ? current.agents.map(agent => agent.id === data.id ? data : agent)
              : [...current.agents, data],
          }))
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
      setState(current => ({ ...current, connected: false }))

      if (!shouldReconnectRef.current) return

      if (event.code === 4001) {
        shouldReconnectRef.current = false
        localStorage.removeItem('authToken')
        setAuthToken('')
        setIsAuthenticated(false)
        setConnectionError('토큰이 만료되었거나 서버 토큰이 바뀌었습니다. 새 토큰을 다시 입력해 주세요.')
        return
      }

      const reason = event.code === 4029
        ? '연결 시도가 너무 많아 잠시 후 다시 연결합니다.'
        : '서버 연결이 끊겼습니다. 잠시 후 다시 연결합니다.'
      setConnectionError(reason)

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null
        connect()
      }, 3000)
    }

    ws.onerror = () => {
      setConnectionError('서버에 연결하지 못했습니다. 서버 실행 상태와 토큰을 확인해 주세요.')
    }
  }, [authToken])

  const logout = useCallback(() => {
    shouldReconnectRef.current = false
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    localStorage.removeItem('authToken')
    setAuthToken('')
    setIsAuthenticated(false)
    setConnectionError('')
    wsRef.current?.close(1000, 'logout')
    wsRef.current = null
  }, [])

  useEffect(() => {
    if (authToken && !wsRef.current) {
      connect()
    }
    return () => {
      shouldReconnectRef.current = false
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      wsRef.current?.close(1000, 'cleanup')
      wsRef.current = null
    }
  }, [authToken, connect])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [state.output])

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
                <span>{activeProjectCount} 프로젝트</span>
                <span>{state.sessions.length} 세션</span>
              </div>
            </div>

            <PixelOffice
              agents={state.agents}
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
                <div className="agent-profile">
                  <span className={`profile-dot ${selectedAgent.status}`} />
                  <div>
                    <strong>{selectedAgent.name}</strong>
                    <p>{getRole(selectedAgent)} · {selectedAgent.agentType === 'sub' ? '서브 에이전트' : '메인 에이전트'}</p>
                  </div>
                  <span className={`status-pill ${selectedAgent.status}`}>{getStatusLabel(selectedAgent.status)}</span>
                </div>

                <div className="task-card">
                  <small>현재 미션</small>
                  <p>{selectedAgent.currentTaskFull || selectedAgent.currentTask || '대기 중인 작업이 없습니다.'}</p>
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
                          <strong>{activity.summary}</strong>
                          <small>{formatTime(activity.timestamp)}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">아직 기록된 활동이 없습니다.</p>
                  )}
                </div>
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
              {state.agents.length === 0 ? (
                <div className="empty-panel">
                  <strong>활성 직원 없음</strong>
                  <p>터미널에서 Claude Code 작업을 시작하면 자동으로 감지됩니다.</p>
                </div>
              ) : (
                state.agents.map(agent => (
                  <button
                    type="button"
                    key={agent.id}
                    className={`staff-row ${agent.status} ${selectedAgent?.id === agent.id ? 'selected' : ''}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <span className={`profile-dot ${agent.status}`} />
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{getRole(agent)} · {shortProject(agent.projectPath)}</small>
                    </span>
                    <em>{getStatusLabel(agent.status)}</em>
                  </button>
                ))
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
                timeline.map(event => (
                  <div className="event-row" key={event.id}>
                    <span className={`event-type ${event.type}`} />
                    <div>
                      <strong>{event.summary}</strong>
                      <p>{event.agentName}{event.tool ? ` · ${event.tool}` : ''}</p>
                    </div>
                    <time>{formatTime(event.timestamp)}</time>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      )}

      {activeView === 'logs' && (
        <main className="simple-page">
          <section className="terminal-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Logs</p>
                <h2>시스템 로그</h2>
              </div>
            </div>
            <div className="terminal-output" ref={outputRef}>
              {state.output.length === 0 ? (
                <div className="empty-panel">
                  <strong>로그 대기 중</strong>
                  <p>Claude 세션 활동 로그가 준비되면 이곳에 표시됩니다.</p>
                </div>
              ) : (
                state.output.map((line, index) => <pre key={`${line}-${index}`}>{line}</pre>)
              )}
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
              <span>상태</span>
              <strong>{state.connected ? '연결됨' : '연결 끊김'}</strong>
            </div>
            <div className="setting-item">
              <span>서버</span>
              <strong>{window.location.host}</strong>
            </div>
            <div className="setting-item">
              <span>모드</span>
              <strong>읽기 전용 관제</strong>
            </div>
            <button className="danger" onClick={logout}>로그아웃</button>
          </section>
        </main>
      )}
    </div>
  )
}
