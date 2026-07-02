import { useMemo, useState, useRef, useEffect } from 'react'
import './OperationsMap.css'
import { sanitizeForDisplay } from '../utils/sanitize'

interface ActivityLog {
  timestamp: string
  type: 'tool_use' | 'message' | 'result'
  tool?: string
  summary: string
}

export interface Agent {
  id: string
  name: string
  status: 'idle' | 'working' | 'waiting'
  agentType?: 'main' | 'sub'
  currentTask?: string
  currentTaskFull?: string
  recentTools?: string[]
  recentActivity?: ActivityLog[]
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  cost: number
  projectPath?: string
  isStale?: boolean
  source?: 'claude' | 'codex'
  needsReview?: boolean
  reviewCandidateAt?: string
  reviewReason?: string
  reviewState?: 'pending' | 'acknowledged' | 'copied' | 'dismissed'
}

interface OperationsMapProps {
  agents: Agent[]
  selectedAgentId?: string | null
  onSelectAgent?: (agentId: string) => void
}

interface ProjectNode {
  name: string
  path: string
  agents: Agent[]
}

function getStatusClass(agent: Agent): string {
  if (agent.needsReview) {
    switch (agent.reviewState) {
      case 'acknowledged':
      case 'copied':
        return 'review-ack'
      case 'dismissed':
        return 'review-dismissed'
      default:
        return 'review-pending'
    }
  }
  if (agent.isStale) return 'stale'
  return agent.status
}

function getStatusLabel(agent: Agent): string {
  if (agent.needsReview) {
    switch (agent.reviewState) {
      case 'acknowledged':
        return '확인함'
      case 'copied':
        return '복사됨'
      case 'dismissed':
        return '해제됨'
      default:
        return '검수'
    }
  }
  if (agent.isStale) return '비활성'
  switch (agent.status) {
    case 'working': return '작업 중'
    case 'waiting': return '대기 중'
    case 'idle': return '유휴'
    default: return agent.status
  }
}

export default function OperationsMap({ agents, selectedAgentId, onSelectAgent }: OperationsMapProps) {
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Group agents by project
  const projectNodes: ProjectNode[] = useMemo(() => {
    const projectMap = new Map<string, Agent[]>()

    agents.forEach(agent => {
      const path = agent.projectPath || '알 수 없는 프로젝트'
      if (!projectMap.has(path)) {
        projectMap.set(path, [])
      }
      projectMap.get(path)!.push(agent)
    })

    return Array.from(projectMap.entries()).map(([path, projectAgents]) => ({
      name: path.split('/').pop() || '프로젝트',
      path,
      agents: projectAgents
    }))
  }, [agents])

  // Flat list of all agents for keyboard navigation
  const allAgents = useMemo(() => projectNodes.flatMap(p => p.agents), [projectNodes])

  // Update focused index when selected agent changes
  useEffect(() => {
    if (selectedAgentId) {
      const idx = allAgents.findIndex(a => a.id === selectedAgentId)
      if (idx !== -1) setFocusedIndex(idx)
    }
  }, [selectedAgentId, allAgents])

  const handleAgentClick = (agent: Agent) => {
    if (onSelectAgent) {
      onSelectAgent(agent.id)
    }
  }

  const handleAgentHover = (agent: Agent, event: React.MouseEvent) => {
    setHoveredAgent(agent)
    setTooltipPos({ x: event.clientX, y: event.clientY })
  }

  const handleAgentLeave = () => {
    setHoveredAgent(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (allAgents.length === 0) return

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        setFocusedIndex(prev => (prev + 1) % allAgents.length)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        setFocusedIndex(prev => (prev - 1 + allAgents.length) % allAgents.length)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < allAgents.length && onSelectAgent) {
          onSelectAgent(allAgents[focusedIndex].id)
        }
        break
      case 'Home':
        event.preventDefault()
        setFocusedIndex(0)
        break
      case 'End':
        event.preventDefault()
        setFocusedIndex(allAgents.length - 1)
        break
    }
  }

  const handleFocus = () => {
    if (focusedIndex === -1 && allAgents.length > 0) {
      const selectedIdx = allAgents.findIndex(a => a.id === selectedAgentId)
      setFocusedIndex(selectedIdx >= 0 ? selectedIdx : 0)
    }
    if (focusedIndex >= 0 && focusedIndex < allAgents.length) {
      setHoveredAgent(allAgents[focusedIndex])
      setTooltipPos({ x: window.innerWidth / 2, y: window.innerHeight / 3 })
    }
  }

  const handleBlur = () => {
    setHoveredAgent(null)
  }

  // Update tooltip when focused index changes
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < allAgents.length) {
      setHoveredAgent(allAgents[focusedIndex])
    }
  }, [focusedIndex, allAgents])

  // Calculate clamped tooltip position
  const getTooltipStyle = () => {
    const tooltipWidth = 280
    const tooltipHeight = 240
    const padding = 10

    let left = tooltipPos.x + 15
    let top = tooltipPos.y - 10

    if (left + tooltipWidth > window.innerWidth - padding) {
      left = tooltipPos.x - tooltipWidth - 15
    }
    if (left < padding) {
      left = padding
    }
    if (top + tooltipHeight > window.innerHeight - padding) {
      top = window.innerHeight - tooltipHeight - padding
    }
    if (top < padding) {
      top = padding
    }

    return { left, top }
  }

  // Count agents by status
  const statusCounts = useMemo(() => {
    const counts = { working: 0, idle: 0, waiting: 0, review: 0, stale: 0 }
    agents.forEach(agent => {
      if (agent.needsReview && agent.reviewState !== 'dismissed') counts.review++
      else if (agent.isStale) counts.stale++
      else counts[agent.status]++
    })
    return counts
  }, [agents])

  if (agents.length === 0) {
    return (
      <div className="operations-map">
        <div className="ops-empty-state">
          <div className="ops-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <circle cx="15.5" cy="8.5" r="1.5" />
              <circle cx="8.5" cy="15.5" r="1.5" />
              <circle cx="15.5" cy="15.5" r="1.5" />
              <line x1="8.5" y1="10" x2="8.5" y2="14" />
              <line x1="15.5" y1="10" x2="15.5" y2="14" />
              <line x1="10" y1="8.5" x2="14" y2="8.5" />
              <line x1="10" y1="15.5" x2="14" y2="15.5" />
            </svg>
          </div>
          <h3>모니터링 대기</h3>
          <p>Claude Code 또는 Codex 세션이 시작되면 여기에 에이전트가 표시됩니다.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="operations-map"
      ref={containerRef}
      tabIndex={0}
      role="grid"
      aria-label="프로젝트별 활성 에이전트를 보여주는 관제 맵"
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {/* Status Bar */}
      <div className="ops-status-bar">
        <div className="ops-status-summary">
          <span className="ops-total">{agents.length} 에이전트</span>
          <span className="ops-divider">|</span>
          {statusCounts.working > 0 && (
            <span className="ops-stat working">
              <span className="ops-stat-dot" />
              {statusCounts.working} 작업 중
            </span>
          )}
          {statusCounts.review > 0 && (
            <span className="ops-stat review">
              <span className="ops-stat-dot" />
              {statusCounts.review} 검수
            </span>
          )}
          {statusCounts.waiting > 0 && (
            <span className="ops-stat waiting">
              <span className="ops-stat-dot" />
              {statusCounts.waiting} 대기 중
            </span>
          )}
          {statusCounts.idle > 0 && (
            <span className="ops-stat idle">
              <span className="ops-stat-dot" />
              {statusCounts.idle} 유휴
            </span>
          )}
        </div>
        <div className="ops-legend">
          <span className="ops-legend-item"><span className="legend-dot working" /> 작업 중</span>
          <span className="ops-legend-item"><span className="legend-dot idle" /> 유휴</span>
          <span className="ops-legend-item"><span className="legend-dot waiting" /> 대기 중</span>
          <span className="ops-legend-item"><span className="legend-dot review" /> 검수</span>
        </div>
      </div>

      {/* Project Grid */}
      <div className="ops-project-grid">
        {projectNodes.map((project) => (
          <div key={project.path} className="ops-project-node">
            <div className="ops-project-header">
              <span className="ops-project-icon">
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H13.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" />
                </svg>
              </span>
              <span className="ops-project-name" title={project.path}>
                {project.name}
              </span>
              <span className="ops-project-count">{project.agents.length}</span>
            </div>

            <div className="ops-agent-rack">
              {project.agents.map((agent) => {
                const statusClass = getStatusClass(agent)
                const isSelected = agent.id === selectedAgentId
                const isFocused = allAgents[focusedIndex]?.id === agent.id

                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`ops-agent-slot ${statusClass} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
                    onClick={() => handleAgentClick(agent)}
                    onMouseEnter={(e) => handleAgentHover(agent, e)}
                    onMouseLeave={handleAgentLeave}
                    onTouchStart={(e) => {
                      const touch = e.touches[0]
                      setTooltipPos({ x: touch.clientX, y: touch.clientY })
                      setHoveredAgent(agent)
                    }}
                    onTouchEnd={() => {
                      setTimeout(() => setHoveredAgent(null), 2000)
                    }}
                    aria-label={`${agent.name}, ${getStatusLabel(agent)}, ${agent.source || '알 수 없음'} 소스`}
                    aria-selected={isSelected}
                    tabIndex={-1}
                  >
                    <span className="ops-agent-indicator">
                      <span className={`ops-status-light ${statusClass}`} />
                    </span>
                    <span className="ops-agent-name">{agent.name}</span>
                    {agent.source && (
                      <span className={`ops-source-badge ${agent.source}`}>
                        {agent.source === 'claude' ? 'C' : 'X'}
                      </span>
                    )}
                    {agent.needsReview && agent.reviewState !== 'dismissed' && (
                      <span className="ops-review-indicator" title="검수 필요">!</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="ops-project-path" title={project.path}>
              {project.path}
            </div>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {hoveredAgent && (
        <div className="ops-tooltip" style={getTooltipStyle()}>
          <div className="ops-tooltip-header">
            <span className={`ops-tooltip-status ${getStatusClass(hoveredAgent)}`} />
            <span className="ops-tooltip-name">{hoveredAgent.name}</span>
            {hoveredAgent.source && (
              <span className={`ops-source-badge ${hoveredAgent.source}`}>
                {hoveredAgent.source === 'claude' ? 'C' : 'X'}
              </span>
            )}
            <span className={`ops-tooltip-type ${hoveredAgent.agentType || 'main'}`}>
              {hoveredAgent.agentType === 'sub' ? 'SUB' : 'MAIN'}
            </span>
          </div>

          {hoveredAgent.needsReview && (
            <div className={`ops-tooltip-review ${hoveredAgent.reviewState || 'pending'}`}>
              {hoveredAgent.reviewState === 'acknowledged' ? '확인함' :
               hoveredAgent.reviewState === 'copied' ? '복사됨' :
               hoveredAgent.reviewState === 'dismissed' ? '해제됨' :
               '검수 필요'}
            </div>
          )}

          {hoveredAgent.isStale && (
            <div className="ops-tooltip-stale">비활성 - 5분 이상 활동 없음</div>
          )}

          {hoveredAgent.projectPath && (
            <div className="ops-tooltip-project" title={hoveredAgent.projectPath}>
              {hoveredAgent.projectPath}
            </div>
          )}

          {hoveredAgent.currentTask && (
            <div className="ops-tooltip-task">{sanitizeForDisplay(hoveredAgent.currentTask)}</div>
          )}

          <div className="ops-tooltip-stats">
            <span>In: {(hoveredAgent.tokens.input / 1000).toFixed(1)}k</span>
            <span>Out: {(hoveredAgent.tokens.output / 1000).toFixed(1)}k</span>
            <span>${hoveredAgent.cost.toFixed(4)}</span>
          </div>

          {hoveredAgent.recentTools && hoveredAgent.recentTools.length > 0 && (
            <div className="ops-tooltip-tools">
              {hoveredAgent.recentTools.slice(-4).map((tool, i) => (
                <span key={i} className="ops-tooltip-tool">{tool}</span>
              ))}
            </div>
          )}

          {hoveredAgent.recentActivity && hoveredAgent.recentActivity.length > 0 && (
            <div className="ops-tooltip-activity">
              {hoveredAgent.recentActivity.slice(-3).reverse().map((act, i) => (
                <div key={i} className="ops-tooltip-activity-item">
                  {sanitizeForDisplay(act.summary)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
