# Agent Control Center

Mac Mini에서 실행 중인 Claude Code 세션을 iPad에서 **읽기 전용**으로 모니터링하는 시스템.

> **참고**: 현재 `~/.claude/` 디렉토리 모니터링만 지원. Codex 세션 지원은 후속 버전 예정.

> **읽기 전용 모니터링 전용** - 원격 명령 실행, 세션 시작/중지 기능은 포함되지 않음.

## 주요 기능

- **실시간 대시보드** - 에이전트 상태, 토큰 사용량, 비용 모니터링
- **프로젝트별 세션 뷰** - Claude가 작업 중인 프로젝트 시각화
- **Pixel Office** - 에이전트 활동을 시각적으로 표현
- **Runtime Stability** - WebSocket heartbeat, 자동 재연결, 지수 백오프
- **Diagnostics Panel** - 서버 상태, 연결 통계, 오래된 세션 감지
- **Reports API** - `.agents/` 폴더의 마크다운 보고서 열람
- **보안 연결** - AUTH_TOKEN 인증 + Tailscale VPN 전제

## 운영 전제

이 시스템은 다음 환경을 전제로 설계됨:

1. **Tailscale VPN**: Mac Mini와 iPad가 같은 Tailscale 네트워크에 연결
2. **AUTH_TOKEN**: 환경변수로 설정된 인증 토큰 필수
3. **로컬 Claude 세션**: 터미널/VSCode/Cursor에서 직접 실행한 Claude Code (Codex 지원 예정)

## 설치

### 요구사항

- macOS (Apple Silicon 또는 Intel)
- Node.js 20+
- Claude CLI (터미널에서 `claude` 명령 사용 가능)
- Tailscale (원격 접속용)

### 설치 방법

```bash
# 1. 저장소 클론
git clone https://github.com/zhzhluv/agent-control-center.git
cd agent-control-center

# 2. 의존성 설치
npm run setup

# 3. 빌드
npm run build

# 4. 환경변수 설정 (프로덕션 필수)
export AUTH_TOKEN=$(openssl rand -hex 16)
export NODE_ENV=production

# 5. 실행
npm start
```

## 원격 접속 설정

### Tailscale 사용

1. Mac Mini와 iPad에 Tailscale 설치
2. 같은 계정으로 로그인
3. Mac Mini Tailscale IP 확인: `tailscale ip`
4. iPad Safari에서 `http://<TAILSCALE_IP>:9876` 접속
5. AUTH_TOKEN 입력하여 인증

## 환경변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `AUTH_TOKEN` | 프로덕션 필수 | 인증 토큰. 미설정 시 프로덕션에서 서버 시작 실패 |
| `PORT` | 선택 | 서버 포트 (기본: 9876) |
| `NODE_ENV` | 선택 | `production` 또는 `development` |
| `CORS_ORIGIN` | 선택 | 프로덕션에서 CORS 허용 origin |

## 개발 모드

```bash
# 개발 서버 실행 (임시 토큰 자동 생성)
npm run dev

# 토큰 확인
cat /tmp/agent-control-center-token
```

## 구조

```
├── server/          # Express + WebSocket 백엔드
│   └── src/
│       ├── index.ts           # 메인 서버
│       ├── claude-monitor.ts  # Claude 세션 파일 감시
│       └── auth.ts            # 인증
├── client/          # React 프론트엔드
│   └── src/
│       ├── App.tsx                    # 메인 앱
│       └── components/PixelOffice.tsx # 픽셀 오피스 시각화
└── .agents/         # 작업 보고서
```

## API (읽기 전용)

### WebSocket 이벤트

```javascript
// 연결
const ws = new WebSocket('ws://localhost:9876?token=YOUR_TOKEN')

// 서버에서 받는 이벤트
// - init: 초기 상태
// - status_update: 전체 상태 업데이트
// - agent_updated: 개별 에이전트 업데이트
// - session_updated: 개별 세션 업데이트
// - pong: heartbeat 응답
// - error: 오류

// 클라이언트에서 보내는 이벤트
// - ping: heartbeat (30초 간격)
// - refresh: 상태 새로고침 요청

// Close codes
// - 4001: Unauthorized (토큰 무효)
// - 4029: Too Many Requests (rate limit)
```

### REST API

```bash
# 헬스체크 (인증 불필요)
curl http://localhost:9876/api/health

# 상태 확인
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/status

# 메트릭스
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/metrics

# 진단 정보
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/diagnostics

# 에이전트 목록
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/agents

# 세션 목록
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/sessions

# 보고서 목록
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/reports

# 보고서 내용
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/reports/ops-runtime-stability/agent-d-qa-report.md
```

## 테스트

```bash
# 전체 테스트 (빌드 + 스모크 테스트 + API 테스트)
npm test

# 스모크 테스트만
npm run test:smoke

# Reports API 보안 테스트만
npm run test:reports
```

테스트 상세 문서: [TESTING.md](./TESTING.md)

## 보안 원칙

- **토큰 비노출**: 인증 토큰은 로그, 보고서, 테스트 출력에 절대 노출되지 않음
- **개발 모드**: 임시 토큰이 `/tmp/agent-control-center-token`에 저장됨 (프로덕션에서는 환경변수 필수)
- **인증 필수**: `/api/health` 외 모든 엔드포인트는 Bearer 토큰 인증 필요
- **경로 보호**: Reports API는 path traversal 공격 차단

## 라이선스

MIT
