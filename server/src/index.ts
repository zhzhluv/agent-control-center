import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { ClaudeMonitor } from './claude-monitor.js';
import { CodexMonitor } from './codex-monitor.js';
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
const RATE_LIMIT_MAX = IS_PRODUCTION ? 30 : 100;  // 프로덕션: 30회, 개발: 100회

// Auth middleware for API routes
const auth = new AuthMiddleware(AUTH_TOKEN);

// Claude Monitor instance (파일 워칭 기반)
const claudeMonitor = new ClaudeMonitor();

// Codex Monitor instance
const codexMonitor = new CodexMonitor();

// Store connected clients
const clients = new Set<WebSocket>();

// Helper function to merge status from both monitors
function getMergedStatus() {
  const claudeStatus = claudeMonitor.getStatus();
  const codexStatus = codexMonitor.getStatus();

  // Merge agents and sessions
  const allAgents = [...claudeStatus.agents, ...codexStatus.agents];
  const allSessions = [...claudeStatus.sessions, ...codexStatus.sessions];

  // Merge projects (group by projectPath)
  const projectsMap = new Map();

  allSessions.forEach(session => {
    const projectPath = session.projectPath;

    if (!projectsMap.has(projectPath)) {
      projectsMap.set(projectPath, {
        path: projectPath,
        name: getProjectName(projectPath),
        sessions: [],
        lastActivity: session.lastActivity,
      });
    }

    const project = projectsMap.get(projectPath);
    project.sessions.push(session);

    if (session.lastActivity > project.lastActivity) {
      project.lastActivity = session.lastActivity;
    }
  });

  const projects = Array.from(projectsMap.values());

  // Merge metrics
  const totalTokens = allAgents.reduce((sum, a) => ({
    input: sum.input + a.tokens.input,
    output: sum.output + a.tokens.output,
    cacheRead: sum.cacheRead + a.tokens.cacheRead,
    cacheWrite: sum.cacheWrite + a.tokens.cacheWrite,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

  const totalCost = allAgents.reduce((sum, a) => sum + a.cost, 0);

  return {
    agents: allAgents,
    sessions: allSessions,
    projects,
    metrics: {
      totalTokens,
      totalCost,
      cacheHitRate: 0,
      activeAgents: allAgents.filter(a => a.status === 'working').length,
      totalAgents: allAgents.length,
      activeSessions: allSessions.filter(s => s.state === 'active').length,
      idleSessions: allSessions.filter(s => s.state === 'idle').length,
      staleSessions: allSessions.filter(s => s.state === 'stale').length,
      totalSessions: allSessions.length,
      totalProjects: projects.length,
    }
  };
}

function getProjectName(projectPath: string): string {
  if (!projectPath || projectPath.startsWith('(project:')) {
    return projectPath;
  }
  const parts = projectPath.split('/');
  return parts[parts.length - 1] || projectPath;
}

// Server start time for uptime calculation
const SERVER_START_TIME = new Date();

// Track connection statistics
// Note: lastClientMessageAt tracks when server received messages FROM clients (client→server)
const connectionStats = {
  lastConnected: null as Date | null,
  lastClientMessageAt: null as Date | null,  // renamed for clarity: client→server message timestamp
  totalConnections: 0,
  totalMessages: 0,
};

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
claudeMonitor.on('status_update', () => {
  broadcast({ type: 'status_update', data: getMergedStatus() });
});

claudeMonitor.on('agent_updated', (agent) => {
  broadcast({ type: 'agent_updated', data: agent });
});

claudeMonitor.on('session_updated', (session) => {
  broadcast({ type: 'session_updated', data: session });
});

// Codex Monitor 이벤트 연결
codexMonitor.on('status_update', () => {
  broadcast({ type: 'status_update', data: getMergedStatus() });
});

codexMonitor.on('agent_updated', (agent) => {
  broadcast({ type: 'agent_updated', data: agent });
});

codexMonitor.on('session_updated', (session) => {
  broadcast({ type: 'session_updated', data: session });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';

  // 개발 모드에서는 localhost rate limiting 비활성화
  const isLocalhost = clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1';
  const skipRateLimit = !IS_PRODUCTION && isLocalhost;

  if (!skipRateLimit) {
    // Rate limiting check (프로덕션 또는 외부 IP)
    const now = Date.now();
    const attempts = connectionAttempts.get(clientIp);

    if (attempts) {
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

  // Update connection statistics
  connectionStats.lastConnected = new Date();
  connectionStats.totalConnections++;

  // Send current state (merged from both monitors)
  const status = getMergedStatus();
  ws.send(JSON.stringify({
    type: 'init',
    data: status
  }));

  ws.on('message', async (message) => {
    try {
      connectionStats.lastClientMessageAt = new Date();
      connectionStats.totalMessages++;

      const { type, payload } = JSON.parse(message.toString());

      switch (type) {
        case 'ping':
          // Respond to heartbeat ping with pong
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'refresh':
          // 상태 새로고침 (status_update로 응답하여 클라이언트 핸들러와 일치)
          const currentStatus = getMergedStatus();
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
  res.json(getMergedStatus());
});

app.get('/api/sessions', auth.verify, (req, res) => {
  const claudeSessions = claudeMonitor.getSessions();
  const codexSessions = codexMonitor.getSessions();
  res.json([...claudeSessions, ...codexSessions]);
});

app.get('/api/agents', auth.verify, (req, res) => {
  const claudeAgents = claudeMonitor.getAgents();
  const codexAgents = codexMonitor.getAgents();
  res.json([...claudeAgents, ...codexAgents]);
});

app.get('/api/metrics', auth.verify, (req, res) => {
  res.json(getMergedStatus().metrics);
});

// Update review state for an agent
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

// Helper: count .md files in .agents directory
function countReports(): number {
  try {
    if (!existsSync(AGENTS_DIR)) return 0;

    let count = 0;
    function scan(dir: string) {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath);
        } else if (stat.isFile() && entry.endsWith('.md')) {
          count++;
        }
      }
    }
    scan(AGENTS_DIR);
    return count;
  } catch {
    return 0;
  }
}

// Diagnostics API
app.get('/api/diagnostics', auth.verify, (req, res) => {
  const status = getMergedStatus();
  const uptime = process.uptime();

  // Count watched projects (unique project paths from sessions)
  const watchedProjects = new Set(
    status.sessions.map(session => session.projectPath)
  ).size;

  // Count total events (sum of recent activity across all agents)
  const totalEvents = status.agents.reduce(
    (sum, agent) => sum + (agent.recentActivity?.length || 0),
    0
  );

  // Count actual reports in .agents directory
  const reportsCount = countReports();

  res.json({
    uptime,
    startTime: SERVER_START_TIME.toISOString(),
    activeSessions: status.metrics.activeSessions,
    totalSessions: status.sessions.length,
    activeAgents: status.metrics.activeAgents,
    totalAgents: status.metrics.totalAgents,
    watchedProjects,
    totalEvents,
    reportsCount,
    clientVersion: '1.0.0',
    connectionStats: {
      activeConnections: clients.size,
      lastConnected: connectionStats.lastConnected?.toISOString() || null,
      // Note: This is when server last received a message FROM a client (client→server)
      lastClientMessageAt: connectionStats.lastClientMessageAt?.toISOString() || null,
      totalConnections: connectionStats.totalConnections,
      totalMessages: connectionStats.totalMessages,
    },
  });
});

// Reports API
const AGENTS_DIR = path.join(__dirname, '../../.agents');

// Security: validate path to prevent directory traversal
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

// GET /api/reports - list all .md files in .agents directory
app.get('/api/reports', auth.verify, (req, res) => {
  try {
    if (!existsSync(AGENTS_DIR)) {
      return res.json({ reports: [] });
    }

    const reports: Array<{ path: string; name: string; size: number; modified: string }> = [];

    function scanDirectory(dir: string, prefix: string = '') {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = statSync(fullPath);
        const relativePath = path.join(prefix, entry);

        if (stat.isDirectory()) {
          scanDirectory(fullPath, relativePath);
        } else if (stat.isFile() && entry.endsWith('.md')) {
          reports.push({
            path: relativePath,
            name: entry,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        }
      }
    }

    scanDirectory(AGENTS_DIR);

    // Sort by modified date (newest first)
    reports.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    res.json({ reports });
  } catch (err) {
    console.error('Error listing reports:', err);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// GET /api/reports/:path - get content of specific report
app.get('/api/reports/:path(*)', auth.verify, (req, res) => {
  try {
    const relativePath = req.params.path;

    // Security validation
    if (!isValidReportPath(relativePath)) {
      return res.status(403).json({ error: 'Invalid report path' });
    }

    const fullPath = path.join(AGENTS_DIR, relativePath);

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      return res.status(403).json({ error: 'Not a file' });
    }

    const content = readFileSync(fullPath, 'utf-8');

    res.json({
      path: relativePath,
      content,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    });
  } catch (err) {
    console.error('Error reading report:', err);
    res.status(500).json({ error: 'Failed to read report' });
  }
});

// Serve client app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// Start server and monitors
async function start() {
  // Claude 모니터링 시작
  await claudeMonitor.start();

  // Codex 모니터링 시작
  await codexMonitor.start();

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════╗
║       Agent Control Center is running!               ║
║                                                      ║
║   Local:   http://localhost:${PORT}                   ║
║   Network: Check your Tailscale IP                   ║
║                                                      ║
║   Mode: MONITORING (Claude + Codex)                  ║
║   Watching: ~/.claude/ and ~/.codex/                 ║
║   Auth:  ${IS_PRODUCTION ? 'Production (token required)' : 'Development (see /tmp/agent-control-center-token)'}
╚══════════════════════════════════════════════════════╝
    `);
  });
}

start().catch(console.error);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  claudeMonitor.stop();
  codexMonitor.stop();
  server.close();
  process.exit(0);
});
