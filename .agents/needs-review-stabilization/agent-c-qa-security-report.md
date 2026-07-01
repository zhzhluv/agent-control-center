# Agent C - 보안/회귀 검증 보고서

**날짜**: 2026-07-01
**담당**: Agent C (보안/회귀 검증)
**상태**: ✅ 통과

---

## 요약

읽기 전용 정책, 토큰 보안, 테스트 통과, 코드 품질을 종합 검증한 결과 모든 항목이 기준을 충족합니다.

### 주요 결과
- ✅ 읽기 전용 정책 유지됨
- ✅ 토큰 하드코딩 없음
- ✅ 로그에 토큰값 출력 없음
- ✅ 모든 테스트 통과 (23개 redaction + 31개 smoke + 8개 reports API)
- ✅ git diff --check 통과
- ✅ needsReview는 상태 표시만, 명령 전송 없음

---

## 1. 읽기 전용 정책 검증

### 1.1 needsReview 관련 코드 검토

needsReview 필드는 순수하게 **검수 필요 후보 표시**만 수행하며, Claude/Codex 세션에 명령을 보내지 않습니다.

#### 파일: server/src/claude-monitor.ts

```typescript
// Line 37: 인터페이스 정의 (상태 표시용 플래그)
needsReview: boolean;                // 검수 필요 후보 여부
reviewCandidateAt?: string;          // ISO 타임스탬프
reviewReason?: string;               // 후보 판단 이유

// Line 733-792: checkNeedsReview() 함수
private checkNeedsReview(agent: AgentInfo, now: number): { needsReview: boolean; reason?: string } {
  // 조건 검사만 수행, 명령 전송 없음
  // 1. agent.status === 'idle' 확인
  // 2. recentActivity 분석
  // 3. 마지막 tool_result 성공 여부 확인
  // 4. 이후 새 활동 없는지 확인
  // → boolean 값만 반환
}

// Line 500-544: checkActiveSessions()에서 needsReview 플래그 업데이트
if (agent.status === 'idle') {
  const reviewCheck = this.checkNeedsReview(agent, now);
  if (reviewCheck.needsReview && !agent.needsReview) {
    agent.needsReview = true;  // 플래그만 설정
    agent.reviewCandidateAt = new Date().toISOString();
    agent.reviewReason = reviewCheck.reason;
    reviewStatusChanged = true;
  }
}
// 명령 전송 코드 없음, emit만 수행
```

#### 파일: server/src/codex-monitor.ts

```typescript
// Line 415-473: Codex 모니터도 동일한 패턴
private checkNeedsReview(agent: AgentInfo, now: number): { needsReview: boolean; reason?: string } {
  // 조건 검사만 수행, 명령 전송 없음
}

// Line 557-606: 플래그 업데이트만 수행
if (agent.status === 'idle') {
  const reviewCheck = this.checkNeedsReview(agent, now);
  if (reviewCheck.needsReview && !agent.needsReview) {
    agent.needsReview = true;
    // 명령 전송 없음
  }
}
```

**검증 결과**: needsReview는 상태 플래그 관리만 수행하며, spawn/exec/sendCommand 등 명령 실행 코드가 전혀 없습니다.

### 1.2 API 엔드포인트 검토

#### 파일: server/src/index.ts

모든 API는 GET 메서드만 제공하며, POST/PUT/DELETE 엔드포인트가 없습니다.

```typescript
// Line 290-312: 모든 엔드포인트가 GET
app.get('/api/health', (req, res) => { ... });
app.get('/api/status', auth.verify, (req, res) => { ... });
app.get('/api/sessions', auth.verify, (req, res) => { ... });
app.get('/api/agents', auth.verify, (req, res) => { ... });
app.get('/api/metrics', auth.verify, (req, res) => { ... });
app.get('/api/diagnostics', auth.verify, (req, res) => { ... });
app.get('/api/reports', auth.verify, (req, res) => { ... });
app.get('/api/reports/:path(*)', auth.verify, (req, res) => { ... });
```

**검증 결과**:
- ✅ POST/PUT/DELETE 엔드포인트 없음
- ✅ 모든 API는 읽기 전용
- ✅ 인증이 필요한 엔드포인트는 auth.verify 미들웨어 사용

### 1.3 ClaudeController 사용 여부 확인

#### 파일: server/src/index.ts

```bash
$ grep -n "ClaudeController\|sendCommand" server/src/index.ts
# 결과: No matches found
```

**검증 결과**:
- ✅ index.ts에서 ClaudeController를 import하지 않음
- ✅ sendCommand 함수 호출 없음
- ✅ ClaudeController는 레거시 코드로, 실제 서버에서 사용되지 않음

---

## 2. 토큰/Credential 보안 검증

### 2.1 하드코딩된 토큰 검사

```bash
$ rg "(sk-|api[_-]?key|bearer|token).{0,50}[a-zA-Z0-9_-]{20,}" \
     --ignore-case \
     --no-filename \
     --no-line-number \
     | grep -v ".md\|.example\|.sh\|package-lock.json\|.cjs"
```

**결과**: 하드코딩된 실제 토큰 없음

발견된 매칭은 모두:
- 문서 파일 (.md)
- 예제 파일 (.env.example, .plist.example)
- 테스트 스크립트 (.sh, .cjs)
- 패키지 메타데이터 (package-lock.json)
- 환경변수 이름 (AUTH_TOKEN=, OPENAI_API_KEY=)

**검증 결과**: ✅ 하드코딩된 실제 토큰 없음

### 2.2 로그 출력 검사

```bash
$ rg "console\.(log|warn|error|info).*token" --ignore-case
```

**주요 발견**:

#### server/src/index.ts (Line 38-40)
```typescript
console.warn('⚠️  Development mode: Using temporary auth token.');
console.warn('   Token written to: /tmp/agent-control-center-token');
console.warn('   Set AUTH_TOKEN env var for persistent authentication.\n');
```

**분석**:
- ✅ 토큰 **값**을 출력하지 않음
- ✅ 토큰 **파일 경로**만 안내
- ✅ 개발 모드에서만 실행 (IS_PRODUCTION 체크)

#### server/src/index.ts (Line 507)
```typescript
console.log(`
╔══════════════════════════════════════════════════════════╗
║   Auth:  ${IS_PRODUCTION ? 'Production (token required)' : 'Development (see /tmp/agent-control-center-token)'}
╚══════════════════════════════════════════════════════════╝
`);
```

**분석**:
- ✅ 토큰 값을 출력하지 않음
- ✅ 파일 경로만 안내

#### .agents/browser-visual-acceptance/capture-authenticated.cjs (Line 27)
```javascript
console.log('Token: loaded');
```

**분석**:
- ✅ 토큰 값을 출력하지 않음
- ✅ 로딩 성공 여부만 표시

**검증 결과**: ✅ 로그에 실제 토큰값 출력 없음

### 2.3 토큰 정책 검증

#### 파일: server/src/index.ts (Line 24-48)

```typescript
const DEFAULT_TOKEN = 'change-this-token';
let AUTH_TOKEN = process.env.AUTH_TOKEN || '';

if (!AUTH_TOKEN || AUTH_TOKEN === DEFAULT_TOKEN) {
  if (IS_PRODUCTION) {
    console.error('❌ FATAL: AUTH_TOKEN environment variable is required in production.');
    console.error('   Set a secure AUTH_TOKEN before starting the server.');
    process.exit(1);
  } else {
    // Development only: 임시 토큰 생성 (로그에 노출하지 않음)
    AUTH_TOKEN = crypto.randomBytes(16).toString('hex');
    console.warn('⚠️  Development mode: Using temporary auth token.');
    console.warn('   Token written to: /tmp/agent-control-center-token');
    console.warn('   Set AUTH_TOKEN env var for persistent authentication.\n');
    try {
      writeFileSync('/tmp/agent-control-center-token', AUTH_TOKEN);
    } catch {
      console.warn('   Could not write token file. Check /tmp permissions.');
    }
  }
}
```

**검증 결과**:
- ✅ Production: AUTH_TOKEN 필수, 미설정 시 서버 시작 실패
- ✅ Development: 임시 토큰 생성하되 콘솔에 출력하지 않음
- ✅ 토큰은 파일로만 전달 (/tmp/agent-control-center-token)

### 2.4 Redaction 기능 검증

#### 파일: server/src/redact.ts

```typescript
const ENV_SECRET_PATTERNS = [
  /\bPGPASSWORD=[^\s&]+/gi,
  /\bPASSWORD=[^\s&]+/gi,
  /\bTOKEN=[^\s&]+/gi,
  /\bAUTH_TOKEN=[^\s&]+/gi,
  /\bAPI_KEY=[^\s&]+/gi,
  // ... 총 14개 패턴
];

export function redactSecrets(input: string): string {
  // 환경변수, 헤더, URL 쿼리 파라미터의 민감값 마스킹
  // 예: PASSWORD=secret123 → PASSWORD=[REDACTED]
}
```

**테스트 결과** (server/src/redact.test.ts):
```
✓ PGPASSWORD 마스킹
✓ PASSWORD 마스킹
✓ TOKEN 마스킹
✓ API_KEY 마스킹
✓ DATABASE_URL 마스킹
✓ AWS_SECRET_ACCESS_KEY 마스킹
✓ Bearer 토큰 마스킹
✓ Authorization 헤더 마스킹
✓ curl Authorization 헤더
✓ X-API-Key 헤더 마스킹
✓ 단일 token 파라미터
✓ 복수 민감 파라미터
✓ api_key 파라미터

통과: 23 / 실패: 0
```

**검증 결과**: ✅ Redaction 기능 정상 작동

---

## 3. 테스트 실행 결과

### 3.1 npm test

```bash
$ npm test
```

#### 3.1.1 Redaction 테스트 (23개)
```
=== Redaction 테스트 시작 ===

--- 환경변수 패턴 ---
✓ PGPASSWORD 마스킹
✓ PASSWORD 마스킹
✓ TOKEN 마스킹
✓ API_KEY 마스킹
✓ DATABASE_URL 마스킹
✓ AWS_SECRET_ACCESS_KEY 마스킹

--- 헤더 패턴 ---
✓ Bearer 토큰 마스킹
✓ Authorization 헤더 마스킹
✓ curl Authorization 헤더
✓ X-API-Key 헤더 마스킹

--- URL 쿼리 파라미터 ---
✓ 단일 token 파라미터
✓ 복수 민감 파라미터
✓ api_key 파라미터

--- 엣지 케이스 ---
✓ 빈 문자열
✓ null/undefined 처리
✓ 민감값 없는 문자열
✓ 복수 민감값
✓ 대소문자 무시

--- redactObject ---
✓ 객체 내 문자열 마스킹
✓ 중첩 객체 마스킹
✓ 배열 마스킹
✓ null/undefined 보존
✓ 비문자열 값 보존

=== 테스트 결과 ===
통과: 23
실패: 0
```

#### 3.1.2 Smoke 테스트 (31개)
```
═══ Section 1: Health & Build Verification ═══
✓ GET /api/health (HTTP 200)
✓ Field 'status' exists
✓ Field 'uptime' exists
✓ Client build exists
✓ Server build exists

═══ Section 2: API Endpoints (Authenticated) ═══
✓ GET /api/status (HTTP 200)
✓ Field 'agents' exists (array, length: 13)
✓ Field 'sessions' exists (array, length: 9)
✓ Field 'metrics' exists (object)
✓ GET /api/diagnostics (HTTP 200)
✓ Field 'uptime' exists
✓ Field 'activeSessions' exists
✓ Field 'connectionStats' exists (object)
✓ Field 'reportsCount' exists
✓ GET /api/agents (HTTP 200)
✓ GET /api/sessions (HTTP 200)
✓ GET /api/metrics (HTTP 200)
✓ Field 'totalAgents' exists
✓ Field 'activeAgents' exists
✓ GET /api/reports (HTTP 200)
✓ Field 'reports' exists (array, length: 72)
✓ GET /api/reports/:path (HTTP 200)
✓ Field 'content' exists

═══ Section 3: Security Tests ═══
✓ No auth header (HTTP 401)
✓ Invalid auth token (HTTP 401)
✓ Path traversal (HTTP 403)
✓ Non-.md file access (HTTP 403)

═══ Section 4: WebSocket Tests ═══
✓ WebSocket connection established
✓ Received 'init' message
✓ Ping/pong successful
✓ WebSocket rejects invalid token (code 4001)

Passed: 31
Failed: 0
```

#### 3.1.3 Reports API 테스트 (8개)
```
=== Reports API Test Suite ===

1. GET /api/reports (list all reports)
   ✅ PASS: HTTP 200
   Found 72 reports

2. GET /api/reports/:path (get first report)
   ✅ PASS: HTTP 200

3. Security: path traversal ../../../etc/passwd
   ✅ PASS: HTTP 403

4. Security: URL-encoded %2e%2e%2f
   ✅ PASS: HTTP 403

5. Security: double-encoded %252e%252e
   ✅ PASS: HTTP 403

6. Security: non-.md file request
   ✅ PASS: HTTP 403

7. Security: no auth header
   ✅ PASS: HTTP 401

8. Security: invalid auth token
   ✅ PASS: HTTP 401

Passed: 8
Failed: 0
```

**총 테스트 결과**:
- ✅ Redaction: 23개 통과
- ✅ Smoke: 31개 통과
- ✅ Reports API: 8개 통과
- **총 62개 테스트 모두 통과**

---

## 4. git diff --check 실행

```bash
$ git diff --check
# 출력 없음 (문제 없음)
```

**검증 결과**: ✅ 공백 관련 문제 없음

---

## 5. 보안 체크리스트

| 항목 | 상태 | 비고 |
|------|------|------|
| needsReview가 명령 전송하지 않는가? | ✅ | 상태 플래그만 관리 |
| API가 읽기 전용인가? (GET만) | ✅ | POST/PUT/DELETE 없음 |
| ClaudeController 사용되지 않는가? | ✅ | index.ts에서 import 없음 |
| 하드코딩된 토큰이 없는가? | ✅ | 실제 토큰값 없음 |
| 로그에 토큰값 출력되지 않는가? | ✅ | 파일 경로만 안내 |
| Production에서 AUTH_TOKEN 필수인가? | ✅ | 미설정 시 서버 시작 실패 |
| Redaction 기능이 작동하는가? | ✅ | 23개 테스트 통과 |
| 모든 테스트가 통과하는가? | ✅ | 62개 테스트 통과 |
| git diff --check 통과하는가? | ✅ | 공백 문제 없음 |
| Path traversal 공격 차단되는가? | ✅ | 403 반환 확인 |
| 인증 없는 요청이 차단되는가? | ✅ | 401 반환 확인 |

---

## 6. 추가 발견 사항

### 6.1 레거시 코드

**파일**: server/src/claude-controller.ts

이 파일은 명령 전송 기능(sendCommand, spawn)을 포함하지만, **실제 서버에서 사용되지 않습니다**.

```bash
$ grep -n "import.*ClaudeController" server/src/index.ts
# 결과: 없음
```

**권장 사항**:
- 향후 리팩토링 시 삭제 고려
- 현재는 무해함 (사용되지 않음)

### 6.2 Rate Limiting

**파일**: server/src/index.ts (Line 65-228)

```typescript
const RATE_LIMIT_MAX = IS_PRODUCTION ? 30 : 100;
// 개발 모드에서는 localhost rate limiting 비활성화
```

**검증 결과**: ✅ 적절한 Rate limiting 구현됨

### 6.3 CORS 설정

**파일**: server/src/index.ts (Line 51-58)

```typescript
const corsOptions = NODE_ENV === 'production' ? {
  origin: process.env.CORS_ORIGIN || false,
} : {};

if (NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  WARNING: CORS_ORIGIN not set in production mode.');
}
```

**검증 결과**: ✅ Production에서 CORS 제한 권장 메시지 출력

---

## 7. 결론

### 7.1 통과 항목

1. ✅ **읽기 전용 정책**: needsReview는 상태 플래그만 관리, 명령 전송 없음
2. ✅ **API 보안**: 모든 엔드포인트가 GET (읽기 전용)
3. ✅ **토큰 보안**: 하드코딩 없음, 로그에 값 출력 없음
4. ✅ **테스트 통과**: 62개 테스트 모두 통과
5. ✅ **코드 품질**: git diff --check 통과
6. ✅ **인증**: 필수 엔드포인트에 auth.verify 적용
7. ✅ **Redaction**: 민감값 마스킹 기능 정상 작동
8. ✅ **Rate limiting**: DDoS 방어 구현
9. ✅ **Path traversal 방어**: 디렉토리 탐색 공격 차단

### 7.2 권장 사항

1. **레거시 코드 정리** (우선순위: 낮음)
   - server/src/claude-controller.ts 삭제 고려
   - 현재는 사용되지 않아 무해함

2. **Production 배포 체크리스트** (우선순위: 높음)
   - AUTH_TOKEN 환경변수 설정 필수
   - CORS_ORIGIN 설정 권장

### 7.3 최종 판정

**상태**: ✅ **승인 (Approved)**

모든 보안 및 회귀 검증 기준을 충족합니다. needs-review 기능은 읽기 전용 정책을 준수하며, 토큰 보안과 테스트 커버리지가 우수합니다.

---

## 부록: 검증 명령어

### A.1 needsReview 명령 전송 확인
```bash
rg "sendCommand|spawn|exec" server/src/claude-monitor.ts
rg "sendCommand|spawn|exec" server/src/codex-monitor.ts
# 결과: 없음
```

### A.2 하드코딩 토큰 검사
```bash
rg "(sk-|api[_-]?key|bearer|token).{0,50}[a-zA-Z0-9_-]{20,}" \
   --ignore-case \
   --glob "!*.md" \
   --glob "!*.example" \
   --glob "!*.sh" \
   server/src/
# 결과: 실제 토큰 없음
```

### A.3 로그 토큰 출력 확인
```bash
rg "console\.(log|warn|error|info).*token" server/src/ --ignore-case
# 결과: 토큰 값 출력 없음 (파일 경로만)
```

### A.4 ClaudeController 사용 확인
```bash
rg "ClaudeController|sendCommand" server/src/index.ts
# 결과: 없음 (사용되지 않음)
```

### A.5 API 엔드포인트 확인
```bash
rg "app\.(post|put|delete|patch)" server/src/index.ts
# 결과: 없음 (GET만 존재)
```

---

**보고서 종료**
