import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import readline from 'readline';

// 최근 활동 기록
export interface ActivityLog {
  timestamp: Date;
  type: 'tool_use' | 'message' | 'result';
  tool?: string;
  summary: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: 'idle' | 'working' | 'waiting';
  agentType: 'main' | 'sub';           // 메인 vs 서브에이전트
  currentTask?: string;                 // 짧은 요약 (UI 표시용)
  currentTaskFull?: string;             // 전체 내용 (툴팁/상세용)
  recentTools: string[];                // 최근 사용한 도구들
  recentActivity: ActivityLog[];        // 최근 활동 로그
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost: number;
  lastActivity: Date;
  projectPath: string;
  sessionId: string;
}

export interface ProjectInfo {
  path: string;
  name: string;
  sessions: SessionInfo[];
  lastActivity: Date;
}

export interface SessionInfo {
  id: string;
  projectPath: string;
  agents: AgentInfo[];
  isActive: boolean;
  lastActivity: Date;
  totalTokens: {
    input: number;
    output: number;
  };
}

export class ClaudeMonitor extends EventEmitter {
  private claudeHome = path.join(os.homedir(), '.claude');
  private projectsDir = path.join(this.claudeHome, 'projects');
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private sessions: Map<string, SessionInfo> = new Map();
  private agents: Map<string, AgentInfo> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;

  // 세션이 "활성"으로 간주되는 시간 (초)
  private readonly ACTIVE_THRESHOLD_SECONDS = 30;

  constructor() {
    super();
  }

  async start() {
    console.log('Starting Claude Monitor...');
    console.log('Watching:', this.projectsDir);

    // 초기 스캔
    await this.scanProjects();

    // 프로젝트 디렉토리 감시
    this.watchProjectsDir();

    // 주기적으로 활성 상태 체크 (3초마다)
    this.refreshInterval = setInterval(() => {
      this.checkActiveSessions();
    }, 3000);

    console.log('Claude Monitor started');
  }

  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.watchers.forEach(watcher => watcher.close());
    this.watchers.clear();
    console.log('Claude Monitor stopped');
  }

  private async scanProjects() {
    if (!fs.existsSync(this.projectsDir)) {
      console.log('Projects directory not found:', this.projectsDir);
      return;
    }

    const entries = fs.readdirSync(this.projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const projectDir = path.join(this.projectsDir, entry.name);
        await this.scanProjectSessions(projectDir, entry.name);
        this.watchProjectDir(projectDir);
      }
    }
  }

  private async scanProjectSessions(projectDir: string, projectName: string) {
    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    const now = Date.now();
    const recentFiles: string[] = [];

    // 최근 수정된 파일만 처리 (30초 이내)
    for (const file of files) {
      const filePath = path.join(projectDir, file);
      const stat = fs.statSync(filePath);
      const ageSeconds = (now - stat.mtimeMs) / 1000;

      if (ageSeconds < this.ACTIVE_THRESHOLD_SECONDS) {
        recentFiles.push(filePath);
      }
    }

    // 활성 세션 파싱
    for (const filePath of recentFiles) {
      await this.parseSessionFile(filePath, projectName);
    }
  }

  private async parseSessionFile(filePath: string, projectName: string): Promise<void> {
    const fileName = path.basename(filePath, '.jsonl');
    const isAgent = fileName.startsWith('agent-');
    const stat = fs.statSync(filePath);

    try {
      // 마지막 몇 줄만 읽기 (효율성) - 활동 로그를 위해 더 많이 읽음
      const lines = await this.readLastLines(filePath, 30);

      let sessionId = '';
      let agentId = '';
      let parentSessionId = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let lastMessage = '';
      let lastMessageFull = '';
      let cwd = '';
      const recentTools: string[] = [];
      const recentActivity: ActivityLog[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);

          if (data.sessionId) sessionId = data.sessionId;
          if (data.agentId) agentId = data.agentId;
          if (data.parentSessionId) parentSessionId = data.parentSessionId;
          if (data.cwd) cwd = data.cwd;

          if (data.message?.usage) {
            totalInputTokens += data.message.usage.input_tokens || 0;
            totalOutputTokens += data.message.usage.output_tokens || 0;
            cacheReadTokens += data.message.usage.cache_read_input_tokens || 0;
            cacheWriteTokens += data.message.usage.cache_creation_input_tokens || 0;
          }

          // 사용자 메시지를 현재 작업으로 사용
          if (data.message?.content && data.type === 'user') {
            const content = typeof data.message.content === 'string'
              ? data.message.content
              : data.message.content[0]?.text || '';
            if (content && content !== 'Warmup') {
              lastMessageFull = content;
              lastMessage = content.length > 80 ? content.slice(0, 80) + '...' : content;
            }
          }

          // 도구 사용 추출
          if (data.message?.content && Array.isArray(data.message.content)) {
            for (const block of data.message.content) {
              if (block.type === 'tool_use') {
                const toolName = block.name || 'unknown';
                if (!recentTools.includes(toolName)) {
                  recentTools.push(toolName);
                  if (recentTools.length > 8) recentTools.shift();
                }
                // 활동 로그 추가
                const toolSummary = this.summarizeToolUse(toolName, block.input);
                recentActivity.push({
                  timestamp: new Date(data.timestamp || Date.now()),
                  type: 'tool_use',
                  tool: toolName,
                  summary: toolSummary,
                });
              }
            }
          }

          // 도구 결과 추출
          if (data.message?.content && Array.isArray(data.message.content)) {
            for (const block of data.message.content) {
              if (block.type === 'tool_result') {
                recentActivity.push({
                  timestamp: new Date(data.timestamp || Date.now()),
                  type: 'result',
                  summary: block.is_error ? '❌ Error' : '✓ Success',
                });
              }
            }
          }
        } catch (e) {
          // JSON 파싱 실패 무시
        }
      }

      // 최근 활동만 유지 (최대 10개)
      const trimmedActivity = recentActivity.slice(-10);

      if (isAgent && agentId) {
        // 에이전트 타입 결정: parentSessionId가 있으면 서브에이전트
        const agentType: 'main' | 'sub' = parentSessionId ? 'sub' : 'main';

        // 에이전트 정보 업데이트
        const agent: AgentInfo = {
          id: agentId,
          name: this.getAgentName(agentId),
          status: 'working',
          agentType,
          currentTask: lastMessage || 'Processing...',
          currentTaskFull: lastMessageFull || undefined,
          recentTools,
          recentActivity: trimmedActivity,
          tokens: {
            input: totalInputTokens,
            output: totalOutputTokens,
            cacheRead: cacheReadTokens,
            cacheWrite: cacheWriteTokens,
          },
          cost: this.calculateCost(totalInputTokens, totalOutputTokens),
          lastActivity: stat.mtime,
          projectPath: cwd || this.pathFromProjectName(projectName),
          sessionId: sessionId,
        };

        this.agents.set(agentId, agent);
        this.emit('agent_updated', agent);
      }

      if (sessionId) {
        // 세션 정보 업데이트 (토큰은 에이전트에서 집계하므로 여기서는 누적하지 않음)
        const existingSession = this.sessions.get(sessionId);
        const session: SessionInfo = {
          id: sessionId,
          projectPath: cwd || existingSession?.projectPath || this.pathFromProjectName(projectName),
          agents: existingSession?.agents || [],
          isActive: true,
          lastActivity: stat.mtime,
          totalTokens: {
            // 세션 토큰은 소속된 에이전트 토큰의 합계로 계산 (getStatus에서 처리)
            input: 0,
            output: 0,
          },
        };

        this.sessions.set(sessionId, session);
        this.emit('session_updated', this.enrichSessionWithAgents(session));
      }
    } catch (err) {
      console.error('Error parsing session file:', filePath, err);
    }
  }

  private async readLastLines(filePath: string, numLines: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        lines.push(line);
        if (lines.length > numLines) {
          lines.shift();
        }
      });

      rl.on('close', () => resolve(lines));
      rl.on('error', reject);
    });
  }

  private watchProjectsDir() {
    if (!fs.existsSync(this.projectsDir)) return;

    const watcher = fs.watch(this.projectsDir, (eventType, filename) => {
      if (filename && !filename.startsWith('.')) {
        const projectDir = path.join(this.projectsDir, filename);
        if (fs.existsSync(projectDir) && fs.statSync(projectDir).isDirectory()) {
          this.watchProjectDir(projectDir);
        }
      }
    });

    this.watchers.set(this.projectsDir, watcher);
  }

  private watchProjectDir(projectDir: string) {
    if (this.watchers.has(projectDir)) return;

    const projectName = path.basename(projectDir);

    try {
      const watcher = fs.watch(projectDir, async (eventType, filename) => {
        if (filename && filename.endsWith('.jsonl')) {
          const filePath = path.join(projectDir, filename);
          if (fs.existsSync(filePath)) {
            await this.parseSessionFile(filePath, projectName);
          }
        }
      });

      this.watchers.set(projectDir, watcher);
    } catch (err) {
      console.error('Error watching project dir:', projectDir, err);
    }
  }

  private checkActiveSessions() {
    const now = Date.now();
    const threshold = this.ACTIVE_THRESHOLD_SECONDS * 1000;

    // 비활성 에이전트 상태 업데이트
    this.agents.forEach((agent, id) => {
      const age = now - agent.lastActivity.getTime();
      if (age > threshold) {
        agent.status = 'idle';
        this.emit('agent_updated', agent);
      }
    });

    // 비활성 세션 표시
    this.sessions.forEach((session, id) => {
      const age = now - session.lastActivity.getTime();
      if (age > threshold && session.isActive) {
        session.isActive = false;
        this.emit('session_updated', this.enrichSessionWithAgents(session));
      }
    });

    // 상태 브로드캐스트
    this.emit('status_update', this.getStatus());
  }

  // 세션에 해당하는 에이전트 연결
  private enrichSessionWithAgents(session: SessionInfo): SessionInfo & { agents: AgentInfo[] } {
    const sessionAgents = Array.from(this.agents.values())
      .filter(agent => agent.sessionId === session.id);
    return { ...session, agents: sessionAgents };
  }

  private getAgentName(agentId: string): string {
    // 에이전트 ID에서 이름 생성
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
    const hash = agentId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return `Agent ${names[hash % names.length]}`;
  }

  private pathFromProjectName(projectName: string): string {
    // Claude는 프로젝트 경로를 디렉토리명으로 인코딩함
    // 예: -Users-zhluv-Projects-xxx
    //
    // 주의: 하이픈을 /로 단순 치환하면 경로에 하이픈이 포함된 경우 잘못됨
    // 예: "my-project" -> "/my/project" (오류)
    //
    // 정책: cwd 필드가 없으면 인코딩된 이름을 그대로 표시하고
    // 잘못된 경로를 생성하지 않음
    if (!projectName.startsWith('-')) {
      return projectName;
    }
    // 인코딩된 경로임을 표시 (디코딩하지 않음)
    return `(project: ${projectName.substring(0, 30)}${projectName.length > 30 ? '...' : ''})`;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    // Claude Opus 4 pricing (approximate)
    const inputCost = (inputTokens / 1000000) * 15;  // $15/M
    const outputCost = (outputTokens / 1000000) * 60; // $60/M
    return inputCost + outputCost;
  }

  private summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
    // 도구 사용을 읽기 쉬운 요약으로 변환
    switch (toolName) {
      case 'Read':
        return `📖 ${this.shortenPath(input.file_path as string)}`;
      case 'Edit':
        return `✏️ ${this.shortenPath(input.file_path as string)}`;
      case 'Write':
        return `📝 ${this.shortenPath(input.file_path as string)}`;
      case 'Bash':
        const cmd = (input.command as string || '').slice(0, 40);
        return `💻 ${cmd}${cmd.length >= 40 ? '...' : ''}`;
      case 'Glob':
        return `🔍 ${input.pattern}`;
      case 'Grep':
        return `🔎 "${input.pattern}"`;
      case 'Task':
        return `🤖 ${input.description || 'Sub-agent'}`;
      case 'WebFetch':
        return `🌐 ${this.shortenUrl(input.url as string)}`;
      case 'WebSearch':
        return `🔍 "${input.query}"`;
      case 'TodoWrite':
        return `📋 Update todos`;
      default:
        return `🔧 ${toolName}`;
    }
  }

  private shortenPath(filePath: string | undefined): string {
    if (!filePath) return 'unknown';
    const parts = filePath.split('/');
    if (parts.length <= 3) return filePath;
    return `.../${parts.slice(-2).join('/')}`;
  }

  private shortenUrl(url: string | undefined): string {
    if (!url) return 'unknown';
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return url.slice(0, 30);
    }
  }

  getStatus() {
    const agents = Array.from(this.agents.values());
    const sessions = Array.from(this.sessions.values());

    const activeAgents = agents.filter(a => a.status === 'working');

    // 세션별로 에이전트 연결 (sessionId 기준)
    const sessionsWithAgents = sessions
      .filter(s => s.isActive)
      .map(session => ({
        ...session,
        agents: agents.filter(agent => agent.sessionId === session.id)
      }));

    const totalTokens = agents.reduce((sum, a) => ({
      input: sum.input + a.tokens.input,
      output: sum.output + a.tokens.output,
      cacheRead: sum.cacheRead + a.tokens.cacheRead,
      cacheWrite: sum.cacheWrite + a.tokens.cacheWrite,
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

    const totalCost = agents.reduce((sum, a) => sum + a.cost, 0);

    return {
      agents,
      sessions: sessionsWithAgents,
      metrics: {
        totalTokens,
        totalCost,
        cacheHitRate: 0,
        activeAgents: activeAgents.length,
        totalAgents: agents.length,
        activeSessions: sessionsWithAgents.length,
      }
    };
  }

  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }
}
