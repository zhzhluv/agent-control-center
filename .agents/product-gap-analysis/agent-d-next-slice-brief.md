# 다음 슬라이스 설계 브리프

## 슬라이스 명칭
**작업 완료 감지 + 검수 필요 상태 + 다음 지시 복사 버튼**

## 목표
에이전트가 작업을 완료했을 때 운영자가 즉시 알 수 있도록 하고, 검수 후 다음 지시를 빠르게 전달할 수 있도록 한다.

### 핵심 가치
1. **즉각적 인지**: 에이전트가 작업을 마치면 관제센터에 시각적으로 명확하게 표시
2. **빠른 전환**: 검수 완료 후 터미널로 돌아가 다음 지시를 붙여넣기만 하면 됨
3. **컨텍스트 보존**: 현재 작업 내용을 보면서 다음 작업 지시 준비 가능

### 실제 사용 시나리오
```
1. 에이전트가 작업 완료 → UI에 "검수 필요" 상태 표시
2. 운영자가 관제센터에서 결과물 확인 (코드, 로그, 보고서)
3. 다음 작업 지시를 입력창에 작성
4. "복사" 버튼 클릭 → 클립보드에 복사됨
5. 터미널로 돌아가서 Cmd+V 후 Enter
6. 에이전트가 다시 "작업 중" 상태로 전환
```

## 변경 범위

### 서버 (Agent A 담당)
#### 파일: `/server/src/claude-monitor.ts`
- **변경 사항**:
  - ActivityLog에서 에이전트 완료 "후보" 감지 로직 추가
  - 단일 조건이 아닌 복합 휴리스틱으로 "검수 필요 후보" 판단
  - 확정이 아닌 보수적 후보 상태로 시작

- **새 필드**: AgentInfo에 다음 필드 추가
  ```typescript
  export interface AgentInfo {
    // ... 기존 필드
    isCompletedWaiting?: boolean;  // 작업 완료 후 다음 지시 대기 중
    completedAt?: Date;             // 완료 시각
  }
  ```

- **감지 로직** (line 230-240 근처):
  ```typescript
  // "검수 필요 후보" 휴리스틱 (확정이 아닌 후보 판단)
  // 다음 조건을 모두 만족할 때만 후보로 판단:
  // 1. 마지막 assistant 메시지가 작업 마무리 보고 형태인지 확인
  // 2. 마지막 tool_result가 성공(is_error: false)인지 확인
  // 3. 이후 tool_use가 없는지 확인
  // 4. 일정 시간(예: 10초) 이상 추가 로그가 없는지 확인
  // 5. 최근 activity에 에러 result가 없는지 확인

  // 후보 해제 조건:
  // - 새 user 메시지가 생기면 즉시 해제
  // - 새 tool_use가 생기면 즉시 해제

  let lastToolResult: ActivityLog | null = null;
  let hasSubsequentToolUse = false;
  let hasRecentError = false;

  for (const activity of recentActivity) {
    if (activity.type === 'result' && activity.is_error) {
      hasRecentError = true;
    }
    if (activity.type === 'result' && !activity.is_error) {
      lastToolResult = activity;
    }
    if (lastToolResult && activity.timestamp > lastToolResult.timestamp
        && activity.type === 'tool_use') {
      hasSubsequentToolUse = true;
    }
  }

  // 보수적 판단: 에러 없고, 마지막 성공 result 후 추가 활동 없을 때만 후보
  const isReviewCandidate = lastToolResult && !hasSubsequentToolUse && !hasRecentError;
  const completedAt = isReviewCandidate ? new Date(lastToolResult.timestamp) : undefined;
  ```

  **주의**: 이 로직은 "검수 필요 후보"를 판단할 뿐, 실제 Claude/Codex의 승인 요청(Approval alerts)과는 다릅니다. 승인 요청은 에이전트가 명시적으로 사용자 승인을 기다리는 상태이고, 검수 필요 후보는 작업이 끝난 것으로 추정되어 운영자 확인이 필요한 상태입니다.

#### 파일: `/server/src/codex-monitor.ts`
- **변경 사항**: 동일한 필드 추가 (Codex도 완료 감지 가능하도록)
- **위치**: line 196-216 (mainAgent 생성 부분)

### 클라이언트 (Agent B 담당)

#### 파일: `/client/src/App.tsx`

##### 1. 타입 정의 추가 (line 14-28)
```typescript
interface Agent {
  // ... 기존 필드
  isCompletedWaiting?: boolean
  completedAt?: string  // ISO string (Date serialized)
}
```

##### 2. 상태 감지 함수 수정 (line 234-255)
```typescript
function getDerivedStatus(agent: Agent): DerivedStatus {
  // 최우선: 완료 대기 상태
  if (agent.isCompletedWaiting) {
    return 'needs_review'
  }

  // 기존 로직 유지
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
```

##### 3. Inspector 패널에 "다음 지시 입력" 섹션 추가 (line 928-1010)
```tsx
{selectedAgent?.isCompletedWaiting && (
  <div className="next-instruction-panel">
    <div className="panel-header">
      <h3>다음 지시 작성</h3>
      <small>
        완료 시각: {formatTime(selectedAgent.completedAt)}
      </small>
    </div>
    <textarea
      className="instruction-input"
      placeholder="다음 작업 지시를 입력하세요..."
      value={nextInstruction}
      onChange={(e) => setNextInstruction(e.target.value)}
      rows={6}
    />
    <div className="instruction-actions">
      <button
        className="primary"
        onClick={() => {
          if (nextInstruction.trim()) {
            navigator.clipboard.writeText(nextInstruction)
            setShowCopiedToast(true)
            setTimeout(() => setShowCopiedToast(false), 2000)
          }
        }}
        disabled={!nextInstruction.trim()}
      >
        📋 클립보드에 복사
      </button>
      <button
        className="secondary"
        onClick={() => setNextInstruction('')}
      >
        지우기
      </button>
    </div>
    {showCopiedToast && (
      <div className="toast-notification">
        ✓ 복사 완료! 터미널에 붙여넣으세요.
      </div>
    )}
  </div>
)}
```

##### 4. 상태 관리 추가 (line 370-373)
```typescript
const [nextInstruction, setNextInstruction] = useState('')
const [showCopiedToast, setShowCopiedToast] = useState(false)
```

#### 파일: `/client/src/App.css`

##### 스타일 추가 (파일 끝에 추가)
```css
/* Next Instruction Panel */
.next-instruction-panel {
  margin-top: 16px;
  padding: 16px;
  background: linear-gradient(135deg, #2a3f5f 0%, #1e2d3d 100%);
  border: 2px solid #4CAF50;
  border-radius: 8px;
}

.next-instruction-panel .panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.next-instruction-panel h3 {
  margin: 0;
  font-size: 15px;
  color: #4CAF50;
  font-weight: 600;
}

.next-instruction-panel small {
  color: #8fa3bf;
  font-size: 12px;
}

.instruction-input {
  width: 100%;
  padding: 12px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  background: #1a1a2e;
  border: 1px solid #3a4a5f;
  border-radius: 4px;
  color: #e0e0e0;
  resize: vertical;
  min-height: 120px;
}

.instruction-input:focus {
  outline: none;
  border-color: #4CAF50;
  box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.2);
}

.instruction-input::placeholder {
  color: #5a6a7f;
}

.instruction-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.instruction-actions button {
  flex: 1;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.instruction-actions button.primary {
  background: #4CAF50;
  color: white;
}

.instruction-actions button.primary:hover:not(:disabled) {
  background: #45a049;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(76, 175, 80, 0.3);
}

.instruction-actions button.primary:disabled {
  background: #2d4a2f;
  color: #5a7a5c;
  cursor: not-allowed;
}

.instruction-actions button.secondary {
  background: #3a4a5f;
  color: #b0c0d0;
}

.instruction-actions button.secondary:hover {
  background: #4a5a6f;
}

.toast-notification {
  margin-top: 12px;
  padding: 12px;
  background: #4CAF50;
  color: white;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  animation: slideInUp 0.3s ease;
}

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Derived status: needs_review */
.status-pill.derived.needs_review {
  background: #4CAF50;
  color: white;
  font-weight: 600;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.profile-dot.derived-needs_review {
  background: #4CAF50;
  box-shadow: 0 0 8px rgba(76, 175, 80, 0.6);
  animation: pulse 2s infinite;
}

.staff-row.derived-needs_review {
  background: linear-gradient(90deg, #1e2d3d 0%, #2a4a3d 100%);
  border-left: 3px solid #4CAF50;
}
```

#### 파일: `/client/src/components/PixelOffice.tsx`

##### 완료 대기 상태 시각화 (line 345-360)
```typescript
const renderAgent = (
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  x: number,
  y: number,
  frame: number
) => {
  const bounce = Math.sin(frame * 0.1 + x) * 2
  const agentY = y + bounce

  // 완료 대기 상태면 초록색 발광 효과
  const statusColor = agent.isCompletedWaiting ? '#4CAF50'
    : agent.isStale ? '#6a6a7a'
    : agent.status === 'working' ? COLORS.working
    : agent.status === 'idle' ? COLORS.idle
    : COLORS.waiting

  // 완료 대기 상태면 특별한 발광 효과
  if (agent.isCompletedWaiting) {
    ctx.fillStyle = 'rgba(76, 175, 80, 0.3)'
    ctx.beginPath()
    ctx.arc(x, agentY + 2, 30, 0, Math.PI * 2)
    ctx.fill()

    // 두 번째 레이어
    ctx.fillStyle = 'rgba(76, 175, 80, 0.2)'
    ctx.beginPath()
    ctx.arc(x, agentY + 2, 35, 0, Math.PI * 2)
    ctx.fill()
  }

  // ... 기존 렌더링 로직
}
```

## 구현 순서

### Phase 1: 서버 기반 감지 (Agent A - 2시간)
1. `claude-monitor.ts`에 완료 감지 로직 추가
   - `isCompletedWaiting`, `completedAt` 필드 추가
   - 마지막 tool_result 분석 로직 구현
   - 테스트: 실제 Claude Code 세션에서 작업 완료 후 상태 확인

2. `codex-monitor.ts`에 동일 로직 추가
   - Codex 세션에서도 완료 감지 가능하도록
   - 테스트: Codex 세션에서 완료 상태 확인

### Phase 2: 클라이언트 UI (Agent B - 3시간)
1. 타입 정의 및 상태 관리 추가
   - Agent 인터페이스 확장
   - `nextInstruction`, `showCopiedToast` 상태 추가

2. Inspector 패널에 입력 UI 추가
   - 텍스트 영역 + 복사 버튼
   - 토스트 알림 구현

3. 시각적 피드백 강화
   - 상태 배지 스타일링
   - PixelOffice에서 발광 효과
   - Staff Board에서 하이라이트

### Phase 3: 통합 테스트 (30분)
1. 실제 워크플로우 테스트
   - Claude Code로 작업 수행 → 완료 → 다음 지시 복사 → 새 작업 시작
   - Codex로 동일 테스트

2. 엣지 케이스 확인
   - 에러 발생 시 완료 상태 표시 안 됨 확인
   - 중간에 다른 도구 사용 시 완료 취소 확인
   - 여러 에이전트 동시 완료 시 각각 표시 확인

## 검증 체크리스트

### 서버
- [ ] 작업 완료 시 `isCompletedWaiting: true` 설정
- [ ] 완료 시각 `completedAt` 정확히 기록
- [ ] 새 사용자 메시지 수신 시 완료 상태 해제
- [ ] 에러 발생 시 완료 상태 설정 안 됨
- [ ] WebSocket으로 클라이언트에 즉시 전파

### 클라이언트
- [ ] 완료 대기 상태 에이전트에 "검수 필요" 배지 표시
- [ ] Inspector에 "다음 지시 작성" 패널 표시
- [ ] 텍스트 입력 후 복사 버튼 활성화
- [ ] 클립보드 복사 후 토스트 알림 2초간 표시
- [ ] PixelOffice에서 초록색 발광 효과 표시
- [ ] Staff Board에서 초록색 하이라이트 표시

### 통합
- [ ] 작업 완료 → 관제센터에서 1초 내 시각 변화 확인
- [ ] 다음 지시 복사 → 터미널 붙여넣기 → 정상 동작
- [ ] 여러 프로젝트 동시 완료 시 각각 표시
- [ ] 모바일 화면에서도 입력창 정상 동작

## 예상 소요 시간

- **Agent A (서버)**: 2시간
  - 완료 감지 로직: 1시간
  - Codex 지원: 30분
  - 테스트: 30분

- **Agent B (클라이언트)**: 3시간
  - 타입 및 상태: 30분
  - Inspector UI: 1.5시간
  - 시각 효과: 1시간

- **통합 테스트**: 30분

**총 예상**: 5.5시간 (여유 포함 하루 작업량)

## 성공 기준

### 사용성
- 에이전트가 작업 완료하면 3초 이내에 운영자가 인지 가능
- 다음 지시 복사까지 30초 이내 완료 가능
- 터미널 전환 없이 관제센터에서 모든 검수 가능

### 신뢰성
- 거짓 양성 없음 (에러나 중간 상태를 완료로 오인하지 않음)
- 거짓 음성 없음 (실제 완료를 놓치지 않음)
- 클립보드 복사 100% 성공률

### 확장성
- 향후 "자동 다음 작업 전송" 기능으로 확장 가능
- "완료 알림음" 옵션 추가 가능
- "작업 이력 저장" 기능 연결 가능

## 비고

### 왜 이 슬라이스인가?
1. **가장 큰 페인 포인트 해결**: "작업 끝났는지 확인하러 터미널 보기" 반복 제거
2. **즉시 효용**: 구현 즉시 일상 워크플로우가 크게 개선됨
3. **작고 검증 가능**: 5.5시간 내 완성 + 테스트 가능
4. **병렬 작업 가능**: 서버/클라이언트 독립적으로 개발 후 통합

### 대안으로 고려했던 것들
- **작업 이력 저장**: 유용하지만 즉각적 효용이 낮음
- **자동 다음 작업 전송**: 위험성(오작동 시 엉뚱한 지시 전송) > 편의성
- **Slack/Discord 알림**: 외부 의존성 증가, 관제센터 밖 기능

### 다음 슬라이스 후보
이 슬라이스 완료 후 자연스럽게 이어질 기능:
1. **작업 이력 저장 + 재사용**: 과거 지시 복사해서 재사용
2. **템플릿 관리**: 자주 쓰는 지시 템플릿화
3. **완료 알림 옵션**: 사운드, Slack, 이메일 등
