import { spawn, ChildProcess, execSync } from 'child_process';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AgentInfo {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'waiting';
  currentTask?: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost: number;
  startedAt: Date;
}

export interface SessionInfo {
  id: string;
  workingDir: string;
  agents: AgentInfo[];
  status: 'active' | 'paused' | 'stopped';
  createdAt: Date;
  lastActivity: Date;
}

export interface SessionStartOptions {
  workingDir?: string;
  agent?: string;
  prompt?: string;
  model?: 'opus' | 'sonnet' | 'haiku';
}

export class ClaudeController extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private outputBuffers: Map<string, string> = new Map();
  private claudeHome = path.join(os.homedir(), '.claude');

  constructor() {
    super();
    this.loadExistingSessions();
  }

  private loadExistingSessions() {
    // Check for existing Claude daemon sessions
    const daemonDir = path.join(this.claudeHome, 'daemon');
    if (fs.existsSync(daemonDir)) {
      try {
        const files = fs.readdirSync(daemonDir);
        console.log(`Found ${files.length} potential daemon files`);
      } catch (err) {
        console.error('Error reading daemon directory:', err);
      }
    }
  }

  async startSession(options: SessionStartOptions): Promise<SessionInfo> {
    const sessionId = uuid();
    const workingDir = options.workingDir || os.homedir();

    // Build claude command
    const args: string[] = ['--verbose'];

    if (options.agent) {
      args.push('--agent', options.agent);
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    // Create session info
    const session: SessionInfo = {
      id: sessionId,
      workingDir,
      agents: [],
      status: 'active',
      createdAt: new Date(),
      lastActivity: new Date()
    };

    // Start Claude process
    const proc = spawn('claude', args, {
      cwd: workingDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.processes.set(sessionId, proc);
    this.outputBuffers.set(sessionId, '');
    this.sessions.set(sessionId, session);

    // Handle stdout
    proc.stdout?.on('data', (data) => {
      const output = data.toString();
      this.outputBuffers.set(
        sessionId,
        (this.outputBuffers.get(sessionId) || '') + output
      );
      this.parseOutput(sessionId, output);
      session.lastActivity = new Date();
      this.emit('output', { sessionId, output });
    });

    // Handle stderr
    proc.stderr?.on('data', (data) => {
      const output = data.toString();
      this.emit('error', { sessionId, error: output });
    });

    // Handle process exit
    proc.on('exit', (code) => {
      session.status = 'stopped';
      this.emit('session_ended', { sessionId, code });
    });

    // Send initial prompt if provided
    if (options.prompt) {
      await this.sendCommand(sessionId, options.prompt);
    }

    return session;
  }

  async sendCommand(sessionId: string, command: string): Promise<{ success: boolean; message?: string }> {
    const proc = this.processes.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (!proc || !session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    if (!proc.stdin?.writable) {
      throw new Error('Session stdin is not writable');
    }

    // Write command to Claude's stdin
    proc.stdin.write(command + '\n');
    session.lastActivity = new Date();

    return { success: true, message: 'Command sent' };
  }

  async stopSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    const session = this.sessions.get(sessionId);

    if (proc) {
      // Send exit command gracefully
      proc.stdin?.write('/exit\n');

      // Wait a bit then force kill if needed
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
        }
      }, 3000);
    }

    if (session) {
      session.status = 'stopped';
    }

    this.processes.delete(sessionId);
  }

  private parseOutput(sessionId: string, output: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Parse agent creation
    const agentMatch = output.match(/Spawning agent: (\w+)/);
    if (agentMatch) {
      const agent: AgentInfo = {
        id: uuid(),
        name: agentMatch[1],
        status: 'working',
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        startedAt: new Date()
      };
      session.agents.push(agent);
      this.emit('agent_spawned', { sessionId, agent });
    }

    // Parse token usage
    const tokenMatch = output.match(/Tokens: (\d+) input, (\d+) output/);
    if (tokenMatch && session.agents.length > 0) {
      const lastAgent = session.agents[session.agents.length - 1];
      lastAgent.tokens.input = parseInt(tokenMatch[1]);
      lastAgent.tokens.output = parseInt(tokenMatch[2]);
    }

    // Parse cost
    const costMatch = output.match(/Cost: \$(\d+\.?\d*)/);
    if (costMatch && session.agents.length > 0) {
      const lastAgent = session.agents[session.agents.length - 1];
      lastAgent.cost = parseFloat(costMatch[1]);
    }

    // Parse task status
    if (output.includes('Task completed') || output.includes('Done')) {
      if (session.agents.length > 0) {
        session.agents[session.agents.length - 1].status = 'idle';
      }
    }
  }

  async refreshStatus(): Promise<{
    sessions: SessionInfo[];
    agents: AgentInfo[];
    metrics: ReturnType<typeof this.getMetrics>;
  }> {
    // Try to get status from claude daemon
    try {
      const statusOutput = execSync('claude status 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 5000
      });
      this.parseStatusOutput(statusOutput);
    } catch {
      // Claude might not be running or doesn't support status command
    }

    return {
      sessions: this.getSessions(),
      agents: this.getAgents(),
      metrics: this.getMetrics()
    };
  }

  private parseStatusOutput(output: string) {
    // Parse claude status output and update session info
    // Format depends on Claude CLI version
    console.log('Status output:', output);
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  getAgents(): AgentInfo[] {
    const agents: AgentInfo[] = [];
    this.sessions.forEach(session => {
      agents.push(...session.agents);
    });
    return agents;
  }

  getMetrics() {
    const agents = this.getAgents();
    const totalTokens = agents.reduce((sum, a) => ({
      input: sum.input + a.tokens.input,
      output: sum.output + a.tokens.output,
      cacheRead: sum.cacheRead + a.tokens.cacheRead,
      cacheWrite: sum.cacheWrite + a.tokens.cacheWrite
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

    const totalCost = agents.reduce((sum, a) => sum + a.cost, 0);
    const cacheHitRate = totalTokens.input > 0
      ? (totalTokens.cacheRead / (totalTokens.input + totalTokens.cacheRead)) * 100
      : 0;

    return {
      totalTokens,
      totalCost,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      activeAgents: agents.filter(a => a.status === 'working').length,
      totalAgents: agents.length,
      activeSessions: this.sessions.size
    };
  }

  getOutput(sessionId: string): string {
    return this.outputBuffers.get(sessionId) || '';
  }
}
