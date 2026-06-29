import { useEffect, useMemo, useRef, useState } from 'react'
import './PixelOffice.css'

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
}

interface PixelOfficeProps {
  agents: Agent[]
  selectedAgentId?: string | null
  onSelectAgent?: (agentId: string) => void
}

interface ProjectRoom {
  name: string
  path: string
  agents: Agent[]
}

// 색상 팔레트
const COLORS = {
  bg: '#1a1a2e',
  floor: '#2d2d44',
  floorAlt: '#252538',
  wall: '#16213e',
  wallTop: '#1f3460',
  desk: '#8B4513',
  deskTop: '#A0522D',
  monitor: '#333',
  monitorScreen: '#00ff88',
  chair: '#4a4a6a',
  plant: '#228B22',
  plantPot: '#8B4513',
  working: '#4CAF50',
  idle: '#2196F3',
  waiting: '#FFC107',
  text: '#fff',
  textDim: '#888',
}

// 레이아웃 상수
const ROOM_WIDTH = 400
const ROOM_HEIGHT = 300
const ROOM_GAP = 20
const ROOMS_PER_ROW = 2
const CANVAS_PADDING = 30

// 룸 레이아웃 계산 helper
interface RoomLayout {
  canvasWidth: number
  canvasHeight: number
  gridWidth: number
  gridHeight: number
  originX: number
  originY: number
  getRoomPosition: (index: number) => { x: number; y: number }
}

function getRoomLayout(roomCount: number): RoomLayout {
  const count = Math.max(roomCount, 1)
  const cols = Math.min(count, ROOMS_PER_ROW)
  const rows = Math.ceil(count / ROOMS_PER_ROW)

  // 실제 그리드 크기 계산
  const gridWidth = cols * ROOM_WIDTH + (cols - 1) * ROOM_GAP
  const gridHeight = rows * ROOM_HEIGHT + (rows - 1) * ROOM_GAP

  // 캔버스 크기 = 그리드 + 패딩
  const canvasWidth = gridWidth + CANVAS_PADDING * 2
  const canvasHeight = gridHeight + CANVAS_PADDING * 2

  // 그리드 시작점 (캔버스 중앙 정렬)
  const originX = (canvasWidth - gridWidth) / 2
  const originY = (canvasHeight - gridHeight) / 2

  const getRoomPosition = (index: number) => {
    const col = index % ROOMS_PER_ROW
    const row = Math.floor(index / ROOMS_PER_ROW)
    return {
      x: originX + col * (ROOM_WIDTH + ROOM_GAP),
      y: originY + row * (ROOM_HEIGHT + ROOM_GAP)
    }
  }

  return {
    canvasWidth,
    canvasHeight,
    gridWidth,
    gridHeight,
    originX,
    originY,
    getRoomPosition
  }
}

export default function PixelOffice({ agents, selectedAgentId, onSelectAgent }: PixelOfficeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const frameRef = useRef(0)
  const animationFrameId = useRef<number>()

  // 프로젝트별로 에이전트 그룹화
  const projectRooms: ProjectRoom[] = useMemo(() => {
    const projectMap = new Map<string, Agent[]>()

    agents.forEach(agent => {
      const path = agent.projectPath || 'Unknown Project'
      if (!projectMap.has(path)) {
        projectMap.set(path, [])
      }
      projectMap.get(path)!.push(agent)
    })

    return Array.from(projectMap.entries()).map(([path, agents]) => ({
      name: path.split('/').pop() || 'Project',
      path,
      agents
    }))
  }, [agents])

  // 레이아웃 계산 (render와 hover에서 공유)
  const layout = useMemo(() => getRoomLayout(projectRooms.length), [projectRooms.length])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const animate = () => {
      frameRef.current++

      // 배경
      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight)

      if (projectRooms.length === 0) {
        renderEmptyOffice(ctx, layout.canvasWidth, layout.canvasHeight)
      } else {
        // 각 프로젝트 방 렌더링 (layout helper 사용)
        projectRooms.forEach((room, index) => {
          const pos = layout.getRoomPosition(index)
          renderRoom(ctx, room, pos.x, pos.y, ROOM_WIDTH, ROOM_HEIGHT)
        })
      }

      animationFrameId.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [projectRooms, layout, selectedAgentId])

  const renderEmptyOffice = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) => {
    ctx.fillStyle = COLORS.floor
    ctx.fillRect(0, 0, width, height)

    const tileSize = 32
    for (let y = 0; y < height; y += tileSize) {
      for (let x = 0; x < width; x += tileSize) {
        ctx.fillStyle = ((x / tileSize) + (y / tileSize)) % 2 === 0 ? COLORS.floor : COLORS.floorAlt
        ctx.fillRect(x, y, tileSize, tileSize)
      }
    }

    ctx.fillStyle = COLORS.wall
    ctx.fillRect(0, 0, width, 72)
    ctx.fillStyle = COLORS.wallTop
    ctx.fillRect(0, 0, width, 8)

    // 빈 책상 배치
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 5; col++) {
        const deskX = 120 + col * 142
        const deskY = 150 + row * 118
        ctx.fillStyle = COLORS.desk
        ctx.fillRect(deskX, deskY + 20, 70, 28)
        ctx.fillStyle = COLORS.deskTop
        ctx.fillRect(deskX - 4, deskY + 14, 78, 10)
        ctx.fillStyle = COLORS.monitor
        ctx.fillRect(deskX + 24, deskY, 22, 16)
        ctx.fillStyle = '#273348'
        ctx.fillRect(deskX + 27, deskY + 3, 16, 10)
      }
    }

    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('감시 대기 중', width / 2, height - 130)

    ctx.fillStyle = COLORS.textDim
    ctx.font = '15px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.fillText('Claude Code 세션이 시작되면 직원이 이 운영실에 배치됩니다.', width / 2, height - 102)
  }

  const renderRoom = (
    ctx: CanvasRenderingContext2D,
    room: ProjectRoom,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    const frame = frameRef.current

    // 방 배경 (바닥)
    ctx.fillStyle = COLORS.floor
    ctx.fillRect(x, y, width, height)

    // 체크무늬 바닥
    const tileSize = 20
    for (let ty = 0; ty < height; ty += tileSize) {
      for (let tx = 0; tx < width; tx += tileSize) {
        if ((Math.floor(tx / tileSize) + Math.floor(ty / tileSize)) % 2 === 0) {
          ctx.fillStyle = COLORS.floorAlt
          ctx.fillRect(x + tx, y + ty, tileSize, tileSize)
        }
      }
    }

    // 벽 (상단)
    const wallHeight = 40
    ctx.fillStyle = COLORS.wall
    ctx.fillRect(x, y, width, wallHeight)

    // 벽 상단 테두리
    ctx.fillStyle = COLORS.wallTop
    ctx.fillRect(x, y, width, 5)

    // 창문
    const windowWidth = 60
    const windowHeight = 25
    const windowY = y + 10
    for (let i = 0; i < 3; i++) {
      const windowX = x + 40 + i * 120
      ctx.fillStyle = '#87CEEB'
      ctx.fillRect(windowX, windowY, windowWidth, windowHeight)
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.strokeRect(windowX, windowY, windowWidth, windowHeight)
      // 창문 십자
      ctx.beginPath()
      ctx.moveTo(windowX + windowWidth / 2, windowY)
      ctx.lineTo(windowX + windowWidth / 2, windowY + windowHeight)
      ctx.moveTo(windowX, windowY + windowHeight / 2)
      ctx.lineTo(windowX + windowWidth, windowY + windowHeight / 2)
      ctx.stroke()
    }

    // 프로젝트 이름
    ctx.fillStyle = COLORS.text
    ctx.font = 'bold 14px "Courier New", monospace'
    ctx.textAlign = 'left'
    const displayName = room.name.length > 25 ? room.name.slice(0, 22) + '...' : room.name
    ctx.fillText(`📁 ${displayName}`, x + 10, y + height - 10)

    // 에이전트 수
    ctx.fillStyle = COLORS.textDim
    ctx.font = '12px "Courier New", monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${room.agents.length} agents`, x + width - 10, y + height - 10)

    // 가구 렌더링
    renderFurniture(ctx, x, y + wallHeight, width, height - wallHeight - 25)

    // 에이전트 렌더링
    room.agents.forEach((agent, index) => {
      const agentX = x + 60 + (index % 4) * 80
      const agentY = y + wallHeight + 40 + Math.floor(index / 4) * 70
      renderAgent(ctx, agent, agentX, agentY, frame)
    })
  }

  const renderFurniture = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    // 책상들 (상단)
    for (let i = 0; i < 4; i++) {
      const deskX = x + 30 + i * 90
      const deskY = y + 20

      // 책상
      ctx.fillStyle = COLORS.desk
      ctx.fillRect(deskX, deskY + 15, 50, 20)
      ctx.fillStyle = COLORS.deskTop
      ctx.fillRect(deskX, deskY + 10, 50, 8)

      // 모니터
      ctx.fillStyle = COLORS.monitor
      ctx.fillRect(deskX + 15, deskY, 20, 15)
      ctx.fillStyle = COLORS.monitorScreen
      ctx.fillRect(deskX + 17, deskY + 2, 16, 10)
    }

    // 화분
    ctx.fillStyle = COLORS.plantPot
    ctx.fillRect(x + width - 40, y + height - 40, 25, 20)
    ctx.fillStyle = COLORS.plant
    ctx.beginPath()
    ctx.arc(x + width - 27, y + height - 50, 15, 0, Math.PI * 2)
    ctx.fill()
  }

  const renderAgent = (
    ctx: CanvasRenderingContext2D,
    agent: Agent,
    x: number,
    y: number,
    frame: number
  ) => {
    const bounce = Math.sin(frame * 0.1 + x) * 2
    const agentY = y + bounce

    // 상태 색상 (stale이면 회색)
    const statusColor = agent.isStale ? '#6a6a7a'
      : agent.status === 'working' ? COLORS.working
      : agent.status === 'idle' ? COLORS.idle
      : COLORS.waiting

    // Stale 상태면 전체 반투명
    const opacity = agent.isStale ? 0.4 : 1.0
    ctx.globalAlpha = opacity

    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath()
    ctx.ellipse(x, y + 25, 12, 4, 0, 0, Math.PI * 2)
    ctx.fill()

    // 몸통
    ctx.fillStyle = statusColor
    ctx.fillRect(x - 8, agentY, 16, 20)

    // 머리
    ctx.fillStyle = '#FFE0BD'
    ctx.beginPath()
    ctx.arc(x, agentY - 8, 10, 0, Math.PI * 2)
    ctx.fill()

    // 눈
    const blinkPhase = Math.floor(frame / 30) % 10
    if (blinkPhase !== 0) {
      ctx.fillStyle = '#333'
      ctx.beginPath()
      ctx.arc(x - 3, agentY - 9, 2, 0, Math.PI * 2)
      ctx.arc(x + 3, agentY - 9, 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = '#333'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x - 5, agentY - 9)
      ctx.lineTo(x - 1, agentY - 9)
      ctx.moveTo(x + 1, agentY - 9)
      ctx.lineTo(x + 5, agentY - 9)
      ctx.stroke()
    }

    // 상태 표시 (머리 위 점)
    ctx.fillStyle = statusColor
    ctx.beginPath()
    ctx.arc(x, agentY - 22, 4, 0, Math.PI * 2)
    ctx.fill()

    // 상태 점 발광 효과
    ctx.fillStyle = statusColor + '44'
    ctx.beginPath()
    ctx.arc(x, agentY - 22, 7, 0, Math.PI * 2)
    ctx.fill()

    // working 상태면 타이핑 애니메이션
    if (agent.status === 'working') {
      const typingPhase = Math.floor(frame / 5) % 3
      ctx.fillStyle = '#333'
      ctx.fillRect(x - 10 + typingPhase * 4, agentY + 12, 3, 3)
    }

    if (agent.id === selectedAgentId) {
      ctx.strokeStyle = '#7fdccf'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, agentY + 2, 25, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Reset opacity
    ctx.globalAlpha = 1.0
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (canvas.width / rect.width)
    const y = (e.clientY - rect.top) * (canvas.height / rect.height)

    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })

    // 에이전트 호버 감지 (layout helper 사용 - render와 동일한 좌표)
    let found: Agent | null = null
    projectRooms.forEach((room, roomIndex) => {
      const roomPos = layout.getRoomPosition(roomIndex)

      room.agents.forEach((agent, index) => {
        // renderRoom 내부의 에이전트 위치와 동일한 계산
        const agentX = roomPos.x + 60 + (index % 4) * 80
        const agentY = roomPos.y + 40 + 40 + Math.floor(index / 4) * 70

        const dist = Math.sqrt((x - agentX) ** 2 + (y - agentY) ** 2)
        if (dist < 20) {
          found = agent
        }
      })
    })

    setHoveredAgent(found)
  }

  const handleClick = () => {
    if (hoveredAgent && onSelectAgent) {
      onSelectAgent(hoveredAgent.id)
    }
  }

  return (
    <div className="pixel-office">
      <canvas
        ref={canvasRef}
        width={layout.canvasWidth}
        height={layout.canvasHeight}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={() => setHoveredAgent(null)}
        className="office-canvas"
      />

      {/* 범례 */}
      <div className="office-legend">
        <span className="legend-item">
          <span className="legend-dot working"></span> Working
        </span>
        <span className="legend-item">
          <span className="legend-dot idle"></span> Idle
        </span>
        <span className="legend-item">
          <span className="legend-dot waiting"></span> Waiting
        </span>
      </div>

      {hoveredAgent && (
        <div
          className="agent-tooltip"
          style={{ left: mousePos.x + 15, top: mousePos.y - 10 }}
        >
          <div className="tooltip-header">
            <span className={`tooltip-status ${hoveredAgent.status}`}>●</span>
            <span className="tooltip-name">{hoveredAgent.name}</span>
            <span className={`tooltip-type ${hoveredAgent.agentType || 'main'}`}>
              {hoveredAgent.agentType === 'sub' ? 'SUB' : 'MAIN'}
            </span>
          </div>
          {hoveredAgent.currentTask && (
            <div className="tooltip-task">{hoveredAgent.currentTask}</div>
          )}
          <div className="tooltip-stats">
            <span>In: {(hoveredAgent.tokens.input / 1000).toFixed(1)}k</span>
            <span>Out: {(hoveredAgent.tokens.output / 1000).toFixed(1)}k</span>
            <span>${hoveredAgent.cost.toFixed(4)}</span>
          </div>
          {hoveredAgent.recentTools && hoveredAgent.recentTools.length > 0 && (
            <div className="tooltip-tools">
              {hoveredAgent.recentTools.slice(-4).map((tool, i) => (
                <span key={i} className="tooltip-tool">{tool}</span>
              ))}
            </div>
          )}
          {hoveredAgent.recentActivity && hoveredAgent.recentActivity.length > 0 && (
            <div className="tooltip-activity">
              {hoveredAgent.recentActivity.slice(-3).reverse().map((act, i) => (
                <div key={i} className="tooltip-activity-item">{act.summary}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
