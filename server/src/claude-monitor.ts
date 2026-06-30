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
  is_error?: boolean;  // 도구 결과가 에러인 경우
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

export type SessionState = 'active' | 'idle' | 'stale';

export interface SessionInfo {
  id: string;
  projectPath: string;
  agents: AgentInfo[];
  isActive: boolean;
  state: SessionState;  // active: <30s, idle: 30s-5m, stale: >5m
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

  // Session state thresholds (seconds)
  private readonly ACTIVE_THRESHOLD_SECONDS = 30;     // <30s = active
  private readonly IDLE_THRESHOLD_SECONDS = 300;      // 30s-5m = idle
  // >5m = stale (but still tracked)

  // File scanning window for initial discovery (seconds)
  private readonly SCAN_WINDOW_SECONDS = 600;         // 10 minutes

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
    const filesToScan: string[] = [];

    // Scan files modified within last 10 minutes for initial discovery
    // (individual session state will be determined by actual lastActivity)
    for (const file of files) {
      const filePath = path.join(projectDir, file);
      const stat = fs.statSync(filePath);
      const ageSeconds = (now - stat.mtimeMs) / 1000;

      if (ageSeconds < this.SCAN_WINDOW_SECONDS) {
        filesToScan.push(filePath);
      }
    }

    // Parse all discovered session files
    for (const filePath of filesToScan) {
      await this.parseSessionFile(filePath, projectName);
    }
  }

  private async parseSessionFile(filePath: string, projectName: string): Promise<void> {
    const fileName = path.basename(filePath, '.jsonl');
    const isAgent = fileName.startsWith('agent-');
    const stat = fs.statSync(filePath);

    try {
      // Stream entire file to collect cwd statistics, keep last 30 lines for activity
      const { recentLines: lines, cwdCounts } = await this.streamParseJsonl(filePath, 30);

      let sessionId = '';
      let agentId = '';
      let parentSessionId = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let cacheReadTokens = 0;
      let cacheWriteTokens = 0;
      let lastMessage = '';
      let lastMessageFull = '';
      const recentTools: string[] = [];
      const recentActivity: ActivityLog[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);

          if (data.sessionId) sessionId = data.sessionId;
          if (data.agentId) agentId = data.agentId;
          if (data.parentSessionId) parentSessionId = data.parentSessionId;
          // Note: cwd is now collected from entire file via streamParseJsonl

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
                  is_error: block.is_error || false,
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

      // Determine canonical cwd based on frequency, filtering out temp directories
      const cwd = this.getCanonicalCwd(cwdCounts);

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
        // Calculate session state based on lastActivity
        const ageSeconds = (Date.now() - stat.mtime.getTime()) / 1000;
        let state: SessionState;
        if (ageSeconds < this.ACTIVE_THRESHOLD_SECONDS) {
          state = 'active';
        } else if (ageSeconds < this.IDLE_THRESHOLD_SECONDS) {
          state = 'idle';
        } else {
          state = 'stale';
        }

        // 세션 정보 업데이트 (토큰은 에이전트에서 집계하므로 여기서는 누적하지 않음)
        const existingSession = this.sessions.get(sessionId);

        // CRITICAL: Use cwd from jsonl file as the actual project path
        // Directory name is just an encoded representation and may contain multiple projects
        const actualProjectPath = cwd || existingSession?.projectPath || this.pathFromProjectName(projectName);

        const session: SessionInfo = {
          id: sessionId,
          projectPath: actualProjectPath,
          agents: existingSession?.agents || [],
          isActive: state === 'active', // Keep for backwards compatibility
          state,
          lastActivity: stat.mtime,
          totalTokens: {
            // 세션 토큰은 소속된 에이전트 토큰의 합계로 계산 (getStatus에서 처리)
            input: 0,
            output: 0,
          },
        };

        this.sessions.set(sessionId, session);

        // Create a main agent for sessions without explicit agent-*.jsonl files
        // This ensures every session has at least one visible "worker" in the UI
        if (!isAgent) {
          const mainAgentId = `main:${sessionId}`;
          const agentStatus: 'idle' | 'working' | 'waiting' =
            state === 'active' ? 'working' : 'idle';

          const mainAgent: AgentInfo = {
            id: mainAgentId,
            name: this.getAgentName(mainAgentId),
            status: agentStatus,
            agentType: 'main',
            currentTask: lastMessage || 'Session active',
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
            projectPath: actualProjectPath,
            sessionId: sessionId,
          };

          this.agents.set(mainAgentId, mainAgent);
          this.emit('agent_updated', mainAgent);
        }

        this.emit('session_updated', this.enrichSessionWithAgents(session));
      }
    } catch (err) {
      console.error('Error parsing session file:', filePath, err);
    }
  }

  /**
   * Stream through entire JSONL file to collect:
   * - cwdCounts: frequency of each cwd across the entire file
   * - recentLines: last N lines for activity display
   * This avoids loading the entire file into memory while still
   * getting accurate cwd statistics from the full session history.
   */
  private async streamParseJsonl(filePath: string, numRecentLines: number): Promise<{
    recentLines: string[];
    cwdCounts: Map<string, number>;
  }> {
    return new Promise((resolve, reject) => {
      const recentLines: string[] = [];
      const cwdCounts = new Map<string, number>();

      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        // Keep only the last N lines for recent activity
        recentLines.push(line);
        if (recentLines.length > numRecentLines) {
          recentLines.shift();
        }

        // Extract cwd from every line for accurate project path detection
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            if (data.cwd && typeof data.cwd === 'string') {
              cwdCounts.set(data.cwd, (cwdCounts.get(data.cwd) || 0) + 1);
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      });

      rl.on('close', () => resolve({ recentLines, cwdCounts }));
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
    const activeThreshold = this.ACTIVE_THRESHOLD_SECONDS * 1000;
    const idleThreshold = this.IDLE_THRESHOLD_SECONDS * 1000;

    // Update agent status
    this.agents.forEach((agent, id) => {
      const age = now - agent.lastActivity.getTime();
      if (age > activeThreshold) {
        agent.status = 'idle';
        this.emit('agent_updated', agent);
      }
    });

    // Update session states based on age
    this.sessions.forEach((session, id) => {
      const age = now - session.lastActivity.getTime();
      let newState: SessionState;

      if (age < activeThreshold) {
        newState = 'active';
      } else if (age < idleThreshold) {
        newState = 'idle';
      } else {
        newState = 'stale';
      }

      // Update if state changed
      if (session.state !== newState) {
        session.state = newState;
        session.isActive = (newState === 'active');
        this.emit('session_updated', this.enrichSessionWithAgents(session));
      }
    });

    // Broadcast status update
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

  /**
   * Find the git repository root for a given path.
   * Walks up the directory tree looking for .git directory.
   * Returns the original path if no git root is found.
   */
  private findGitRoot(dirPath: string): string {
    if (!dirPath || dirPath === '/') return dirPath;

    try {
      let current = dirPath;
      const maxDepth = 10; // Prevent infinite loops
      let depth = 0;

      while (current && current !== '/' && depth < maxDepth) {
        const gitDir = path.join(current, '.git');
        if (fs.existsSync(gitDir)) {
          return current;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
        depth++;
      }
    } catch {
      // Ignore errors (permission issues, etc.)
    }

    return dirPath;
  }

  /**
   * Determine canonical cwd from frequency map collected from entire JSONL file.
   * - Normalizes paths to git repository root when possible
   * - Filters out temporary directories (/tmp, /private/tmp, /var/folders, /dev)
   * - Returns the most frequent non-temp, normalized path
   */
  private getCanonicalCwd(cwdCounts: Map<string, number>): string {
    if (cwdCounts.size === 0) return '';

    // Temporary/transient path patterns to exclude
    const tempPatterns = [
      /^\/tmp\b/,
      /^\/private\/tmp\b/,
      /^\/var\/folders\b/,
      /^\/dev\b/,
    ];

    const isTempPath = (p: string): boolean => tempPatterns.some(re => re.test(p));

    // Normalize paths to git root and aggregate counts
    const normalizedCounts = new Map<string, number>();
    for (const [cwdPath, count] of cwdCounts) {
      if (isTempPath(cwdPath)) continue; // Skip temp paths entirely

      // Normalize to git root (e.g., /repo/client → /repo)
      const normalized = this.findGitRoot(cwdPath);
      normalizedCounts.set(normalized, (normalizedCounts.get(normalized) || 0) + count);
    }

    // If all paths were temp, try to return the most common temp path
    if (normalizedCounts.size === 0) {
      const sorted = Array.from(cwdCounts.entries()).sort((a, b) => b[1] - a[1]);
      return sorted[0]?.[0] || '';
    }

    // Sort by frequency (descending) and return the most common
    const sorted = Array.from(normalizedCounts.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || '';
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

    // Return ALL sessions (not just active), with their agents
    const sessionsWithAgents = sessions.map(session => ({
      ...session,
      agents: agents.filter(agent => agent.sessionId === session.id)
    }));

    // Group sessions by project path
    const projectsMap = new Map<string, ProjectInfo>();

    sessionsWithAgents.forEach(session => {
      const projectPath = session.projectPath;

      if (!projectsMap.has(projectPath)) {
        projectsMap.set(projectPath, {
          path: projectPath,
          name: this.getProjectName(projectPath),
          sessions: [],
          lastActivity: session.lastActivity,
        });
      }

      const project = projectsMap.get(projectPath)!;
      project.sessions.push(session);

      // Update project lastActivity to the most recent session activity
      if (session.lastActivity > project.lastActivity) {
        project.lastActivity = session.lastActivity;
      }
    });

    const projects = Array.from(projectsMap.values());

    const totalTokens = agents.reduce((sum, a) => ({
      input: sum.input + a.tokens.input,
      output: sum.output + a.tokens.output,
      cacheRead: sum.cacheRead + a.tokens.cacheRead,
      cacheWrite: sum.cacheWrite + a.tokens.cacheWrite,
    }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

    const totalCost = agents.reduce((sum, a) => sum + a.cost, 0);

    // Count sessions by state
    const activeSessions = sessions.filter(s => s.state === 'active').length;
    const idleSessions = sessions.filter(s => s.state === 'idle').length;
    const staleSessions = sessions.filter(s => s.state === 'stale').length;

    return {
      agents,
      sessions: sessionsWithAgents,
      projects,  // NEW: Project-level grouping
      metrics: {
        totalTokens,
        totalCost,
        cacheHitRate: 0,
        activeAgents: activeAgents.length,
        totalAgents: agents.length,
        activeSessions,
        idleSessions,    // NEW
        staleSessions,   // NEW
        totalSessions: sessions.length,
        totalProjects: projects.length,  // NEW
      }
    };
  }

  private getProjectName(projectPath: string): string {
    // Extract a readable project name from the path
    if (!projectPath || projectPath.startsWith('(project:')) {
      return projectPath;
    }
    const parts = projectPath.split('/');
    return parts[parts.length - 1] || projectPath;
  }

  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }
}
