import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ClaudeMonitor } from './claude-monitor.js';
import { AuthMiddleware } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 9876;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// 보안: AUTH_TOKEN 정책
// - production: AUTH_TOKEN 필수, 미설정 시 서버 시작 실패
// - development: 미설정 시 임시 토큰 생성 (로그에 노출하지 않음)
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
    // 파일로만 토큰 전달 (콘솔 노출 금지)
    try {
      writeFileSync('/tmp/agent-control-center-token', AUTH_TOKEN);
    } catch {
      console.warn('   Could not write token file. Check /tmp permissions.');
    }
  }
}

// 보안: 프로덕션에서 CORS 제한 권장
const corsOptions = NODE_ENV === 'production' ? {
  origin: process.env.CORS_ORIGIN || false,  // 프로덕션에서는 명시적 설정 필요
} : {};

if (NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.warn('⚠️  WARNING: CORS_ORIGIN not set in production mode.');
  console.warn('   Set CORS_ORIGIN to restrict cross-origin requests.\n');
}

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Rate limiting: IP별 연결 추적
const connectionAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW = 60000;  // 1분
const RATE_LIMIT_MAX = 10;         // 1분에 10회 연결 시도

// Auth middleware for API routes
const auth = new AuthMiddleware(AUTH_TOKEN);

// Claude Monitor instance (파일 워칭 기반)
const monitor = new ClaudeMonitor();

// Store connected clients
const clients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(data: object) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Monitor 이벤트 연결
monitor.on('status_update', (status) => {
  broadcast({ type: 'status_update', data: status });
});

monitor.on('agent_updated', (agent) => {
  broadcast({ type: 'agent_updated', data: agent });
});

monitor.on('session_updated', (session) => {
  broadcast({ type: 'session_updated', data: session });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  // Rate limiting check
  const clientIp = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const attempts = connectionAttempts.get(clientIp);

  if (attempts) {
    // 윈도우 리셋
    if (now - attempts.lastAttempt > RATE_LIMIT_WINDOW) {
      connectionAttempts.set(clientIp, { count: 1, lastAttempt: now });
    } else if (attempts.count >= RATE_LIMIT_MAX) {
      console.warn(`Rate limited: ${clientIp}`);
      ws.close(4029, 'Too Many Requests');
      return;
    } else {
      attempts.count++;
      attempts.lastAttempt = now;
    }
  } else {
    connectionAttempts.set(clientIp, { count: 1, lastAttempt: now });
  }

  // Simple token auth via query param
  const url = new URL(req.url || '', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (token !== AUTH_TOKEN) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log('Client connected');
  clients.add(ws);

  // Send current state
  const status = monitor.getStatus();
  ws.send(JSON.stringify({
    type: 'init',
    data: status
  }));

  ws.on('message', async (message) => {
    try {
      const { type, payload } = JSON.parse(message.toString());

      switch (type) {
        case 'refresh':
          // 상태 새로고침 (status_update로 응답하여 클라이언트 핸들러와 일치)
          const currentStatus = monitor.getStatus();
          ws.send(JSON.stringify({ type: 'status_update', data: currentStatus }));
          break;

        // 참고: 세션 시작/중지는 터미널에서 직접 수행
        // 여기서는 모니터링만 담당
      }
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: (err as Error).message }
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });
});

// REST API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/status', auth.verify, (req, res) => {
  res.json(monitor.getStatus());
});

app.get('/api/sessions', auth.verify, (req, res) => {
  res.json(monitor.getSessions());
});

app.get('/api/agents', auth.verify, (req, res) => {
  res.json(monitor.getAgents());
});

app.get('/api/metrics', auth.verify, (req, res) => {
  res.json(monitor.getStatus().metrics);
});

// Serve client app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// Start server and monitor
async function start() {
  // Claude 모니터링 시작
  await monitor.start();

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       Agent Control Center is running!               ║
║                                                      ║
║   Local:   http://localhost:${PORT}                   ║
║   Network: Check your Tailscale IP                   ║
║                                                      ║
║   Mode: MONITORING (watching ~/.claude/)             ║
║   Auth:  ${IS_PRODUCTION ? 'Production (token required)' : 'Development (see /tmp/agent-control-center-token)'}
╚══════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  monitor.stop();
  server.close();
  process.exit(0);
});
