# Agent A - 검수 처리 상태 설계 및 서버 구현 보고서

**작업 일시**: 2026-07-01
**담당**: Agent A
**목표**: needsReview 후보에 대한 운영자 처리 상태 설계 및 서버 메모리 기반 구현

---

## 1. 현재 서버 구조 분석

### 1.1 AgentInfo 인터페이스 (server/src/claude-monitor.ts)

기존 needsReview 관련 필드:
```typescript
export interface AgentInfo {
  // ... 기본 필드들
  needsReview: boolean;                // 검수 필요 후보 여부
  reviewCandidateAt?: string;          // ISO 타임스탬프
  reviewReason?: string;               // 후보 판단 이유
}
```

### 1.2 모니터링 아키텍처

- **ClaudeMonitor**: `~/.claude/projects/` 디렉토리의 JSONL 파일 감시
- **CodexMonitor**: `~/.codex/sessions/` 디렉토리의 JSONL 파일 감시
- **읽기 전용 정책**: 에이전트 세션 파일에 절대 쓰지 않음
- **메모리 기반**: 모든 상태는 서버 메모리의 `Map<string, AgentInfo>`에 저장
- **WebSocket 브로드캐스트**: 상태 변경 시 연결된 모든 클라이언트에 실시간 전파

### 1.3 needsReview 자동 설정 로직

`checkActiveSessions()` 메서드에서 3초마다 실행:
1. agent.status가 'idle'인지 확인
2. checkNeedsReview() 호출하여 후보 여부 판단
3. needsReview가 true로 변경되면:
   - `reviewCandidateAt`: 현재 ISO 타임스탬프
   - `reviewReason`: 판단 이유
4. 새 user message/tool_use 발생 시 자동 해제

---

## 2. 상태 설계

### 2.1 reviewState 필드 추가

```typescript
export interface AgentInfo {
  // ... 기존 필드들
  needsReview: boolean;
  reviewCandidateAt?: string;
  reviewReason?: string;
  reviewState?: 'pending' | 'acknowledged' | 'copied' | 'dismissed';  // 신규
}
```

### 2.2 상태 전이 다이어그램

```
needsReview === false
        │
        │ (idle 30초 이상, 마지막 작업 성공)
        ↓
needsReview === true
reviewState === 'pending'
        │
        ├─→ 'acknowledged'  (운영자가 확인함)
        ├─→ 'copied'        (운영자가 복사/저장함)
        ├─→ 'dismissed'     (운영자가 무시함)
        │
        │ (새 user message 또는 tool_use 발생)
        ↓
needsReview === false
reviewState === undefined
```

### 2.3 상태 의미

- **pending**: 검수 필요 후보로 표시되었으나 운영자가 아직 확인하지 않음 (초기값)
- **acknowledged**: 운영자가 확인했음 (향후 추가 작업 예정)
- **copied**: 운영자가 내용을 복사/저장했음 (작업 완료)
- **dismissed**: 운영자가 검수 불필요로 판단하여 무시함

### 2.4 서버 메모리 저장 선택 근거

**클라이언트 localStorage 대신 서버 메모리를 선택한 이유**:

1. **여러 클라이언트 간 동기화**
   - 여러 브라우저 탭/창에서 동일한 상태 공유
   - 모바일/데스크톱에서 일관된 뷰

2. **WebSocket 실시간 브로드캐스트**
   - 기존 `agent_updated` 이벤트 활용
   - 한 클라이언트의 상태 변경이 즉시 모든 클라이언트에 반영

3. **읽기 전용 정책 준수**
   - Claude/Codex 세션 파일에 쓰지 않음
   - Agent Control Center 내부 상태만 관리

4. **단순한 구현**
   - 기존 AgentInfo Map 활용
   - 추가 영속성 레이어 불필요

**제약사항**:
- 서버 재시작 시 reviewState 초기화됨 (needsReview는 파일 기반으로 재계산되므로 유지)
- 이는 의도된 동작: reviewState는 일시적 운영 상태이며, 영구 저장 불필요

---

## 3. 구현 상세

### 3.1 코드 변경 사항

#### A. AgentInfo 인터페이스 확장
**파일**: `/Users/zhluv/Projects/agent-control-center/server/src/claude-monitor.ts`

```typescript
export interface AgentInfo {
  // ... 기존 필드
  reviewState?: 'pending' | 'acknowledged' | 'copied' | 'dismissed';
}
```

#### B. needsReview 설정 시 reviewState 초기화
**파일**: `server/src/claude-monitor.ts`, `server/src/codex-monitor.ts`

```typescript
// checkActiveSessions() 내부
if (reviewCheck.needsReview && !agent.needsReview) {
  agent.needsReview = true;
  agent.reviewCandidateAt = new Date().toISOString();
  agent.reviewReason = reviewCheck.reason;
  agent.reviewState = 'pending';  // 신규 추가
  reviewStatusChanged = true;
}
```

#### C. needsReview 해제 시 reviewState 초기화
```typescript
else if (!reviewCheck.needsReview && agent.needsReview) {
  agent.needsReview = false;
  agent.reviewCandidateAt = undefined;
  agent.reviewReason = undefined;
  agent.reviewState = undefined;  // 신규 추가
  reviewStatusChanged = true;
}
```

#### D. updateReviewState() 메서드 추가
**파일**: `server/src/claude-monitor.ts`, `server/src/codex-monitor.ts`

```typescript
/**
 * Update review state for an agent
 * This is called by the REST API when an operator changes the review state
 */
updateReviewState(
  agentId: string,
  reviewState: 'pending' | 'acknowledged' | 'copied' | 'dismissed'
): boolean {
  const agent = this.agents.get(agentId);

  if (!agent) {
    return false;
  }

  // Only update if the agent is in needsReview state
  if (!agent.needsReview) {
    return false;
  }

  agent.reviewState = reviewState;
  this.emit('agent_updated', agent);

  return true;
}
```

#### E. REST API 엔드포인트 추가
**파일**: `/Users/zhluv/Projects/agent-control-center/server/src/index.ts`

```typescript
// POST /api/agents/:id/review-state
app.post('/api/agents/:id/review-state', auth.verify, (req, res) => {
  const agentId = req.params.id;
  const { state } = req.body;

  // Validate state
  const validStates = ['pending', 'acknowledged', 'copied', 'dismissed'];
  if (!state || !validStates.includes(state)) {
    return res.status(400).json({
      error: 'Invalid state',
      message: 'State must be one of: pending, acknowledged, copied, dismissed'
    });
  }

  // Determine if this is a Claude or Codex agent
  const isCodexAgent = agentId.startsWith('codex:');
  const monitor = isCodexAgent ? codexMonitor : claudeMonitor;

  // Update the review state
  const success = monitor.updateReviewState(agentId, state);

  if (!success) {
    return res.status(404).json({
      error: 'Agent not found or not in review state',
      message: 'Cannot update review state for this agent'
    });
  }

  res.json({
    success: true,
    agentId,
    reviewState: state
  });
});
```

### 3.2 변경된 파일 목록

1. `/Users/zhluv/Projects/agent-control-center/server/src/claude-monitor.ts`
   - AgentInfo 인터페이스에 `reviewState` 필드 추가
   - needsReview 설정/해제 시 reviewState 초기화 로직 추가
   - `updateReviewState()` 메서드 추가
   - 3곳의 AgentInfo 객체 생성에 reviewState 보존 로직 추가

2. `/Users/zhluv/Projects/agent-control-center/server/src/codex-monitor.ts`
   - needsReview 설정/해제 시 reviewState 초기화 로직 추가
   - `updateReviewState()` 메서드 추가
   - AgentInfo 객체 생성에 reviewState 보존 로직 추가

3. `/Users/zhluv/Projects/agent-control-center/server/src/index.ts`
   - `POST /api/agents/:id/review-state` 엔드포인트 추가

---

## 4. API 엔드포인트 설명

### POST /api/agents/:id/review-state

**인증**: 필수 (Authorization: Bearer TOKEN)

**요청**:
```http
POST /api/agents/:id/review-state
Content-Type: application/json
Authorization: Bearer <AUTH_TOKEN>

{
  "state": "acknowledged" | "copied" | "dismissed"
}
```

**응답**:

성공 (200):
```json
{
  "success": true,
  "agentId": "agent-xxx",
  "reviewState": "acknowledged"
}
```

실패 - 잘못된 상태 (400):
```json
{
  "error": "Invalid state",
  "message": "State must be one of: pending, acknowledged, copied, dismissed"
}
```

실패 - 에이전트 없음 또는 needsReview가 아님 (404):
```json
{
  "error": "Agent not found or not in review state",
  "message": "Cannot update review state for this agent"
}
```

**특징**:
- Claude/Codex 에이전트 자동 구분 (ID prefix 기반)
- needsReview === true인 에이전트만 상태 변경 가능
- 상태 변경 시 WebSocket으로 모든 클라이언트에 `agent_updated` 이벤트 브로드캐스트

---

## 5. 보안 고려사항

### 5.1 읽기 전용 정책 준수

- **Claude/Codex 로그 파일**: 절대 쓰지 않음 (모니터링만)
- **서버 메모리**: AgentInfo Map에만 상태 저장
- **파일 생성**: Agent Control Center 내부 상태 관리용으로만 사용

### 5.2 API 인증

- **인증 미들웨어**: `auth.verify` 사용
- **프로덕션**: `AUTH_TOKEN` 환경변수 필수
- **개발**: 임시 토큰 자동 생성 (/tmp/agent-control-center-token)

### 5.3 입력 검증

- **상태값 검증**: 4가지 허용된 값만 수용
- **에이전트 존재 확인**: 존재하지 않는 ID 거부
- **needsReview 확인**: needsReview가 false인 경우 상태 변경 거부

---

## 6. 테스트 가이드

### 6.1 수동 테스트 시나리오

1. **needsReview 후보 생성**
   - Claude Code에서 간단한 작업 실행 (예: `ls`)
   - 30초 이상 대기
   - UI에서 에이전트가 needsReview: true, reviewState: 'pending'로 표시되는지 확인

2. **상태 변경 테스트**
   ```bash
   curl -X POST http://localhost:9876/api/agents/AGENT_ID/review-state \
     -H "Authorization: Bearer <TEST_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"state": "acknowledged"}'
   ```

3. **실시간 브로드캐스트 확인**
   - 두 개의 브라우저 탭에서 UI 열기
   - 한 탭에서 상태 변경
   - 다른 탭에서 즉시 반영되는지 확인

4. **자동 해제 확인**
   - needsReview 상태인 에이전트에 새 명령 입력
   - needsReview와 reviewState가 모두 초기화되는지 확인

### 6.2 엣지 케이스

- **존재하지 않는 에이전트**: 404 에러 반환 확인
- **잘못된 상태값**: 400 에러 반환 확인
- **needsReview가 false인 에이전트**: 404 에러 반환 확인
- **서버 재시작**: reviewState는 초기화되지만 needsReview는 재계산됨

---

## 7. 향후 확장 가능성

### 7.1 영속성 추가 (선택적)

현재는 서버 메모리 기반이지만, 필요시 다음 방법으로 영속성 추가 가능:

1. **SQLite 데이터베이스**
   ```sql
   CREATE TABLE review_states (
     agent_id TEXT PRIMARY KEY,
     review_state TEXT,
     updated_at TIMESTAMP
   );
   ```

2. **JSON 파일**
   ```
   .agents/review-states.json
   ```

3. **Redis** (다중 서버 환경)

### 7.2 감사 로그 (Audit Log)

운영자 작업 추적:
```typescript
interface ReviewAuditLog {
  agentId: string;
  previousState: string;
  newState: string;
  operator?: string;  // 운영자 식별
  timestamp: string;
}
```

### 7.3 자동 정리 (Cleanup)

오래된 needsReview 항목 자동 정리:
- reviewState === 'dismissed'이고 24시간 경과 시 needsReview 해제
- reviewState === 'copied'이고 1시간 경과 시 needsReview 해제

---

## 8. 결론

### 8.1 구현 완료 사항

- AgentInfo 인터페이스에 reviewState 필드 추가
- needsReview 설정/해제 시 reviewState 자동 관리
- REST API 엔드포인트로 상태 변경 기능 제공
- WebSocket 실시간 브로드캐스트로 모든 클라이언트 동기화
- 읽기 전용 정책 준수 및 보안 검증

### 8.2 핵심 설계 원칙 준수

1. **읽기 전용 관제 정책**: Claude/Codex 세션 파일에 절대 쓰지 않음
2. **서버 메모리 기반**: 간단하고 실시간 동기화가 용이
3. **자동 초기화**: 새 작업 시작 시 reviewState 자동 해제
4. **WebSocket 활용**: 기존 이벤트 시스템 재사용

### 8.3 다음 단계 (Agent B 담당)

- 클라이언트 UI 구현
- reviewState별 시각적 구분 (색상/아이콘)
- 상태 변경 버튼/액션
- 복사 기능 통합

---

**보고서 작성**: Agent A
**작성일**: 2026-07-01
**상태**: 서버 구현 완료, UI 구현 대기
