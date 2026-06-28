# Agent Control Center

맥미니에서 Claude 에이전트를 실행하고, 아이패드에서 원격으로 모니터링/컨트롤하는 시스템

## 주요 기능

- 🖥️ **실시간 대시보드** - 에이전트 상태, 토큰, 비용 모니터링
- 💬 **원격 명령** - 아이패드에서 프롬프트 전송
- 📋 **세션 관리** - 새 작업 시작/중단
- 🔐 **보안 연결** - 토큰 인증 + Tailscale VPN

## 빠른 시작 (맥미니)

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/agent-control-center/main/scripts/setup-mac.sh | bash
```

## 수동 설치

### 요구사항

- macOS (Apple Silicon 또는 Intel)
- Node.js 20+
- Claude CLI

### 설치

```bash
# 1. 저장소 클론
git clone https://github.com/YOUR_USERNAME/agent-control-center.git
cd agent-control-center

# 2. 의존성 설치
npm run setup

# 3. 빌드
npm run build

# 4. 환경변수 설정
echo "AUTH_TOKEN=$(openssl rand -hex 16)" > .env
echo "PORT=9876" >> .env

# 5. 실행
npm start
```

## 원격 접속 설정

### Tailscale 사용 (권장)

1. 맥미니와 아이패드에 Tailscale 설치
2. 같은 계정으로 로그인
3. 맥미니 Tailscale IP 확인: `tailscale ip`
4. 아이패드 Safari에서 `http://<IP>:9876` 접속

## 개발

```bash
# 개발 서버 실행
npm run dev
```

## 구조

```
├── server/          # Express + WebSocket 백엔드
│   └── src/
│       ├── index.ts              # 메인 서버
│       ├── claude-controller.ts  # Claude CLI 연동
│       └── auth.ts               # 인증
├── client/          # React 프론트엔드
│   └── src/
│       ├── App.tsx   # 메인 앱
│       └── App.css   # 스타일
└── scripts/         # 설치 스크립트
```

## API

### WebSocket

```javascript
// 연결
const ws = new WebSocket('ws://localhost:9876?token=YOUR_TOKEN')

// 명령 전송
ws.send(JSON.stringify({
  type: 'command',
  payload: { command: '테스트 파일 만들어줘' }
}))

// 새 세션 시작
ws.send(JSON.stringify({
  type: 'start_session',
  payload: { workingDir: '/path/to/project' }
}))
```

### REST API

```bash
# 상태 확인
curl -H "Authorization: Bearer TOKEN" http://localhost:9876/api/status

# 명령 전송
curl -X POST -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "hello"}' \
  http://localhost:9876/api/command
```

## 라이선스

MIT
