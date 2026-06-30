# Codex 세션 포맷 분석 보고서

**에이전트:** Agent A (Codex Session Support)
**날짜:** 2026-06-30
**작업:** Codex 세션 파일 구조 분석 및 Claude 세션 포맷과 비교

---

## 요약

Codex는 **이중 저장 아키텍처**를 사용:
1. **SQLite 데이터베이스** - 메타데이터 및 인덱싱
2. **JSONL 세션 파일** - 날짜 계층 구조로 상세 세션 기록 저장

세션 포맷은 세션 메타데이터, 턴 컨텍스트, 이벤트 메시지가 명확히 분리된 구조. 모든 민감한 자격증명은 `auth.json`에 별도 저장 (보안 요건상 검토하지 않음).

---

## 1. Codex 디렉토리 구조

### 1.1 최상위 구조

```
~/.codex/
├── auth.json                    [자격증명 파일 - 검토 대상 아님]
├── config.toml                  설정 파일
├── installation_id              고유 설치 식별자
├── session_index.jsonl          전역 세션 인덱스 (경량)
├── sessions/                    세션 저장소 (날짜별 구조)
│   └── 2026/
│       ├── 04/
│       ├── 05/
│       └── 06/
├── state_5.sqlite              메인 상태 데이터베이스
├── logs_2.sqlite               로깅 데이터베이스
├── goals_1.sqlite              목표 추적 데이터베이스
├── memories_1.sqlite           메모리 저장소
├── models_cache.json           모델 메타데이터 캐시
├── attachments/                첨부 파일
├── cache/                      일반 캐시
├── generated_images/           AI 생성 이미지
├── shell_snapshots/            셸 상태 스냅샷
├── skills/                     플러그인/스킬 저장소
└── tmp/                        임시 파일
```

### 1.2 데이터베이스 아키텍처

#### state_5.sqlite - 주 데이터베이스

**threads 테이블** (주요 세션 메타데이터):
```sql
CREATE TABLE threads (
    id TEXT PRIMARY KEY,                    -- 세션 UUID (ULIDv7 포맷)
    rollout_path TEXT NOT NULL,             -- 세션 JSONL 파일 전체 경로
    created_at INTEGER NOT NULL,            -- Unix 타임스탬프
    updated_at INTEGER NOT NULL,            -- Unix 타임스탬프
    source TEXT NOT NULL,                   -- 출처: codex_vscode, codex_cli 등
    model_provider TEXT NOT NULL,           -- openai, anthropic 등
    cwd TEXT NOT NULL,                      -- 작업 디렉토리
    title TEXT NOT NULL,                    -- 세션 제목 (첫 사용자 메시지 기반)
    sandbox_policy TEXT NOT NULL,           -- 보안 샌드박스 모드
    approval_mode TEXT NOT NULL,            -- 사용자 승인 설정
    tokens_used INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    git_sha TEXT,                           -- Git 커밋 해시
    git_branch TEXT,                        -- Git 브랜치 이름
    git_origin_url TEXT,                    -- Git 원격 URL
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    memory_mode TEXT NOT NULL DEFAULT 'enabled',
    model TEXT,
    reasoning_effort TEXT,
    agent_path TEXT,
    created_at_ms INTEGER,
    updated_at_ms INTEGER,
    thread_source TEXT,                     -- subagent, user 등
    preview TEXT NOT NULL DEFAULT '',
    recency_at INTEGER NOT NULL DEFAULT 0,
    recency_at_ms INTEGER NOT NULL DEFAULT 0
);
```

**추가 테이블:**
- `thread_dynamic_tools` - 세션별 동적 도구 설정
- `agent_jobs` - 백그라운드 작업 추적
- `agent_job_items` - 작업 실행 세부사항
- `thread_spawn_edges` - 부모-자식 세션 관계
- `remote_control_enrollments` - 원격 접근 설정

#### logs_2.sqlite - 로깅 데이터베이스

```sql
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    ts_nanos INTEGER NOT NULL,
    level TEXT NOT NULL,
    target TEXT NOT NULL,
    feedback_log_body TEXT,
    module_path TEXT,
    file TEXT,
    line INTEGER,
    thread_id TEXT,                         -- 세션 연결
    process_uuid TEXT,
    estimated_bytes INTEGER NOT NULL DEFAULT 0
);
```

---

## 2. 세션 파일 포맷 분석

### 2.1 파일 명명 패턴

**패턴:** `rollout-{TIMESTAMP}-{SESSION_ID}.jsonl`

**예시:**
```
rollout-2026-06-30T09-48-32-019f15ff-c9d5-7b71-a1f4-373295b23510.jsonl
```

**구성요소:**
- `rollout-` - 고정 접두사
- `2026-06-30T09-48-32` - ISO 타임스탬프 (날짜 + 시간)
- `019f15ff-c9d5-7b71-a1f4-373295b23510` - ULIDv7 세션 ID

### 2.2 디렉토리 계층

```
sessions/
└── {YEAR}/          # 예: 2026
    └── {MONTH}/     # 예: 06
        └── {DAY}/   # 예: 30
            └── rollout-*.jsonl
```

### 2.3 세션 인덱스 포맷

`~/.codex/session_index.jsonl` 경량 세션 항목 포함:

```jsonl
{"id":"019f113c-9622-7d43-8469-4fc554b02a00","thread_name":"견적 제안 검토","updated_at":"2026-06-29T02:37:18.007885Z"}
{"id":"019f13cf-0ec6-7d02-af9b-3b8c1282eb99","thread_name":"커뮤니티 사용 개선안 검토","updated_at":"2026-06-29T14:36:25.910671Z"}
```

**필드:**
- `id` - 세션 UUID (ULIDv7)
- `thread_name` - 사람이 읽을 수 있는 세션 제목
- `updated_at` - ISO 8601 타임스탬프

### 2.4 상세 세션 파일 구조 (JSONL)

각 줄은 이벤트를 나타내는 별도 JSON 객체:

#### 이벤트 유형 1: 세션 메타데이터

```json
{
  "timestamp": "2026-06-30T00:48:32.876Z",
  "type": "session_meta",
  "payload": {
    "session_id": "019f113c-9622-7d43-8469-4fc554b02a00",
    "id": "019f15ff-c9d5-7b71-a1f4-373295b23510",
    "parent_thread_id": "019f113c-9622-7d43-8469-4fc554b02a00",
    "timestamp": "2026-06-30T00:48:32.767Z",
    "cwd": "/Users/zhluv/Desktop/samplehospital",
    "originator": "codex_vscode",
    "cli_version": "0.142.3",
    "source": {
      "subagent": {
        "other": "guardian"
      }
    },
    "thread_source": "subagent",
    "model_provider": "openai",
    "git": {
      "commit_hash": "e173a7724c34ec6479da5ce945cef38b24f26b03",
      "branch": "main",
      "repository_url": "https://github.com/zhzhluv/samplehospital.git"
    }
  }
}
```

#### 이벤트 유형 2: 작업 시작

```json
{
  "timestamp": "2026-06-30T00:48:32.876Z",
  "type": "event_msg",
  "payload": {
    "type": "task_started",
    "turn_id": "019f15ff-ca3b-77d3-a389-deb91c580831",
    "started_at": 1782780512,
    "model_context_window": 258400,
    "collaboration_mode_kind": "default"
  }
}
```

#### 이벤트 유형 3: 응답 항목 (메시지)

```json
{
  "timestamp": "2026-06-30T00:48:33.774Z",
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "..."
      }
    ]
  }
}
```

#### 이벤트 유형 4: 턴 컨텍스트

```json
{
  "timestamp": "2026-06-30T00:48:33.774Z",
  "type": "turn_context",
  "payload": {
    "turn_id": "019f15ff-ca3b-77d3-a389-deb91c580831",
    "cwd": "/Users/zhluv/Desktop/samplehospital",
    "workspace_roots": ["/Users/zhluv/Desktop/samplehospital"],
    "current_date": "2026-06-30",
    "timezone": "Asia/Seoul",
    "approval_policy": "never",
    "sandbox_policy": {
      "type": "read-only"
    },
    "model": "codex-auto-review",
    "personality": "friendly",
    "effort": "low",
    "summary": "auto"
  }
}
```

---

## 3. 통합용 추출 필드

### 3.1 세션 식별

| 필드 | 위치 | 포맷 | 예시 |
|------|------|------|------|
| session_id | session_meta.payload.session_id | ULIDv7 UUID | `019f15ff-c9d5-7b71-a1f4-373295b23510` |
| parent_thread_id | session_meta.payload.parent_thread_id | ULIDv7 UUID 또는 null | `019f113c-9622-7d43-8469-4fc554b02a00` |
| thread_name | session_index.jsonl | 문자열 | `견적 제안 검토` |

### 3.2 시간 정보

| 필드 | 위치 | 포맷 | 예시 |
|------|------|------|------|
| timestamp | 모든 이벤트 | ISO 8601 | `2026-06-30T00:48:32.876Z` |
| updated_at | session_index.jsonl | ISO 8601 | `2026-06-29T02:37:18.007885Z` |
| created_at | threads 테이블 | Unix 타임스탬프 (초) | `1782780512` |

### 3.3 작업 컨텍스트

| 필드 | 위치 | 포맷 | 예시 |
|------|------|------|------|
| cwd | session_meta.payload.cwd | 절대 경로 | `/Users/zhluv/Desktop/samplehospital` |
| workspace_roots | turn_context.payload.workspace_roots | 경로 배열 | `["/Users/zhluv/Desktop/samplehospital"]` |
| timezone | turn_context.payload.timezone | IANA 시간대 | `Asia/Seoul` |

### 3.4 Git 정보

| 필드 | 위치 | 포맷 | 예시 |
|------|------|------|------|
| git.commit_hash | session_meta.payload.git.commit_hash | SHA-1 | `e173a7724c34ec6479da5ce945cef38b24f26b03` |
| git.branch | session_meta.payload.git.branch | 문자열 | `main` |
| git.repository_url | session_meta.payload.git.repository_url | URL | `https://github.com/zhzhluv/samplehospital.git` |

### 3.5 설정 및 도구

| 필드 | 위치 | 포맷 | 예시 |
|------|------|------|------|
| originator | session_meta.payload.originator | 문자열 | `codex_vscode`, `codex_cli` |
| cli_version | session_meta.payload.cli_version | Semver | `0.142.3` |
| model_provider | session_meta.payload.model_provider | 문자열 | `openai`, `anthropic` |
| model | turn_context.payload.model | 문자열 | `codex-auto-review` |
| thread_source | session_meta.payload.thread_source | 문자열 | `subagent`, `user` |
| approval_policy | turn_context.payload.approval_policy | 문자열 | `never`, `always`, `ask` |
| sandbox_policy.type | turn_context.payload.sandbox_policy.type | 문자열 | `read-only`, `restricted` |

---

## 4. Claude 세션 포맷과 비교

### 4.1 Claude 디렉토리 구조

```
~/.claude/projects/
└── {PROJECT_DIR_ENCODED}/        # 예: -Users-zhluv-Projects-agent-control-center
    ├── {SESSION_UUID}.jsonl      # 직접 세션 파일
    └── ...                        # 여러 세션 파일
```

### 4.2 주요 차이점

| 측면 | Codex | Claude |
|------|-------|--------|
| **파일 구성** | 날짜 계층 (`2026/06/30/`) | 플랫 프로젝트 디렉토리 |
| **파일 명명** | `rollout-{timestamp}-{id}.jsonl` | `{session_uuid}.jsonl` |
| **메타데이터 저장** | SQLite + JSONL | JSONL만 |
| **세션 인덱스** | 전역 `session_index.jsonl` | 없음 (파일시스템 의존) |
| **이벤트 구조** | 중첩 페이로드가 있는 타입 이벤트 | 플랫 메시지 구조 |
| **세션 ID 포맷** | ULIDv7 (시간 정렬 가능) | 표준 UUID v4 |
| **컨텍스트 추적** | 전용 `turn_context` 이벤트 | 각 메시지에 인라인 |
| **Git 통합** | 메타데이터 내 전용 git 객체 | `gitBranch` 필드만 |
| **서브 에이전트 지원** | `thread_source` 내장 | `isSidechain` 플래그 |
| **작업 디렉토리** | 턴별 추적 | 메시지별 인라인 |

### 4.3 유사점

- 둘 다 추가 전용 세션 로그에 **JSONL 포맷** 사용
- 둘 다 **cwd** (작업 디렉토리) 추적
- 둘 다 **git 브랜치** 추적
- 둘 다 **UUID 기반 세션 식별자** 사용
- 둘 다 **ISO 8601 포맷**으로 타임스탬프 저장
- 둘 다 **부모/자식 세션 관계** 추적
- 둘 다 **다중 턴 대화** 지원

---

## 5. 통합 권장사항

### 5.1 우선 추출 항목

Agent Control Center UI를 위해 우선 추출할 항목:

1. **세션 식별**
   - `session_id` - 기본 키
   - `thread_name` - 표시 이름
   - `parent_thread_id` - 계층 시각화용

2. **시간 데이터**
   - `timestamp` - 이벤트 타이밍
   - `updated_at` - 마지막 활동
   - `created_at` - 세션 시작

3. **작업 컨텍스트**
   - `cwd` - 현재 작업 디렉토리
   - `workspace_roots` - 프로젝트 경계
   - `git.branch` - 활성 브랜치
   - `git.repository_url` - 프로젝트 식별자

4. **세션 메타데이터**
   - `originator` - 출처 (VSCode, CLI)
   - `model_provider` - AI 제공자
   - `thread_source` - 사용자 vs 서브 에이전트
   - `agent_role` - 에이전트 할당

### 5.2 SQLite 쿼리 전략

**권장 방식:** 빠른 메타데이터 접근을 위해 `threads` 테이블 쿼리:

```sql
SELECT
    id,
    title,
    cwd,
    git_branch,
    git_origin_url,
    created_at_ms,
    updated_at_ms,
    thread_source,
    agent_role,
    tokens_used,
    archived
FROM threads
WHERE cwd = ?
    AND archived = 0
ORDER BY updated_at_ms DESC;
```

**성능 참고:**
- SQLite 쿼리가 JSONL 파일 파싱보다 훨씬 빠름
- 인덱스된 컬럼 사용 (`created_at`, `updated_at`, `cwd`)
- 상세 메시지 내용이 필요할 때만 JSONL 파일 파싱

### 5.3 통합 세션 저장소 설계

**제안 아키텍처:**

```typescript
interface UnifiedSession {
  id: string;                      // 세션 UUID
  source: 'codex' | 'claude';      // 출처
  title: string;                   // 표시 이름
  cwd: string;                     // 작업 디렉토리
  gitBranch?: string;              // Git 브랜치
  gitRepo?: string;                // 저장소 URL
  createdAt: Date;                 // 생성 시간
  updatedAt: Date;                 // 마지막 활동
  originator?: string;             // codex_vscode, claude_cli
  agentRole?: string;              // 할당된 에이전트
  threadSource?: string;           // user, subagent
  archived: boolean;               // 아카이브 상태
  parentId?: string;               // 부모 세션

  // 지연 로딩 세부사항
  messages?: SessionMessage[];
  tools?: ToolUsage[];
}
```

---

## 6. 불확실/불명확 포맷

### 6.1 확인 필요 사항

1. **세션 생명주기 이벤트:**
   - 세션 완료/종료를 표시하는 이벤트는?
   - 명시적인 "session_end" 이벤트가 있는가?
   - 방치된 세션은 어떻게 처리되는가?

2. **도구 사용 추적:**
   - 도구 호출이 별도 이벤트에 기록되는가?
   - 도구 성공/실패 상태 추출 방법은?
   - 도구 결과는 어디에 저장되는가?

3. **다중 에이전트 조정:**
   - 서브 에이전트가 부모에게 상태를 어떻게 전달하는가?
   - 이벤트 스트림에 핸드오프 프로토콜이 있는가?
   - 에이전트 경계가 어떻게 적용되는가?

4. **메모리 시스템:**
   - `memories_1.sqlite`에 무엇이 저장되는가?
   - `memory_mode`가 세션 동작에 어떤 영향을 미치는가?
   - 메모리가 특정 세션에 연결되는가?

5. **승인 시스템:**
   - 승인 요청이 어떻게 기록되는가?
   - 승인 결정이 어디에 저장되는가?
   - 승인 정책이 세션 중간에 변경될 수 있는가?

---

## 7. 보안 관찰

### 7.1 자격증명 격리

- **확인됨:** 모든 자격증명이 `auth.json`에 저장 (검토하지 않음)
- **양호:** 세션 파일에 토큰/키 노출 없음
- **양호:** SQLite 데이터베이스에 자격증명 자료 없음
- **양호:** Git URL은 저장되지만 인증 토큰은 없음

### 7.2 세션 내 민감 데이터

**잠재적 우려:**
- 사용자 파일 경로 (예: `/Users/zhluv/Desktop/samplehospital`)
- Git 저장소 URL (내부 프로젝트 노출 가능)
- 작업 디렉토리 내용 (프로젝트 구조)
- 대화 내용 (내부 정보 포함 가능)

**완화 권장:**
- 비소유자에게 표시 시 파일 경로 필터링
- 민감한 저장소 URL 마스킹
- 세션별 접근 제어 구현
- 아카이브된 세션 암호화 고려

---

## 8. 다음 단계

### 8.1 Agent B용 (Claude 세션 핸들러)

1. Claude 세션에 유사한 JSONL 파싱 구현
2. 동등한 필드 추출 (cwd, gitBranch, sessionId, timestamps)
3. Codex 포맷과 이벤트 구조 비교
4. 통합 스키마를 위한 공통 필드 식별

### 8.2 Agent C용 (통합 저장소)

1. 두 포맷을 지원하는 데이터베이스 스키마 설계
2. Codex 및 Claude 파서용 어댑터 구현
3. 빠른 쿼리를 위한 인덱싱 전략 생성
4. 세션 계층 해결기 구축

### 8.3 통합 테스트용

1. 여러 프로젝트의 실제 Codex 세션으로 테스트
2. 대규모에서 SQLite 쿼리 성능 검증
3. JSONL 파싱 엣지 케이스 검증
4. 서브 에이전트 세션 연결 테스트

---

## 부록 A: 샘플 세션 파일 위치

**Codex:**
```
~/.codex/sessions/2026/06/30/rollout-2026-06-30T09-48-32-019f15ff-c9d5-7b71-a1f4-373295b23510.jsonl
```

**Claude:**
```
~/.claude/projects/-Users-zhluv-Projects-agent-control-center/00034dcc-1719-4d20-9b82-c7e03a8fb7f7.jsonl
```

---

## 부록 B: 이벤트 유형 참조

| 이벤트 유형 | 목적 | 주요 필드 |
|------------|------|----------|
| `session_meta` | 세션 초기화 | session_id, cwd, git, originator |
| `event_msg` | 생명주기 이벤트 | type, turn_id, started_at |
| `response_item` | 사용자/어시스턴트 메시지 | role, content, message |
| `turn_context` | 턴별 설정 | cwd, workspace_roots, model, sandbox_policy |

---

## 부록 C: 데이터베이스 테이블 참조

| 테이블 | 목적 | 주요 컬럼 |
|-------|------|----------|
| `threads` | 세션 메타데이터 | id, cwd, title, git_branch, agent_role |
| `thread_dynamic_tools` | 도구 설정 | thread_id, name, description |
| `agent_jobs` | 백그라운드 작업 | id, name, status, instruction |
| `thread_spawn_edges` | 부모-자식 연결 | parent_thread_id, child_thread_id |
| `logs` | 시스템 로그 | thread_id, ts, level, feedback_log_body |

---

**보고서 상태:** 완료
**자격증명 검토:** 없음 (보안 요건 준수)
**신뢰 수준:** 높음 (직접 파일 검사 기반)
