import { useState, useEffect } from 'react'

interface Agent {
  id: string
  name: string
  status: 'idle' | 'working' | 'waiting'
  needsReview?: boolean
  reviewCandidateAt?: string
  reviewReason?: string
  reviewState?: 'pending' | 'acknowledged' | 'copied' | 'dismissed'
  projectPath?: string
  source?: 'claude' | 'codex'
}

type ReviewStateType = 'pending' | 'acknowledged' | 'copied' | 'dismissed'
type FilterType = 'all' | ReviewStateType

interface ReviewQueueProps {
  agents: Agent[]
  onSelectAgent: (agentId: string) => void
  onUpdateReviewState?: (agentId: string, state: ReviewStateType) => void
}

function formatTimeSince(timestamp: string): string {
  const now = new Date().getTime()
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return '방금'
  const secondsAgo = Math.floor((now - then) / 1000)

  if (secondsAgo < 60) return '방금'
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}분`
  if (secondsAgo < 86400) return `${Math.floor(secondsAgo / 3600)}시간`
  return `${Math.floor(secondsAgo / 86400)}일`
}

function getSourceBadge(source?: 'claude' | 'codex') {
  if (!source) return null
  if (source === 'claude') {
    return { label: 'C', title: 'Claude', className: 'claude' }
  }
  return { label: 'X', title: 'Codex', className: 'codex' }
}

function getStateLabel(state: string): string {
  switch (state) {
    case 'pending': return '대기'
    case 'acknowledged': return '확인함'
    case 'copied': return '복사 완료'
    case 'dismissed': return '숨김'
    default: return state
  }
}

const FILTER_OPTIONS: { value: FilterType; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'pending', label: '대기' },
  { value: 'acknowledged', label: '확인함' },
  { value: 'copied', label: '복사 완료' },
  { value: 'dismissed', label: '숨김' },
]

const VALID_FILTERS: FilterType[] = ['all', 'pending', 'acknowledged', 'copied', 'dismissed']

function getInitialFilter(): FilterType {
  const saved = localStorage.getItem('reviewQueueFilter')
  if (saved && VALID_FILTERS.includes(saved as FilterType)) {
    return saved as FilterType
  }
  return 'all'
}

export default function ReviewQueue({ agents, onSelectAgent, onUpdateReviewState }: ReviewQueueProps) {
  const [filter, setFilter] = useState<FilterType>(getInitialFilter)

  // Persist filter to localStorage
  useEffect(() => {
    localStorage.setItem('reviewQueueFilter', filter)
  }, [filter])

  const reviewAgents = agents.filter(agent => agent.needsReview)

  const pendingCount = reviewAgents.filter(a => !a.reviewState || a.reviewState === 'pending').length
  const acknowledgedCount = reviewAgents.filter(a => a.reviewState === 'acknowledged').length
  const copiedCount = reviewAgents.filter(a => a.reviewState === 'copied').length
  const dismissedCount = reviewAgents.filter(a => a.reviewState === 'dismissed').length

  // Apply filter
  const filteredAgents = reviewAgents.filter(agent => {
    if (filter === 'all') return true
    const state = agent.reviewState || 'pending'
    return state === filter
  })

  // Sort by timestamp: oldest first (most urgent)
  const sortedReviewAgents = [...filteredAgents].sort((a, b) => {
    const timeA = a.reviewCandidateAt ? new Date(a.reviewCandidateAt).getTime() : 0
    const timeB = b.reviewCandidateAt ? new Date(b.reviewCandidateAt).getTime() : 0
    return timeA - timeB
  })

  if (reviewAgents.length === 0) {
    return null
  }

  const handleAction = (e: React.MouseEvent, agentId: string, state: ReviewStateType) => {
    e.stopPropagation()
    if (onUpdateReviewState) {
      onUpdateReviewState(agentId, state)
    }
  }

  const getFilterCount = (filterValue: FilterType): number => {
    switch (filterValue) {
      case 'all': return reviewAgents.length
      case 'pending': return pendingCount
      case 'acknowledged': return acknowledgedCount
      case 'copied': return copiedCount
      case 'dismissed': return dismissedCount
      default: return 0
    }
  }

  return (
    <div className="review-queue-container">
      <div className="review-queue-header">
        <div>
          <h3>검수 큐</h3>
          <p>총 {reviewAgents.length}개 · 표시 {sortedReviewAgents.length}개</p>
        </div>
        <div className="review-queue-stats">
          <span className="queue-stat pending" title="대기">{pendingCount}</span>
          <span className="queue-stat acknowledged" title="확인함/복사완료">{acknowledgedCount + copiedCount}</span>
          <span className="queue-stat dismissed" title="숨김">{dismissedCount}</span>
        </div>
      </div>

      <div className="review-queue-filters">
        {FILTER_OPTIONS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`filter-btn ${filter === option.value ? 'active' : ''}`}
            onClick={() => setFilter(option.value)}
          >
            {option.label} ({getFilterCount(option.value)})
          </button>
        ))}
      </div>

      <div className="review-queue-list">
        {sortedReviewAgents.length === 0 ? (
          <div className="review-queue-empty">해당 상태의 항목이 없습니다</div>
        ) : (
          sortedReviewAgents.map(agent => {
            const sourceBadge = getSourceBadge(agent.source)
            const waitTime = agent.reviewCandidateAt ? formatTimeSince(agent.reviewCandidateAt) : '방금'
            const state = agent.reviewState || 'pending'

            return (
              <div
                key={agent.id}
                className={`review-queue-item state-${state}`}
                onClick={() => onSelectAgent(agent.id)}
                onKeyDown={(e) => e.key === 'Enter' && onSelectAgent(agent.id)}
                role="button"
                tabIndex={0}
              >
                <span className={`review-dot state-${state}`} />
                <div className="review-item-content">
                  <strong>
                    {agent.name}
                    {sourceBadge && (
                      <span className={`source-badge ${sourceBadge.className}`} title={sourceBadge.title}>
                        {sourceBadge.label}
                      </span>
                    )}
                  </strong>
                  <small>{waitTime} 전 · {getStateLabel(state)}</small>
                </div>
                {onUpdateReviewState && (
                  <div className="review-item-actions">
                    {state === 'pending' && (
                      <button
                        type="button"
                        className="action-btn ack"
                        title="확인함"
                        aria-label={`${agent.name} 확인함으로 표시`}
                        onClick={(e) => handleAction(e, agent.id, 'acknowledged')}
                      >
                        ✓
                      </button>
                    )}
                    {state !== 'dismissed' && (
                      <button
                        type="button"
                        className="action-btn dismiss"
                        title="숨기기"
                        aria-label={`${agent.name} 숨기기`}
                        onClick={(e) => handleAction(e, agent.id, 'dismissed')}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
