import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { ClaudeController } from './claude-controller.js';
import { AuthMiddleware } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 9876;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'change-this-token';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client/dist')));

// Auth middleware for API routes
const auth = new AuthMiddleware(AUTH_TOKEN);

// Claude Controller instance
const claude = new ClaudeController();

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

// WebSocket connection handler
wss.on('connection', (ws, req) => {
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
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      agents: claude.getAgents(),
      sessions: claude.getSessions(),
      metrics: claude.getMetrics()
    }
  }));

  ws.on('message', async (message) => {
    try {
      const { type, payload } = JSON.parse(message.toString());

      switch (type) {
        case 'command':
          // Send command to Claude
          const result = await claude.sendCommand(payload.sessionId, payload.command);
          ws.send(JSON.stringify({ type: 'command_result', data: result }));
          break;

        case 'start_session':
          // Start new Claude session
          const session = await claude.startSession(payload);
          broadcast({ type: 'session_started', data: session });
          break;

        case 'stop_session':
          // Stop a session
          await claude.stopSession(payload.sessionId);
          broadcast({ type: 'session_stopped', data: { sessionId: payload.sessionId } });
          break;

        case 'refresh':
          // Refresh agent status
          const status = await claude.refreshStatus();
          ws.send(JSON.stringify({ type: 'status', data: status }));
          break;
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

app.get('/api/status', auth.verify, async (req, res) => {
  try {
    const status = await claude.refreshStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/command', auth.verify, async (req, res) => {
  try {
    const { sessionId, command } = req.body;
    const result = await claude.sendCommand(sessionId, command);
    broadcast({ type: 'command_sent', data: { sessionId, command } });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/session/start', auth.verify, async (req, res) => {
  try {
    const session = await claude.startSession(req.body);
    broadcast({ type: 'session_started', data: session });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/session/:id/stop', auth.verify, async (req, res) => {
  try {
    await claude.stopSession(req.params.id);
    broadcast({ type: 'session_stopped', data: { sessionId: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions', auth.verify, (req, res) => {
  res.json(claude.getSessions());
});

app.get('/api/agents', auth.verify, (req, res) => {
  res.json(claude.getAgents());
});

app.get('/api/metrics', auth.verify, (req, res) => {
  res.json(claude.getMetrics());
});

// Serve client app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// Start periodic status updates
setInterval(async () => {
  try {
    const status = await claude.refreshStatus();
    broadcast({ type: 'status_update', data: status });
  } catch (err) {
    console.error('Status refresh error:', err);
  }
}, 3000); // Every 3 seconds

// Start server
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       Agent Control Center is running!               ║
║                                                      ║
║   Local:   http://localhost:${PORT}                   ║
║   Network: Check your Tailscale IP                   ║
║                                                      ║
║   Auth Token: ${AUTH_TOKEN.substring(0, 8)}...                          ║
╚══════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close();
  process.exit(0);
});
