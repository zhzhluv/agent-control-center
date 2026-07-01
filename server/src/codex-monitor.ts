import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import readline from 'readline';
import type { AgentInfo, SessionInfo, SessionState, ActivityLog } from './claude-monitor.js';
import { redactSecrets } from './redact.js';
import { checkCodexNeedsReview } from './needs-review.js';

export class CodexMonitor extends EventEmitter {
  private codexHome = path.join(os.homedir(), '.codex');
  private sessionsDir = path.join(this.codexHome, 'sessions');
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private sessions: Map<string, SessionInfo> = new Map();
  private agents: Map<string, AgentInfo> = new Map();
  private refreshInterval: NodeJS.Timeout | null = null;
  private scanInterval: NodeJS.Timeout | null = null;

  // Session state thresholds (seconds) - aligned with ClaudeMonitor
  private readonly ACTIVE_THRESHOLD_SECONDS = 30;
  private readonly IDLE_THRESHOLD_SECONDS = 300;
  private readonly SCAN_WINDOW_SECONDS = 600;

  // Review candidate detection threshold (seconds)
  private readonly REVIEW_CANDIDATE_THRESHOLD_SECONDS = 30; // 30s with no new activity

  constructor() {
    super();
  }

  async start() {
    console.log('Starting Codex Monitor...');
    console.log('Watching:', this.sessionsDir);

    if (!fs.existsSync(this.sessionsDir)) {
      console.log('Codex sessions directory not found:', this.sessionsDir);
      return;
    }

    // Initial scan
    await this.scanSessions();

    // Watch sessions directory for new day directories
    this.watchSessionsDir();

    // Periodic scan for new year/month/day directories (every 60 seconds)
    // This ensures new directories are discovered even if they're created
    // after the initial scan (e.g., midnight rollover)
    this.scanInterval = setInterval(async () => {
      await this.scanSessions();
    }, 60000);

    // Periodic refresh (3 seconds, same as ClaudeMonitor)
    this.refreshInterval = setInterval(() => {
      this.checkActiveSessions();
    }, 3000);

    console.log('Codex Monitor started');
  }

  stop() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.watchers.forEach(watcher => watcher.close());
    this.watchers.clear();
    console.log('Codex Monitor stopped');
  }

  private async scanSessions() {
    // Codex sessions are organized as: ~/.codex/sessions/YYYY/MM/DD/*.jsonl
    // Scan recent sessions (within SCAN_WINDOW)
    const now = Date.now();

    try {
      const years = fs.readdirSync(this.sessionsDir).filter(f => /^\d{4}$/.test(f));

      for (const year of years) {
        const yearDir = path.join(this.sessionsDir, year);
        if (!fs.statSync(yearDir).isDirectory()) continue;

        const months = fs.readdirSync(yearDir).filter(f => /^\d{2}$/.test(f));

        for (const month of months) {
          const monthDir = path.join(yearDir, month);
          if (!fs.statSync(monthDir).isDirectory()) continue;

          const days = fs.readdirSync(monthDir).filter(f => /^\d{2}$/.test(f));

          for (const day of days) {
            const dayDir = path.join(monthDir, day);
            if (!fs.statSync(dayDir).isDirectory()) continue;

            const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.jsonl'));

            for (const file of files) {
              const filePath = path.join(dayDir, file);
              const stat = fs.statSync(filePath);
              const ageSeconds = (now - stat.mtimeMs) / 1000;

              // Only scan recent sessions
              if (ageSeconds < this.SCAN_WINDOW_SECONDS) {
                await this.parseSessionFile(filePath);
              }
            }

            // Watch this day directory for new/updated files
            this.watchDirectory(dayDir);
          }
        }
      }
    } catch (err) {
      console.error('Error scanning Codex sessions:', err);
    }

    // Set up watchers for any new directories discovered during scan
    this.watchSessionsDir();
  }

  private async parseSessionFile(filePath: string): Promise<void> {
    try {
      const stat = fs.statSync(filePath);
      const fileName = path.basename(filePath, '.jsonl');

      // Extract session ID from filename (e.g., "rollout-2026-04-30T19-50-54-019dde03-58c2-7e00-9470-e481e30d7874.jsonl")
      // The session ID is the UUID part at the end
      const sessionIdMatch = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
      if (!sessionIdMatch) {
        return; // Skip files that don't match expected pattern
      }

      const sessionId = sessionIdMatch[1];

      // Stream parse the file to collect cwd and recent activity
      const { recentLines, cwdCounts, lastTimestamp } = await this.streamParseJsonl(filePath, 30);

      // Determine canonical cwd (normalized to git root, excluding temp paths)
      const cwd = this.getCanonicalCwd(cwdCounts);
      if (!cwd) {
        return; // Skip sessions without valid cwd
      }

      // Parse recent activity from the last few lines
      let lastMessage = '';
      let lastMessageFull = '';
      const recentTools: string[] = [];
      const recentActivity: ActivityLog[] = [];

      for (const line of recentLines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);

          // Extract user messages as current task + record in recentActivity
          if (data.type === 'response_item' && data.payload?.role === 'user') {
            const content = data.payload.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'input_text' && block.text && !block.text.includes('<environment_context>')) {
                  const safeText = redactSecrets(block.text);
                  lastMessageFull = safeText;
                  lastMessage = safeText.length > 80 ? safeText.slice(0, 80) + '...' : safeText;
                  // 사용자 메시지를 활동 로그에 기록 (needsReview 해제 조건용)
                  recentActivity.push({
                    timestamp: new Date(data.timestamp || Date.now()),
                    type: 'message',
                    summary: `💬 User: ${safeText.slice(0, 50)}${safeText.length > 50 ? '...' : ''}`,
                  });
                }
              }
            }
          }

          // Extract assistant responses as activity
          if (data.type === 'response_item' && data.payload?.role === 'assistant') {
            recentActivity.push({
              timestamp: new Date(data.timestamp || Date.now()),
              type: 'result',
              summary: '✓ Assistant response',
              is_error: false,
            });
          }

          // Extract tool usage (if Codex exposes this in jsonl - may not be available)
          // For now, we'll skip tool extraction as Codex format is different
        } catch (e) {
          // Ignore JSON parse errors
        }
      }

      // 최근 활동만 유지 (최대 10개)
      const trimmedActivity = recentActivity.slice(-10);

      // Calculate session state based on lastActivity
      const lastActivity = lastTimestamp || stat.mtime;
      const ageSeconds = (Date.now() - lastActivity.getTime()) / 1000;
      let state: SessionState;
      if (ageSeconds < this.ACTIVE_THRESHOLD_SECONDS) {
        state = 'active';
      } else if (ageSeconds < this.IDLE_THRESHOLD_SECONDS) {
        state = 'idle';
      } else {
        state = 'stale';
      }

      // Normalize project path to git root
      const projectPath = this.findGitRoot(cwd);

      // Create synthetic main agent for Codex session
      const mainAgentId = `codex:${sessionId}`;
      const agentStatus: 'idle' | 'working' | 'waiting' = state === 'active' ? 'working' : 'idle';

      const existingAgent = this.agents.get(mainAgentId);

      // needsReview 해제 조건 확인
      let shouldClearReview = false;
      if (existingAgent?.needsReview && existingAgent.reviewCandidateAt) {
        const reviewTime = new Date(existingAgent.reviewCandidateAt).getTime();
        // 조건 1: 파일 lastActivity가 reviewCandidateAt보다 늦으면 해제
        if (lastActivity.getTime() > reviewTime) {
          shouldClearReview = true;
        }
        // 조건 2: reviewCandidateAt 이후 새 message/tool_use가 있으면 해제
        const hasNewActivity = trimmedActivity.some(activity =>
          (activity.type === 'message' || activity.type === 'tool_use') &&
          activity.timestamp.getTime() > reviewTime
        );
        if (hasNewActivity) {
          shouldClearReview = true;
        }
      }
      // 조건 3: agent가 working으로 재진입하면 해제
      if (agentStatus === 'working' && existingAgent?.needsReview) {
        shouldClearReview = true;
      }

      const mainAgent: AgentInfo = {
        id: mainAgentId,
        name: 'Codex Agent',
        status: agentStatus,
        agentType: 'main',
        currentTask: lastMessage || 'Session active',
        currentTaskFull: lastMessageFull || undefined,
        recentTools,
        recentActivity: trimmedActivity,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        lastActivity,
        projectPath,
        sessionId,
        source: 'codex',
        needsReview: shouldClearReview ? false : (existingAgent?.needsReview || false),
        reviewCandidateAt: shouldClearReview ? undefined : existingAgent?.reviewCandidateAt,
        reviewReason: shouldClearReview ? undefined : existingAgent?.reviewReason,
        reviewState: shouldClearReview ? undefined : existingAgent?.reviewState,
      };

      this.agents.set(mainAgentId, mainAgent);
      this.emit('agent_updated', mainAgent);

      // Create session info
      const session: SessionInfo = {
        id: sessionId,
        projectPath,
        agents: [mainAgent],
        isActive: state === 'active',
        state,
        lastActivity,
        totalTokens: {
          input: 0,
          output: 0,
        },
        source: 'codex',
      };

      this.sessions.set(sessionId, session);
      this.emit('session_updated', session);

    } catch (err) {
      console.error('Error parsing Codex session file:', filePath, err);
    }
  }

  private async streamParseJsonl(filePath: string, numRecentLines: number): Promise<{
    recentLines: string[];
    cwdCounts: Map<string, number>;
    lastTimestamp: Date | null;
  }> {
    return new Promise((resolve, reject) => {
      const recentLines: string[] = [];
      const cwdCounts = new Map<string, number>();
      let lastTimestamp: Date | null = null;

      const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        // Keep only the last N lines
        recentLines.push(line);
        if (recentLines.length > numRecentLines) {
          recentLines.shift();
        }

        // Extract cwd and timestamp
        if (line.trim()) {
          try {
            const data = JSON.parse(line);

            // Update last timestamp
            if (data.timestamp) {
              const ts = new Date(data.timestamp);
              if (!lastTimestamp || ts > lastTimestamp) {
                lastTimestamp = ts;
              }
            }

            // Extract cwd from turn_context
            if (data.type === 'turn_context' && data.payload?.cwd) {
              const cwd = data.payload.cwd;
              cwdCounts.set(cwd, (cwdCounts.get(cwd) || 0) + 1);
            }

            // Also check session_meta for initial cwd
            if (data.type === 'session_meta' && data.payload?.cwd) {
              const cwd = data.payload.cwd;
              cwdCounts.set(cwd, (cwdCounts.get(cwd) || 0) + 5); // Weight initial cwd more
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      });

      rl.on('close', () => resolve({ recentLines, cwdCounts, lastTimestamp }));
      rl.on('error', reject);
    });
  }

  private getCanonicalCwd(cwdCounts: Map<string, number>): string {
    if (cwdCounts.size === 0) return '';

    // Temporary/transient path patterns to exclude (same as ClaudeMonitor)
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
      if (isTempPath(cwdPath)) continue;

      const normalized = this.findGitRoot(cwdPath);
      normalizedCounts.set(normalized, (normalizedCounts.get(normalized) || 0) + count);
    }

    if (normalizedCounts.size === 0) {
      const sorted = Array.from(cwdCounts.entries()).sort((a, b) => b[1] - a[1]);
      return sorted[0]?.[0] || '';
    }

    // Return most common normalized path
    const sorted = Array.from(normalizedCounts.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || '';
  }

  private findGitRoot(dirPath: string): string {
    if (!dirPath || dirPath === '/') return dirPath;

    try {
      let current = dirPath;
      const maxDepth = 10;
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
      // Ignore errors
    }

    return dirPath;
  }

  /**
   * Check if an agent is a candidate for review based on conservative heuristics:
   * - Agent must be idle
   * - Must have some recent activity (보수적: activity가 없으면 무조건 false)
   * - At least REVIEW_CANDIDATE_THRESHOLD_SECONDS have passed since last activity
   * - No recent errors in activity log
   * Note: Codex monitoring has limited activity tracking, so this is a simplified check
   * Delegates to the shared checkCodexNeedsReview function.
   */
  private checkNeedsReview(agent: AgentInfo, now: number): { needsReview: boolean; reason?: string } {
    return checkCodexNeedsReview(agent, now, this.REVIEW_CANDIDATE_THRESHOLD_SECONDS);
  }

  private watchSessionsDir() {
    if (!fs.existsSync(this.sessionsDir)) return;

    // Watch the root sessions directory for new year directories
    if (!this.watchers.has(this.sessionsDir)) {
      try {
        const watcher = fs.watch(this.sessionsDir, async (eventType, filename) => {
          if (filename && /^\d{4}$/.test(filename)) {
            // New year directory detected, trigger rescan
            await this.scanSessions();
          }
        });
        this.watchers.set(this.sessionsDir, watcher);
      } catch (err) {
        console.error('Error watching Codex sessions root:', err);
      }
    }

    // Watch existing year directories for new month directories
    try {
      const years = fs.readdirSync(this.sessionsDir).filter(f => /^\d{4}$/.test(f));
      for (const year of years) {
        const yearDir = path.join(this.sessionsDir, year);
        if (!fs.statSync(yearDir).isDirectory()) continue;
        if (this.watchers.has(yearDir)) continue;

        try {
          const watcher = fs.watch(yearDir, async (eventType, filename) => {
            if (filename && /^\d{2}$/.test(filename)) {
              // New month directory detected, trigger rescan
              await this.scanSessions();
            }
          });
          this.watchers.set(yearDir, watcher);
        } catch (err) {
          console.error('Error watching Codex year directory:', yearDir, err);
        }

        // Watch existing month directories for new day directories
        const months = fs.readdirSync(yearDir).filter(f => /^\d{2}$/.test(f));
        for (const month of months) {
          const monthDir = path.join(yearDir, month);
          if (!fs.statSync(monthDir).isDirectory()) continue;
          if (this.watchers.has(monthDir)) continue;

          try {
            const watcher = fs.watch(monthDir, async (eventType, filename) => {
              if (filename && /^\d{2}$/.test(filename)) {
                // New day directory detected, trigger rescan
                await this.scanSessions();
              }
            });
            this.watchers.set(monthDir, watcher);
          } catch (err) {
            console.error('Error watching Codex month directory:', monthDir, err);
          }
        }
      }
    } catch (err) {
      console.error('Error setting up Codex directory watchers:', err);
    }
  }

  private watchDirectory(dirPath: string) {
    if (this.watchers.has(dirPath)) return;

    try {
      const watcher = fs.watch(dirPath, async (eventType, filename) => {
        if (filename && filename.endsWith('.jsonl')) {
          const filePath = path.join(dirPath, filename);
          if (fs.existsSync(filePath)) {
            await this.parseSessionFile(filePath);
          }
        }
      });

      this.watchers.set(dirPath, watcher);
    } catch (err) {
      console.error('Error watching Codex directory:', dirPath, err);
    }
  }

  private checkActiveSessions() {
    const now = Date.now();
    const activeThreshold = this.ACTIVE_THRESHOLD_SECONDS * 1000;
    const idleThreshold = this.IDLE_THRESHOLD_SECONDS * 1000;

    // Update agent status and check for review candidates
    this.agents.forEach((agent) => {
      const age = now - agent.lastActivity.getTime();
      let statusChanged = false;
      let reviewStatusChanged = false;

      // Update working/idle status
      if (age > activeThreshold && agent.status === 'working') {
        agent.status = 'idle';
        statusChanged = true;
      } else if (age <= activeThreshold && agent.status === 'idle') {
        agent.status = 'working';
        statusChanged = true;
        // If agent becomes active again, clear review candidate status
        if (agent.needsReview) {
          agent.needsReview = false;
          agent.reviewCandidateAt = undefined;
          agent.reviewReason = undefined;
          reviewStatusChanged = true;
        }
      }

      // Check if agent needs review (only if idle)
      if (agent.status === 'idle') {
        const reviewCheck = this.checkNeedsReview(agent, now);

        // If review status changed, update the agent
        if (reviewCheck.needsReview && !agent.needsReview) {
          agent.needsReview = true;
          agent.reviewCandidateAt = new Date().toISOString();
          agent.reviewReason = reviewCheck.reason;
          agent.reviewState = 'pending';  // needsReview가 true로 설정되면 reviewState를 'pending'으로 초기화
          reviewStatusChanged = true;
        } else if (!reviewCheck.needsReview && agent.needsReview) {
          agent.needsReview = false;
          agent.reviewCandidateAt = undefined;
          agent.reviewReason = undefined;
          agent.reviewState = undefined;  // needsReview가 false로 초기화되면 reviewState도 초기화
          reviewStatusChanged = true;
        }
      }

      // Emit update if anything changed
      if (statusChanged || reviewStatusChanged) {
        this.emit('agent_updated', agent);
      }
    });

    // Update session states
    this.sessions.forEach((session) => {
      const age = now - session.lastActivity.getTime();
      let newState: SessionState;

      if (age < activeThreshold) {
        newState = 'active';
      } else if (age < idleThreshold) {
        newState = 'idle';
      } else {
        newState = 'stale';
      }

      if (session.state !== newState) {
        session.state = newState;
        session.isActive = (newState === 'active');
        this.emit('session_updated', session);
      }
    });

    // Broadcast status update
    this.emit('status_update', this.getStatus());
  }

  getStatus() {
    const agents = Array.from(this.agents.values());
    const sessions = Array.from(this.sessions.values());

    return {
      agents,
      sessions,
      metrics: {
        activeAgents: agents.filter(a => a.status === 'working').length,
        totalAgents: agents.length,
        activeSessions: sessions.filter(s => s.state === 'active').length,
        idleSessions: sessions.filter(s => s.state === 'idle').length,
        staleSessions: sessions.filter(s => s.state === 'stale').length,
        totalSessions: sessions.length,
      }
    };
  }

  getAgents(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  getSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Update review state for an agent
   * This is called by the REST API when an operator changes the review state
   */
  updateReviewState(agentId: string, reviewState: 'pending' | 'acknowledged' | 'copied' | 'dismissed'): boolean {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return false;
    }

    // Only update if the agent is in needsReview state
    if (!agent.needsReview) {
      return false;
    }

    agent.reviewState = reviewState;
    this.emit('agent_updated', agent);

    return true;
  }
}
