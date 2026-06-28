import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

interface Agent {
  id: string
  name: string
  status: 'idle' | 'working' | 'waiting'
  currentTask?: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  cost: number
}

interface Session {
  id: string
  workingDir: string
  agents: Agent[]
  status: 'active' | 'paused' | 'stopped'
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

const initialMetrics: Metrics = {
  totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  totalCost: 0,
  cacheHitRate: 0,
  activeAgents: 0,
  totalAgents: 0,
  activeSessions: 0
}

export default function App() {
  const [state, setState] = useState<AppState>({
    connected: false,
    sessions: [],
    agents: [],
    metrics: initialMetrics,
    output: []
  })
  const [command, setCommand] = useState('')
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken') || '')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeView, setActiveView] = useState<'dashboard' | 'terminal' | 'settings'>('dashboard')

  const wsRef = useRef<WebSocket | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)

  const connect = useCallback(() => {
    if (!authToken) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}?token=${authToken}`

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      setState(s => ({ ...s, connected: true }))
      setIsAuthenticated(true)
      localStorage.setItem('authToken', authToken)
    }

    ws.onmessage = (event) => {
      const { type, data } = JSON.parse(event.data)

      switch (type) {
        case 'init':
        case 'status_update':
          setState(s => ({
            ...s,
            sessions: data.sessions || s.sessions,
            agents: data.agents || s.agents,
            metrics: data.metrics || s.metrics
          }))
          break
        case 'output':
          setState(s => ({
            ...s,
            output: [...s.output.slice(-100), data.output]
          }))
          break
        case 'session_started':
          setState(s => ({
            ...s,
            sessions: [...s.sessions, data]
          }))
          break
        case 'session_stopped':
          setState(s => ({
            ...s,
            sessions: s.sessions.filter(s => s.id !== data.sessionId)
          }))
          break
        case 'agent_spawned':
          setState(s => ({
            ...s,
            agents: [...s.agents, data.agent]
          }))
          break
      }
    }

    ws.onclose = () => {
      setState(s => ({ ...s, connected: false }))
      // Reconnect after 3 seconds
      setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      setIsAuthenticated(false)
    }

    wsRef.current = ws
  }, [authToken])

  useEffect(() => {
    if (authToken && !wsRef.current) {
      connect()
    }
    return () => {
      wsRef.current?.close()
    }
  }, [authToken, connect])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [state.output])

  const sendCommand = () => {
    if (!command.trim() || !wsRef.current) return

    wsRef.current.send(JSON.stringify({
      type: 'command',
      payload: { command }
    }))

    setState(s => ({
      ...s,
      output: [...s.output, `> ${command}`]
    }))
    setCommand('')
  }

  const startNewSession = (workingDir?: string) => {
    wsRef.current?.send(JSON.stringify({
      type: 'start_session',
      payload: { workingDir: workingDir || '~' }
    }))
  }

  const stopSession = (sessionId: string) => {
    wsRef.current?.send(JSON.stringify({
      type: 'stop_session',
      payload: { sessionId }
    }))
  }

  // Auth screen
  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-icon">🤖</div>
          <h1>Agent Control Center</h1>
          <p>맥미니에 설정된 토큰을 입력하세요</p>
          <input
            type="password"
            placeholder="Auth Token"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
          />
          <button className="primary" onClick={connect}>
            연결
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className={`status-dot ${state.connected ? 'connected' : 'disconnected'}`} />
          <h1>Agent Control</h1>
        </div>
        <div className="header-right">
          <span className="cost">${state.metrics.totalCost.toFixed(4)}</span>
        </div>
      </header>

      {/* Metrics Bar */}
      <div className="metrics-bar">
        <div className="metric">
          <span className="metric-value">{state.metrics.activeAgents}</span>
          <span className="metric-label">활성</span>
        </div>
        <div className="metric">
          <span className="metric-value">{state.metrics.totalAgents}</span>
          <span className="metric-label">전체</span>
        </div>
        <div className="metric">
          <span className="metric-value">{state.metrics.cacheHitRate}%</span>
          <span className="metric-label">캐시</span>
        </div>
        <div className="metric">
          <span className="metric-value">{(state.metrics.totalTokens.input / 1000).toFixed(1)}k</span>
          <span className="metric-label">입력</span>
        </div>
        <div className="metric">
          <span className="metric-value">{(state.metrics.totalTokens.output / 1000).toFixed(1)}k</span>
          <span className="metric-label">출력</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="nav-tabs">
        <button
          className={activeView === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveView('dashboard')}
        >
          대시보드
        </button>
        <button
          className={activeView === 'terminal' ? 'active' : ''}
          onClick={() => setActiveView('terminal')}
        >
          터미널
        </button>
        <button
          className={activeView === 'settings' ? 'active' : ''}
          onClick={() => setActiveView('settings')}
        >
          설정
        </button>
      </nav>

      {/* Main Content */}
      <main className="main-content">
        {activeView === 'dashboard' && (
          <div className="dashboard">
            {/* Sessions */}
            <section className="section">
              <div className="section-header">
                <h2>세션</h2>
                <button className="small primary" onClick={() => startNewSession()}>
                  + 새 세션
                </button>
              </div>

              {state.sessions.length === 0 ? (
                <div className="empty-state">
                  <p>실행 중인 세션이 없습니다</p>
                  <button className="primary" onClick={() => startNewSession()}>
                    새 세션 시작
                  </button>
                </div>
              ) : (
                <div className="session-list">
                  {state.sessions.map(session => (
                    <div key={session.id} className="session-card">
                      <div className="session-info">
                        <span className={`status-badge ${session.status}`}>
                          {session.status}
                        </span>
                        <span className="session-dir">{session.workingDir}</span>
                      </div>
                      <div className="session-agents">
                        {session.agents.length} 에이전트
                      </div>
                      <button
                        className="small danger"
                        onClick={() => stopSession(session.id)}
                      >
                        중지
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Agents */}
            <section className="section">
              <h2>에이전트</h2>
              {state.agents.length === 0 ? (
                <div className="empty-state">
                  <p>활성 에이전트 없음</p>
                </div>
              ) : (
                <div className="agent-grid">
                  {state.agents.map(agent => (
                    <div key={agent.id} className={`agent-card ${agent.status}`}>
                      <div className="agent-avatar">
                        {agent.status === 'working' ? '⚡' : agent.status === 'waiting' ? '⏳' : '😴'}
                      </div>
                      <div className="agent-info">
                        <span className="agent-name">{agent.name}</span>
                        <span className="agent-status">{agent.status}</span>
                        {agent.currentTask && (
                          <span className="agent-task">{agent.currentTask}</span>
                        )}
                      </div>
                      <div className="agent-stats">
                        <span>${agent.cost.toFixed(4)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeView === 'terminal' && (
          <div className="terminal-view">
            <div className="terminal-output" ref={outputRef}>
              {state.output.map((line, i) => (
                <pre key={i}>{line}</pre>
              ))}
            </div>
            <div className="terminal-input">
              <input
                type="text"
                placeholder="명령어 입력..."
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
              />
              <button className="primary" onClick={sendCommand}>
                전송
              </button>
            </div>
          </div>
        )}

        {activeView === 'settings' && (
          <div className="settings-view">
            <section className="section">
              <h2>연결 정보</h2>
              <div className="setting-item">
                <label>상태</label>
                <span className={state.connected ? 'text-success' : 'text-danger'}>
                  {state.connected ? '연결됨' : '연결 끊김'}
                </span>
              </div>
              <div className="setting-item">
                <label>서버</label>
                <span>{window.location.host}</span>
              </div>
            </section>

            <section className="section">
              <h2>토큰</h2>
              <button
                className="danger"
                onClick={() => {
                  localStorage.removeItem('authToken')
                  setAuthToken('')
                  setIsAuthenticated(false)
                  wsRef.current?.close()
                  wsRef.current = null
                }}
              >
                로그아웃
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
