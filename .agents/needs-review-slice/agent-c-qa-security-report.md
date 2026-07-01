# Agent C - QA, 보안, 알림 검토 보고서

**작성일**: 2026-07-01
**검토자**: Agent C
**목표**: 앱 내부 알림 구현 검토, Web Notifications API 검토, 보안 정책 확인, 테스트 실행

---

## 1. 요약

### 주요 발견사항
- **빌드**: ✅ 성공 (TypeScript 컴파일 오류 해결됨)
- **보안 정책**: 전반적으로 우수, 토큰 관리 안전
- **알림 구현**: ✅ 토스트 알림 구현 완료
- **PWA 설정**: PWA 미설정 (향후 Web Notifications 구현 시 필요)

### 권장사항
1. **완료**: ✅ TypeScript 컴파일 오류 수정됨
2. **완료**: ✅ 토스트 알림 컴포넌트 구현됨
3. **중기**: PWA 설정 후 Web Notifications API 검토
4. **장기**: 프로덕션 환경 보안 강화 (CORS, HTTPS)

---

## 2. 빌드 및 테스트 결과

### 2.1 빌드 성공 ✅

```bash
npm run build  # ✅ 성공
```

TypeScript 컴파일 오류가 해결되어 빌드가 정상 완료됩니다.

#### 과거 발견 후 해결된 이슈
- `needsReview` 필드 누락 → Agent 객체 생성 시 필드 추가로 해결됨
- `reviewCandidateAt`, `reviewReason` 필드도 함께 추가됨

### 2.2 테스트 통과 ✅

```bash
npm run build      # ✅ 성공
npm test           # ✅ 8/8 통과
npm run test:redact # ✅ 23/23 통과
```

### 2.3 Redaction 테스트 (독립 실행 가능)

#### 테스트 파일 검토
`/Users/zhluv/Projects/agent-control-center/server/src/redact.test.ts`

**테스트 커버리지**:
- ✅ 환경변수 패턴 (PGPASSWORD, TOKEN, API_KEY, DATABASE_URL 등)
- ✅ 헤더 패턴 (Bearer token, Authorization, X-API-Key)
- ✅ URL 쿼리 파라미터 (token, secret, api_key)
- ✅ 엣지 케이스 (빈 문자열, null/undefined, 복수 민감값)
- ✅ 객체 마스킹 (redactObject: 중첩 객체, 배열)

**보안 품질**: 우수
**권장사항**: 빌드 수정 후 테스트 재실행

---

## 3. 보안 정책 검토

### 3.1 인증 (AUTH_TOKEN)

#### 구현 위치
- `/Users/zhluv/Projects/agent-control-center/server/src/index.ts`
- `/Users/zhluv/Projects/agent-control-center/server/src/auth.ts`

#### 정책 검토

**개발 모드 (NODE_ENV !== 'production')**:
```typescript
// server/src/index.ts:30-48
if (!AUTH_TOKEN || AUTH_TOKEN === DEFAULT_TOKEN) {
  if (IS_PRODUCTION) {
    // 프로덕션: 토큰 필수, 미설정 시 서버 시작 실패
    console.error('❌ FATAL: AUTH_TOKEN environment variable is required in production.');
    process.exit(1);
  } else {
    // 개발: 임시 토큰 자동 생성
    AUTH_TOKEN = crypto.randomBytes(16).toString('hex');
    console.warn('⚠️  Development mode: Using temporary auth token.');
    console.warn('   Token written to: /tmp/agent-control-center-token');
    // 파일로만 토큰 전달 (콘솔 노출 금지)
    writeFileSync('/tmp/agent-control-center-token', AUTH_TOKEN);
  }
}
```

**보안 강점**:
1. ✅ 프로덕션에서 AUTH_TOKEN 필수 (미설정 시 서버 시작 실패)
2. ✅ 개발 모드에서 토큰 자동 생성 (32자 hex = 128비트 엔트로피)
3. ✅ 토큰 값 콘솔 로그 노출 없음 (파일로만 전달)
4. ✅ 기본 토큰 사용 금지 (change-this-token 거부)

**개선 권장사항**:
- `/tmp/agent-control-center-token` 파일 권한: `0600` (소유자만 읽기/쓰기)
- 프로덕션 환경에서 토큰 강도 검증 (최소 길이 24자 권장)

#### 인증 미들웨어 (AuthMiddleware)

**구현 검토** (`server/src/auth.ts`):
```typescript
verify = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string;

  // Check Authorization header (Bearer token)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === this.token) {
      return next();
    }
  }

  // Check query parameter
  if (queryToken === this.token) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
};
```

**보안 평가**:
- ✅ Bearer token 헤더 지원
- ✅ Query parameter 토큰 지원 (WebSocket 연결용)
- ✅ 401 Unauthorized 적절한 응답
- ⚠️ Timing attack 취약성 존재 (문자열 비교 `===`)

**개선 권장사항**:
```typescript
// Constant-time comparison 사용
import crypto from 'crypto';

const isTokenValid = crypto.timingSafeEqual(
  Buffer.from(token),
  Buffer.from(this.token)
);
```

### 3.2 CORS 정책

#### 구현 검토
```typescript
// server/src/index.ts:51-58
const corsOptions = NODE_ENV === 'production' ? {
  origin: process.env.CORS_ORIGIN || false,
} : {};

if (NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  WARNING: CORS_ORIGIN not set in production mode.');
  console.warn('   Set CORS_ORIGIN to restrict cross-origin requests.\n');
}
```

**보안 평가**:
- ✅ 프로덕션에서 CORS 제한 권장
- ✅ 개발 모드에서 CORS 허용 (로컬 개발 편의)
- ⚠️ CORS_ORIGIN 미설정 시 경고만 출력 (서버는 정상 시작)

**개선 권장사항**:
```typescript
// 프로덕션에서 CORS_ORIGIN 필수로 변경
if (NODE_ENV === 'production') {
  if (!process.env.CORS_ORIGIN) {
    console.error('❌ FATAL: CORS_ORIGIN required in production.');
    process.exit(1);
  }
  corsOptions.origin = process.env.CORS_ORIGIN;
}
```

### 3.3 Rate Limiting

#### 구현 검토
```typescript
// server/src/index.ts:65-228
const connectionAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW = 60000;  // 1분
const RATE_LIMIT_MAX = IS_PRODUCTION ? 30 : 100;

// 개발 모드에서는 localhost rate limiting 비활성화
const isLocalhost = clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1';
const skipRateLimit = !IS_PRODUCTION && isLocalhost;

if (!skipRateLimit) {
  // Rate limiting check
  if (attempts?.count >= RATE_LIMIT_MAX) {
    ws.close(4029, 'Too Many Requests');
    return;
  }
}
```

**보안 평가**:
- ✅ IP 기반 연결 제한 (프로덕션: 30회/분, 개발: 100회/분)
- ✅ 개발 모드에서 localhost 제한 완화
- ✅ WebSocket close code 4029 (Too Many Requests)
- ⚠️ 메모리 기반 추적 (서버 재시작 시 초기화)

**개선 권장사항**:
- Redis 기반 rate limiting (분산 환경 대비)
- IP 블랙리스트 기능 (반복 위반자 차단)

### 3.4 Path Traversal 방어

#### 구현 검토
```typescript
// server/src/index.ts:384-405
function isValidReportPath(relativePath: string): boolean {
  // Reject paths with '..'
  if (relativePath.includes('..')) {
    return false;
  }

  // Reject absolute paths
  if (path.isAbsolute(relativePath)) {
    return false;
  }

  // Must be .md file
  if (!relativePath.endsWith('.md')) {
    return false;
  }

  // Resolve and verify it stays within .agents directory
  const fullPath = path.resolve(AGENTS_DIR, relativePath);
  const normalizedAgentsDir = path.resolve(AGENTS_DIR);

  return fullPath.startsWith(normalizedAgentsDir + path.sep) || fullPath === normalizedAgentsDir;
}
```

**보안 평가**:
- ✅ `..` 경로 차단
- ✅ 절대 경로 차단
- ✅ `.md` 파일만 허용
- ✅ `.agents` 디렉토리 외부 접근 차단
- ✅ Path normalization 적용

**보안 품질**: 우수

### 3.5 민감값 노출 검사

#### 검사 결과

**하드코딩된 토큰 검사**:
```bash
rg -n "Bearer [a-f0-9]{32}" server/ client/
# 결과: 없음 ✅
```

**`/tmp/agent-control-center-token` 직접 읽기**:
```bash
rg -n "/tmp/agent-control-center-token" server/ client/
# 결과: server/src/index.ts (line 39, 43, 507) - 정상 사용 ✅
```

**정상 사용 사례**:
1. Line 39: 개발 모드 경고 메시지
2. Line 43: 토큰 파일 쓰기 (개발 모드)
3. Line 507: 서버 시작 메시지

**테스트 스크립트**:
- `test-reports-api.sh`: 토큰 파일 읽기 (테스트용) ✅
- `.agents/browser-visual-acceptance/capture-authenticated.cjs`: 브라우저 테스트용 ✅

**민감값 로그 출력 검사**:
```bash
rg -n "console\.log.*(?:PASSWORD|TOKEN|SECRET|API_KEY)" -i
# 결과:
# - scripts/prod-health-check.sh: console.log('NO_TOKEN') - 안전 ✅
# - .agents/browser-visual-acceptance/capture-authenticated.cjs: console.log('Token: loaded') - 값 노출 없음 ✅
```

**보안 평가**: 우수 (민감값 직접 노출 없음)

### 3.6 읽기 전용 정책 준수

#### API 엔드포인트 검토

**읽기 전용 엔드포인트** (✅):
- `GET /api/health` - 헬스 체크
- `GET /api/status` - 전체 상태 조회 (auth 필요)
- `GET /api/sessions` - 세션 목록 (auth 필요)
- `GET /api/agents` - 에이전트 목록 (auth 필요)
- `GET /api/metrics` - 메트릭 조회 (auth 필요)
- `GET /api/diagnostics` - 진단 정보 (auth 필요)
- `GET /api/reports` - 보고서 목록 (auth 필요)
- `GET /api/reports/:path(*)` - 보고서 내용 (auth 필요)

**쓰기 엔드포인트** (❌):
- 없음 ✅

**WebSocket 메시지 타입**:
- `ping` → `pong` (헬스 체크)
- `refresh` → `status_update` (상태 새로고침)
- 세션 시작/중지 명령 없음 ✅

**읽기 전용 정책 평가**: 완벽 준수

---

## 4. 알림 구현 검토

### 4.1 토스트 알림 (앱 내부) ✅

#### 현재 상태
- **구현 여부**: ✅ 구현 완료
- **담당**: Agent B

#### 구현 내용
1. **토스트 컴포넌트**: `client/src/App.tsx` 내 인라인 구현
   - 복사 성공 시 "클립보드에 복사됨" 표시
   - 2초 후 자동 사라짐
   - `fadeIn`/`fadeOut` 애니메이션

2. **사용 사례**:
   - ✅ 복사 성공: "클립보드에 복사됨"

3. **스타일**: `client/src/App.css`
   - 화면 하단 중앙 고정 위치
   - 반투명 배경 (`rgba(16, 185, 129, 0.95)`)

#### 향후 확장 가능
- 세션 새로고침 알림
- 연결 복구 알림
- 에러 알림

### 4.2 Web Notifications API (브라우저 알림)

#### 현재 상태
- **구현 여부**: 미구현
- **PWA 설정**: 없음
- **Service Worker**: 없음

#### Web Notifications API 지원 현황

**브라우저 지원**:
- Chrome/Edge: ✅ 지원
- Safari: ⚠️ 제한적 (macOS 13+, iOS 16.4+)
- Firefox: ✅ 지원

**필요 조건**:
1. **HTTPS 연결** (localhost는 예외)
2. **사용자 권한** (`Notification.requestPermission()`)
3. **Service Worker** (백그라운드 알림용)

#### 구현 계획 (향후 확장)

**Phase 1: 기본 알림** (PWA 없이 가능):
```typescript
// 권한 요청
if (Notification.permission === 'default') {
  await Notification.requestPermission();
}

// 알림 표시 (포그라운드만)
if (Notification.permission === 'granted') {
  new Notification('Agent Control Center', {
    body: 'Agent A가 작업을 완료했습니다.',
    icon: '/icon.svg',
    badge: '/badge.png',
  });
}
```

**Phase 2: Service Worker 알림** (백그라운드):
```typescript
// service-worker.js
self.addEventListener('push', (event) => {
  const data = event.data.json();
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: data.icon,
  });
});
```

**Phase 3: PWA 설정**:
```json
// public/manifest.json
{
  "name": "Agent Control Center",
  "short_name": "ACC",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#1a1a2e",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

```html
<!-- index.html -->
<link rel="manifest" href="/manifest.json" />
<meta name="apple-mobile-web-app-capable" content="yes" />
```

#### 보안 고려사항

**권한 요청 타이밍**:
- ❌ 페이지 로드 즉시 (사용자 거부율 높음)
- ✅ 명시적 사용자 액션 후 (설정 페이지에서 토글)

**알림 빈도 제한**:
- 동일 이벤트 중복 알림 방지
- 사용자가 알림 유형 선택 가능 (설정)

**프라이버시**:
- 알림 내용에 민감 정보 포함 금지
- 토큰/키 노출 금지

#### 현재 상태 진단

**긍정적 요소**:
- ✅ `index.html`에 `apple-mobile-web-app-capable` 이미 설정됨
- ✅ `theme-color` 메타 태그 존재

**부족한 요소**:
- ❌ `manifest.json` 없음
- ❌ Service Worker 없음
- ❌ 아이콘 파일 (192x192, 512x512) 없음
- ❌ 프로덕션 환경 HTTPS 설정 불명확

#### 권장사항

**단기** (토스트 알림 구현 후):
1. PWA manifest.json 생성
2. 아이콘 생성 (192x192, 512x512)
3. Service Worker 기본 구조 작성

**중기** (PWA 설정 완료 후):
1. Web Notifications API 기본 구현
2. 설정 페이지에 알림 토글 추가
3. 알림 권한 요청 플로우 구현

**장기** (프로덕션 배포 후):
1. Push Notification 서버 구현
2. 백그라운드 알림 지원
3. 알림 우선순위 및 필터링

---

## 5. 코드 정적 분석

### 5.1 하드코딩된 토큰 검사

#### 검사 명령
```bash
rg -n "Bearer [a-f0-9]{32}" server/ client/
rg -n "sk-ant-|sk-proj-" server/ client/
```

#### 결과
- 하드코딩된 Bearer 토큰: 없음 ✅
- 하드코딩된 API 키: 없음 ✅

### 5.2 민감값 로그 출력 검사

#### 검사 명령
```bash
rg -n "console\.log.*(?:PASSWORD|TOKEN|SECRET|API_KEY)" -i
```

#### 결과
1. `scripts/prod-health-check.sh:78`
   ```javascript
   if (!token) { console.log('NO_TOKEN'); process.exit(1); }
   ```
   - 평가: 안전 (토큰 값 출력 없음)

2. `.agents/browser-visual-acceptance/capture-authenticated.cjs:27`
   ```javascript
   console.log('Token: loaded');
   ```
   - 평가: 안전 (토큰 값 출력 없음)

**종합 평가**: 민감값 직접 출력 없음 ✅

### 5.3 환경변수 하드코딩 검사

#### 검사 대상
- `process.env.AUTH_TOKEN`
- `process.env.CORS_ORIGIN`
- `process.env.PORT`
- `process.env.NODE_ENV`

#### 결과
모든 환경변수는 런타임에서 읽어오며, 하드코딩 없음 ✅

---

## 6. 테스트 시나리오 (검증 완료)

### 6.1 Redaction 테스트 ✅
```bash
npm run test:redact  # ✅ 23/23 통과
```

**결과**:
- 환경변수 패턴 마스킹: ✅ PASS
- 헤더 패턴 마스킹: ✅ PASS
- URL 쿼리 파라미터 마스킹: ✅ PASS
- 객체 마스킹: ✅ PASS

### 6.2 Smoke 테스트
```bash
./smoke-test.sh
```

**검증 항목**:
1. 서버 응답 (`/api/health`)
2. 인증 필수 엔드포인트 (`/api/status`)
3. WebSocket 연결
4. Rate limiting

### 6.3 Reports API 테스트
```bash
./test-reports-api.sh
```

**검증 항목**:
1. 보고서 목록 조회
2. 특정 보고서 읽기
3. Path traversal 방어
4. 인증 검증

---

## 7. 프로덕션 배포 체크리스트

### 7.1 필수 환경변수
- [ ] `AUTH_TOKEN` 설정 (32자 이상 hex 권장)
- [ ] `CORS_ORIGIN` 설정 (허용할 도메인)
- [ ] `NODE_ENV=production`
- [ ] `PORT` (선택, 기본 9876)

### 7.2 보안 설정
- [ ] HTTPS 적용 (Let's Encrypt 권장)
- [ ] 방화벽 규칙 (포트 9876만 열기)
- [ ] Rate limiting 모니터링
- [ ] 로그 로테이션 설정

### 7.3 모니터링
- [ ] 헬스 체크 엔드포인트 모니터링 (`/api/health`)
- [ ] 에러 로그 알림 설정
- [ ] WebSocket 연결 실패 알림
- [ ] 디스크 사용량 모니터링 (`.agents` 디렉토리)

---

## 8. 결론

### 8.1 보안 평가

**종합 등급**: A- (우수)

**강점**:
1. ✅ AUTH_TOKEN 강제 (프로덕션)
2. ✅ 읽기 전용 API 설계
3. ✅ Path traversal 방어
4. ✅ Rate limiting 구현
5. ✅ 민감값 마스킹 (redaction)
6. ✅ 토큰 콘솔 노출 없음

**향후 개선 권장** (비차단):
1. ⚠️ Timing attack 방어 (constant-time comparison)
2. ⚠️ CORS_ORIGIN 프로덕션 필수 설정
3. ⚠️ `/tmp/agent-control-center-token` 파일 권한 (0600)

**해결됨**:
- ✅ TypeScript 컴파일 오류 수정 (needsReview 필드 추가 완료)

### 8.2 알림 로드맵

**Phase 1: 토스트 알림** (Agent B 작업):
- 복사 성공 알림
- 연결 상태 알림
- 에러 알림

**Phase 2: PWA 기본 설정**:
- manifest.json 생성
- 아이콘 추가
- Service Worker 등록

**Phase 3: Web Notifications**:
- 권한 요청 플로우
- 포그라운드 알림
- 백그라운드 알림 (선택)

### 8.3 조치 상태 요약

**해결됨** ✅:
1. ✅ `needsReview` 필드 추가 (claude-monitor.ts, codex-monitor.ts)
2. ✅ 토스트 알림 컴포넌트 구현 완료

**향후 개선 권장** (비차단):
1. Timing attack 방어 (auth.ts) - 보안 강화
2. CORS_ORIGIN 프로덕션 필수 (index.ts) - 보안 강화
3. PWA manifest.json 작성 - Web Notifications 준비
4. Service Worker 기본 구조 - 오프라인 지원

---

## 9. 첨부자료

### 9.1 검증 명령어
```bash
# 하드코딩된 토큰 검사
rg -n "Bearer [a-f0-9]{32}" server/ client/

# /tmp/agent-control-center-token 직접 읽기 검사
rg -n "/tmp/agent-control-center-token" server/ client/

# 민감값 로그 출력 검사
rg -n "console\.log.*(?:PASSWORD|TOKEN|SECRET|API_KEY)" -i server/ client/

# 빌드 테스트
npm run build

# 전체 테스트
npm test
```

### 9.2 참고 파일 경로
- 서버 엔트리: `/Users/zhluv/Projects/agent-control-center/server/src/index.ts`
- 인증 미들웨어: `/Users/zhluv/Projects/agent-control-center/server/src/auth.ts`
- Redaction 로직: `/Users/zhluv/Projects/agent-control-center/server/src/redact.ts`
- Redaction 테스트: `/Users/zhluv/Projects/agent-control-center/server/src/redact.test.ts`
- 클라이언트 앱: `/Users/zhluv/Projects/agent-control-center/client/src/App.tsx`

---

**보고서 끝**
