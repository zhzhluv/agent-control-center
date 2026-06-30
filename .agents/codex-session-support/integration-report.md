# 통합 보고서: Codex 세션 지원

**프로젝트**: Agent Control Center
**날짜**: 2026-07-01
**슬라이스**: Codex 세션 읽기전용 감지
**상태**: CODEX 검수 대기

---

## 요약

| 영역 | 상태 | 비고 |
|------|------|------|
| Codex 포맷 분석 | 통과 | SQLite + JSONL 이중 구조 확인 |
| 서버 구현 | 통과 | CodexMonitor 클래스 생성, source 필드 추가 |
| UI source 배지 | 통과 | Claude(파랑) / Codex(주황) 배지 구현 |
| 빌드 검증 | 통과 | TypeScript 에러 0 |
| 보안 감사 | 통과 | 자격증명 파일 접근 없음 |
| API 검증 | 통과 | source 필드 모든 agent/session에 존재 |
| 브라우저 검증 | 통과 | 스크린샷 4장 캡처 |
| CodexMonitor 개선 | 통과 | 장기 감시용 scanInterval 추가 |
| README 업데이트 | 통과 | Claude + Codex 지원 반영 |
| 보안 후처리 | 통과 | 민감값 마스킹 (PGPASSWORD, TOKEN 등) |

---

## 1. Codex 세션 포맷

### 주요 발견사항

**디렉토리 구조**:
```
~/.codex/
  sessions/
    2026/06/30/
      rollout-{timestamp}-{session_id}.jsonl
  auth.json     [검토 대상 아님 - 자격증명]
  state_5.sqlite
  session_index.jsonl
```

**세션 파일 포맷**:
- 파일명: `rollout-YYYY-MM-DDTHH-MM-SS-{ULIDv7}.jsonl`
- 이벤트 유형: `session_meta`, `turn_context`, `response_item`, `event_msg`
- 주요 필드: `cwd`, `timestamp`, `session_id`, `git.branch`, `git.repository_url`

**보안 준수**:
- auth.json 명시적으로 검토하지 않음
- 세션 로그에 자격증명 값 없음
- 추출 데이터는 메타데이터만

---

## 2. 서버 구현

### 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/src/claude-monitor.ts` | AgentInfo/SessionInfo에 `source: 'claude' \| 'codex'` 추가, redactSecrets 적용 |
| `server/src/codex-monitor.ts` | 신규: Codex 세션 모니터 (440줄) |
| `server/src/index.ts` | 두 모니터 통합, `getMergedStatus()` |
| `server/src/redact.ts` | 신규: 민감값 마스킹 헬퍼 |
| `server/src/redact.test.ts` | 신규: 마스킹 단위 테스트 |

### 주요 기능

1. **Source 필드**: 모든 agents/sessions에 `source: 'claude'` 또는 `source: 'codex'` 추가

2. **CodexMonitor**:
   - `~/.codex/sessions/YYYY/MM/DD/*.jsonl` 스캔
   - 파일명 UUID 패턴에서 세션 ID 추출
   - git root 정규화 (기존 `findGitRoot()` 사용)
   - 임시 경로 필터링 (`/tmp`, `/private/tmp` 등)
   - 세션당 합성 main agent 생성
   - 60초 주기 스캔 (scanInterval)

3. **민감값 마스킹**:
   - 환경변수: PGPASSWORD, TOKEN, API_KEY, DATABASE_URL 등
   - 헤더: Bearer, Authorization, X-API-Key
   - URL 파라미터: ?token=, &secret=, &password= 등

---

## 3. UI 구현

### 배지 디자인

| Source | 색상 | 라벨 | CSS 클래스 |
|--------|------|------|-----------|
| Claude | 파랑 (#5a9eff) | C | `.source-badge.claude` |
| Codex | 주황 (#ffb266) | X | `.source-badge.codex` |

### 적용 위치

- Staff Board: 에이전트 이름 옆 배지
- Inspector Panel: 프로필 헤더 배지
- PixelOffice 툴팁: 이름과 타입 사이 배지
- Event Stream: 에이전트 이름 뒤 배지

### 클라이언트 보안

- `client/src/utils/sanitize.ts`: 방어적 마스킹 레이어
- `sanitizeForDisplay()` 함수로 currentTask, summary 등 표시 전 마스킹

---

## 4. 테스트

### 빌드 상태

```
서버 빌드: 통과
클라이언트 빌드: 통과
TypeScript: 에러 0
git diff --check: 통과
```

### 마스킹 테스트

```bash
npm run test:redact
```

**테스트 케이스** (23개 통과):
- PGPASSWORD=abc psql -U user → PGPASSWORD=[REDACTED] psql -U user
- AUTH_TOKEN=abc npm start → AUTH_TOKEN=[REDACTED] npm start
- Authorization: Bearer abc → Authorization: [REDACTED]
- curl -H "Authorization: Bearer abc" → curl -H "Authorization: [REDACTED]"
- https://x.test?a=1&token=abc&secret=def → https://x.test?a=1&token=[REDACTED]&secret=[REDACTED]

### API 검증

**테스트 서버**: 포트 9877

**감지 결과** (실시간 변동 가능):
```
총 에이전트: 4 (Claude: 2, Codex: 2)
총 세션: 4 (Claude: 2, Codex: 2)
총 프로젝트: 3
```

**Source 필드 검증**:
- 모든 Claude 에이전트: `source: "claude"`
- 모든 Codex 에이전트: `source: "codex"`
- source 필드 없는 agent/session: 0

---

## 5. 변경 파일

### 수정
| 파일 | 줄수 | 설명 |
|------|------|------|
| `.gitignore` | 44 | sanitize.ts 추적 허용 |
| `README.md` | - | Claude + Codex 지원 문서화 |
| `client/src/App.css` | ~500 | 배지 스타일링 |
| `client/src/App.tsx` | ~1200 | source 배지, sanitizeForDisplay |
| `client/src/components/PixelOffice.tsx` | ~660 | 툴팁 배지, sanitizeForDisplay |
| `server/src/claude-monitor.ts` | ~720 | source 필드, redactSecrets 적용 |
| `server/src/index.ts` | ~522 | CodexMonitor 통합 |
| `server/tsconfig.json` | 16 | 테스트 파일 제외 |
| `package.json` | - | test:redact 스크립트 추가 |

### 신규
| 파일 | 줄수 | 설명 |
|------|------|------|
| `server/src/codex-monitor.ts` | 440 | Codex 세션 모니터 |
| `server/src/redact.ts` | 102 | 민감값 마스킹 헬퍼 |
| `server/src/redact.test.ts` | 185 | 마스킹 단위 테스트 |
| `client/src/utils/sanitize.ts` | 66 | 클라이언트 방어적 마스킹 |
| `.agents/codex-session-support/*.md` | - | 보고서 (4 파일) |

---

## 6. 브라우저 검증

**스크린샷** (`.agents/codex-session-support/screenshots/`):

| 파일 | 설명 |
|------|------|
| 01-main-view.png | 메인 화면 - Staff Board에 source 배지 표시 |
| 02-inspector-source-badge.png | Inspector - Agent + source 배지 |
| 03-tooltip-source-badge.png | PixelOffice 툴팁 - source 배지 |
| 04-mobile-390.png | 390px 모바일 - 배지 정상 표시 |

**검증 항목**:
- Staff Board: Claude(C)/Codex(X) 배지 표시
- Inspector Panel: source 배지 표시
- PixelOffice 툴팁: source 배지 표시
- Mobile 390px: 모든 배지 정상 크기/위치
- 민감값 노출: 없음 ([REDACTED] 처리됨)

---

## 7. Git 상태

```
수정:
  M .gitignore
  M README.md
  M client/src/App.css
  M client/src/App.tsx
  M client/src/components/PixelOffice.tsx
  M package.json
  M server/src/claude-monitor.ts
  M server/src/index.ts
  M server/tsconfig.json

신규:
  ?? .agents/codex-session-support/
  ?? client/src/utils/sanitize.ts
  ?? server/src/codex-monitor.ts
  ?? server/src/redact.ts
  ?? server/src/redact.test.ts
```

**미커밋** - Codex 검수 대기 중

---

## 8. 결론

모든 완료 기준 충족:

- Claude 감지: 정상 (기존 유지)
- Codex 감지: 정상 (신규)
- Source 배지: 구현 완료 (Claude=파랑, Codex=주황)
- 보안: 자격증명 접근 없음 + 민감값 마스킹
- 빌드: 정상
- 테스트: test:redact 포함 전체 통과
- 보고서: 완료

**상태**: CODEX 검수 대기

---

**보고서 생성**: 2026-07-01
**다음 작업**: Codex 승인 후 커밋/푸시
