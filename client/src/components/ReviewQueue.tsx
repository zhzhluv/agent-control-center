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

interface ReviewQueueProps {
  agents: Agent[]
  onSelectAgent: (agentId: string) => void
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

export default function ReviewQueue({ agents, onSelectAgent }: ReviewQueueProps) {
  const reviewAgents = agents.filter(agent => agent.needsReview)

  const pendingCount = reviewAgents.filter(a => !a.reviewState || a.reviewState === 'pending').length
  const acknowledgedCount = reviewAgents.filter(a => a.reviewState === 'acknowledged').length
  const copiedCount = reviewAgents.filter(a => a.reviewState === 'copied').length
  const dismissedCount = reviewAgents.filter(a => a.reviewState === 'dismissed').length

  // Sort by timestamp: oldest first (most urgent)
  const sortedReviewAgents = [...reviewAgents].sort((a, b) => {
    const timeA = a.reviewCandidateAt ? new Date(a.reviewCandidateAt).getTime() : 0
    const timeB = b.reviewCandidateAt ? new Date(b.reviewCandidateAt).getTime() : 0
    return timeA - timeB
  })

  if (reviewAgents.length === 0) {
    return null
  }

  return (
    <div className="review-queue-container">
      <div className="review-queue-header">
        <div>
          <h3>검수 큐</h3>
          <p>총 {reviewAgents.length}개 검수 대기</p>
        </div>
        <div className="review-queue-stats">
          <span className="queue-stat pending">{pendingCount}</span>
          <span className="queue-stat acknowledged">{acknowledgedCount + copiedCount}</span>
          <span className="queue-stat dismissed">{dismissedCount}</span>
        </div>
      </div>

      <div className="review-queue-list">
        {sortedReviewAgents.map(agent => {
          const sourceBadge = getSourceBadge(agent.source)
          const waitTime = agent.reviewCandidateAt ? formatTimeSince(agent.reviewCandidateAt) : '방금'
          const state = agent.reviewState || 'pending'

          return (
            <button
              key={agent.id}
              type="button"
              className={`review-queue-item state-${state}`}
              onClick={() => onSelectAgent(agent.id)}
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
            </button>
          )
        })}
      </div>
    </div>
  )
}

function getStateLabel(state: string): string {
  switch (state) {
    case 'pending': return '검수 대기'
    case 'acknowledged': return '확인함'
    case 'copied': return '복사 완료'
    case 'dismissed': return '숨김'
    default: return state
  }
}
