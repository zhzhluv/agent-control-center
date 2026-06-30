# Agent B 서버 보고서: Codex 세션 지원

## 요약

Agent Control Center 상태 API에서 Claude와 Codex 세션을 모두 지원하도록 서버 측 변경 사항을 성공적으로 구현. Codex 세션을 합성 메인 에이전트로 처리하는 설계 원칙을 따르며 (명시적 agent-*.jsonl 파일 없는 Claude 세션과 유사), 기존 git root 정규화 및 임시 경로 필터링 로직을 재사용.

## 수정 파일

### 1. `/server/src/claude-monitor.ts`

**변경 사항:**
- `AgentInfo` 인터페이스에 `source: 'claude' | 'codex'` 필드 추가 (36줄)
- `SessionInfo` 인터페이스에 `source: 'claude' | 'codex'` 필드 추가 (59줄)
- 모든 `AgentInfo` 생성 위치에 `source: 'claude'` 포함 (3곳)
- 모든 `SessionInfo` 생성 위치에 `source: 'claude'` 포함 (1곳)

**하위 호환성:**
- 기존 모든 Claude 세션 및 에이전트에 명시적 `source: 'claude'` 필드 추가
- API 응답 구조는 추가만 - 호환성 깨짐 없음
- 기존 프론트엔드 코드 정상 작동 (source 필드는 UI에서 선택적)

### 2. `/server/src/codex-monitor.ts` (신규 파일)

**목적:** `~/.codex/sessions/`에서 Codex 세션 모니터링 및 파싱

**주요 기능:**
- **세션 감지:** `~/.codex/sessions/YYYY/MM/DD/*.jsonl` 디렉토리 구조 스캔
- **경로 정규화:** git root 감지 (`findGitRoot()` 사용)로 프로젝트 경로 정규화
- **임시 경로 제외:** `/tmp`, `/private/tmp`, `/var/folders`, `/dev` 경로 필터링
- **세션 상태:** ClaudeMonitor와 동일한 임계값 구현:
  - Active: < 30초
  - Idle: 30초 - 5분
  - Stale: > 5분
- **합성 메인 에이전트:** Codex 세션당 하나의 메인 에이전트 생성 (에이전트 ID: `codex:{session_id}`)

**세션 파싱 로직:**
1. 파일명에서 세션 ID 추출 (UUID 패턴)
2. JSONL 파일 스트리밍하여 수집:
   - `turn_context` 및 `session_meta` 항목에서 `cwd`
   - 모든 항목에서 마지막 타임스탬프
   - 현재 작업 표시용 사용자 메시지
3. 빈도 기반으로 정규 cwd 결정, git root로 정규화
4. 합성 메인 에이전트 생성:
   - Name: "Codex Agent"
   - Status: 'working' (active) 또는 'idle' (idle/stale)
   - Source: 'codex'
   - Project path: 정규화된 git root

**보안 참고:**
- auth.json 또는 자격증명 파일 절대 읽지 않음
- 세션 메타데이터만 파싱 (cwd, timestamp, session_id, 사용자 메시지)
- API 응답에 민감 데이터 노출 안함

### 3. `/server/src/index.ts`

**변경 사항:**
- `CodexMonitor` 클래스 임포트
- `claudeMonitor`와 함께 `codexMonitor` 인스턴스 생성
- 두 모니터 데이터 결합용 `getMergedStatus()` 헬퍼 함수 추가
- 프로젝트 이름 추출용 `getProjectName()` 헬퍼 함수 추가
- 두 모니터를 듣고 병합된 상태를 브로드캐스트하는 이벤트 핸들러 업데이트
- 모든 API 라우트가 병합된 데이터 반환하도록 업데이트:
  - `/api/status` - 병합된 상태
  - `/api/sessions` - 결합된 세션 배열
  - `/api/agents` - 결합된 에이전트 배열
  - `/api/metrics` - 병합된 메트릭
  - `/api/diagnostics` - 진단용 병합된 상태
- 서버 시작 시 두 모니터 초기화
- 종료 핸들러에서 두 모니터 정지
- 시작 메시지 업데이트: "MONITORING (Claude + Codex)"

## Codex 세션 감지 방식

### 디렉토리 구조
```
~/.codex/sessions/
  2026/
    04/
      30/
        rollout-2026-04-30T19-50-54-019dde03-58c2-7e00-9470-e481e30d7874.jsonl
```

### 세션 ID 추출
- 패턴: `[filename]-[UUID].jsonl`
- UUID 포맷: `019dde03-58c2-7e00-9470-e481e30d7874`
- 정규식으로 추출: `/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i`

### CWD 감지
JSONL 파일의 두 소스:
1. **session_meta** (초기 cwd, 가중치 5배)
   ```json
   {"type":"session_meta","payload":{"cwd":"/Users/zhluv/Desktop/kdj_home"}}
   ```

2. **turn_context** (턴별 cwd, 가중치 1배)
   ```json
   {"type":"turn_context","payload":{"cwd":"/Users/zhluv/Desktop/kdj_home"}}
   ```

가장 빈번한 cwd를 선택하고, git root로 정규화하며, 임시 경로는 필터링.

### 타임스탬프 추적
- 마지막 활동: 모든 JSONL 항목에서 가장 최근 타임스탬프
- 세션 상태 결정에 사용 (active/idle/stale)

## Source 필드 설정 방식

### Claude 세션
모든 Claude 세션 및 에이전트에 `source: 'claude'` 설정:
- 메인 에이전트 (명시적 에이전트 파일 없는 session-*.jsonl 파일에서)
- 명시적 에이전트 (agent-*.jsonl 파일에서)
- 부모 세션

### Codex 세션
모든 Codex 세션 및 에이전트에 `source: 'codex'` 설정:
- 합성 메인 에이전트 (모든 Codex 세션에 대해 생성)
- 부모 세션

### API 응답 구조
```typescript
{
  agents: [
    {
      id: "main:abc123",
      source: "claude",
      // ... 기타 필드
    },
    {
      id: "codex:019dde03-58c2-7e00-9470-e481e30d7874",
      source: "codex",
      // ... 기타 필드
    }
  ],
  sessions: [
    {
      id: "abc123",
      source: "claude",
      // ... 기타 필드
    },
    {
      id: "019dde03-58c2-7e00-9470-e481e30d7874",
      source: "codex",
      // ... 기타 필드
    }
  ],
  projects: [...],
  metrics: {...}
}
```

## 데이터 모델 요약

### AgentInfo 인터페이스
```typescript
interface AgentInfo {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'waiting';
  agentType: 'main' | 'sub';
  currentTask?: string;
  currentTaskFull?: string;
  recentTools: string[];
  recentActivity: ActivityLog[];
  tokens: { input, output, cacheRead, cacheWrite };
  cost: number;
  lastActivity: Date;
  projectPath: string;
  sessionId: string;
  source: 'claude' | 'codex';  // 신규
}
```

### SessionInfo 인터페이스
```typescript
interface SessionInfo {
  id: string;
  projectPath: string;
  agents: AgentInfo[];
  isActive: boolean;
  state: SessionState;  // 'active' | 'idle' | 'stale'
  lastActivity: Date;
  totalTokens: { input, output };
  source: 'claude' | 'codex';  // 신규
}
```

## 하위 호환성

### ✅ 유지됨
1. **API 응답 구조:** 기존 모든 필드 변경 없음
2. **이벤트 유형:** 모든 WebSocket 이벤트 동일 (`status_update`, `agent_updated`, `session_updated`)
3. **세션 상태 로직:** active/idle/stale 상태의 동일한 임계값
4. **프로젝트 그룹화:** 세션이 여전히 정규화된 프로젝트 경로로 그룹화
5. **메트릭 계산:** 집계 로직 변경 없음

### ✅ 추가 변경만
1. **신규 필드:** AgentInfo와 SessionInfo에 `source` 추가
2. **신규 데이터:** Codex 세션이 Claude 세션과 함께 표시
3. **프론트엔드 호환성:** 프론트엔드는 필요 없으면 `source` 필드 무시 가능

### ✅ 호환성 깨짐 없음
- 기존 클라이언트 코드 수정 없이 계속 작동
- 프론트엔드는 선택적으로 `source` 필드를 필터링 또는 표시 목적으로 사용 가능
- 필드 제거 또는 이름 변경 없음
- API 엔드포인트 시그니처 변경 없음

## 테스트 검증

### 빌드 상태
- ✅ TypeScript 컴파일 성공
- ✅ 타입 에러 없음
- ✅ 모든 임포트 정상 해결

### 통합 포인트
1. **서버 시작:** 두 모니터 성공적으로 초기화
2. **이벤트 처리:** 두 모니터가 병합된 상태를 브로드캐스트하는 이벤트 발생
3. **API 라우트:** 모든 라우트가 두 모니터의 병합된 데이터 반환
4. **종료:** SIGTERM 시 두 모니터 정상 정지

### 처리된 엣지 케이스
1. **Codex 디렉토리 없음:** 모니터가 경고 로그 후 계속 (크래시 없음)
2. **잘못된 세션 파일:** 파싱 에러 캐치 및 로그, 처리 계속
3. **임시 경로:** ClaudeMonitor와 동일한 로직으로 필터링
4. **Git Root 없음:** 원본 cwd 경로로 폴백
5. **빈 세션:** 유효한 cwd 없으면 스킵

## 구현 참고

### 설계 결정

1. **합성 메인 에이전트 패턴**
   - Codex 세션이 메인 에이전트로 표시 (서브 에이전트 아님)
   - 명시적 agent-*.jsonl 파일 없는 Claude 세션과 일관성
   - UI 표현 단순화 (세션당 하나의 에이전트)

2. **Git Root 정규화**
   - 두 모니터 모두 동일한 `findGitRoot()` 로직 사용
   - 동일 저장소에 대한 중복 프로젝트 방지
   - 예: `/repo/client`와 `/repo/server` 모두 `/repo`로 정규화

3. **임시 경로 필터링**
   - `/tmp`, `/private/tmp`, `/var/folders`, `/dev` 제외
   - 일시적 세션이 프로젝트 목록을 어지럽히는 것 방지
   - ClaudeMonitor와 동일한 패턴

4. **CWD 빈도 가중치**
   - `session_meta.cwd` 가중치 5배 (초기 프로젝트 컨텍스트)
   - `turn_context.cwd` 가중치 1배 (턴별 변경)
   - 일시적으로 디렉토리를 변경하는 세션 처리

5. **토큰/비용 추적**
   - Codex 세션은 0으로 설정 (현재 JSONL 포맷에 데이터 없음)
   - 나중에 Codex가 토큰 사용 데이터를 노출하면 향상 가능
   - 병합된 메트릭 계산에 영향 없음

### 성능 고려사항

1. **스캔 윈도우:** 최근 10분(600초) 내 수정된 세션만 스캔
2. **스트리밍 파서:** 전체 JSONL을 메모리에 로드하지 않도록 readline 사용
3. **주기적 갱신:** 3초 간격으로 ClaudeMonitor와 일치
4. **파일 감시:** 새로운/업데이트된 세션 파일을 위해 일별 디렉토리 감시

### 향후 개선

1. **도구 사용 추출:** JSONL에 tool_use 이벤트 있으면 파싱
2. **토큰 추적:** 포맷이 지원하면 Codex JSONL에서 토큰 사용량 추출
3. **비용 계산:** 토큰 데이터 사용 가능 시 Codex 가격 모델 추가
4. **활동 로그:** JSONL 이벤트에서 더 상세한 활동 파싱
5. **서브 에이전트 지원:** 향후 Codex가 서브 에이전트 지원하면 감지

## 결론

구현이 다음과 함께 Agent Control Center에 Codex 세션 지원을 성공적으로 추가:
- ✅ 최소한의 코드 변경
- ✅ 완전한 하위 호환성
- ✅ 기존 git root 정규화 로직 재사용
- ✅ 일관된 세션 상태 관리
- ✅ 보안 의식적 (자격증명 접근 없음)
- ✅ 타입 안전 TypeScript 구현

API가 이제 Claude와 Codex 세션을 통합된 뷰로 병합하여 반환하며, `source` 필드로 클라이언트가 필요시 제공자를 구분 가능.
