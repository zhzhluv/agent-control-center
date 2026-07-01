/**
 * needsReview 로직 공통 모듈
 *
 * ClaudeMonitor와 CodexMonitor에서 공유하는 checkNeedsReview 순수 함수를 제공합니다.
 */

import type { ActivityLog } from './claude-monitor.js';

/**
 * needsReview 체크에 필요한 AgentInfo 부분 타입
 */
export interface NeedsReviewAgentInfo {
  status: 'working' | 'idle' | 'waiting' | 'error' | 'unknown';
  recentActivity: ActivityLog[];
  lastActivity: Date;
}

/**
 * checkNeedsReview 결과 타입
 */
export interface NeedsReviewResult {
  needsReview: boolean;
  reason?: string;
}

/**
 * Claude 에이전트의 needsReview 상태를 체크하는 순수 함수
 *
 * 조건:
 * 1. agent.status === 'idle' (working 상태는 제외)
 * 2. recentActivity가 존재해야 함
 * 3. lastActivity로부터 THRESHOLD_SECONDS 이상 경과
 * 4. 최근 에러가 없어야 함 (is_error: true 없음)
 * 5. 마지막 result가 성공 (is_error: false)
 * 6. 마지막 result 이후 tool_use 또는 message가 없어야 함
 */
export function checkClaudeNeedsReview(
  agent: NeedsReviewAgentInfo,
  now: number,
  thresholdSeconds: number = 30
): NeedsReviewResult {
  // Must be idle (not actively working)
  if (agent.status !== 'idle') {
    return { needsReview: false };
  }

  // Must have some recent activity
  if (agent.recentActivity.length === 0) {
    return { needsReview: false };
  }

  // Check if enough time has passed since last activity
  const ageSeconds = (now - agent.lastActivity.getTime()) / 1000;
  if (ageSeconds < thresholdSeconds) {
    return { needsReview: false };
  }

  // Check for any recent errors (disqualifies from review)
  const hasRecentError = agent.recentActivity.some(activity => activity.is_error === true);
  if (hasRecentError) {
    return { needsReview: false };
  }

  // Find the last tool_result
  let lastResultIndex = -1;
  for (let i = agent.recentActivity.length - 1; i >= 0; i--) {
    if (agent.recentActivity[i].type === 'result') {
      lastResultIndex = i;
      break;
    }
  }

  // No tool results found
  if (lastResultIndex === -1) {
    return { needsReview: false };
  }

  const lastResult = agent.recentActivity[lastResultIndex];

  // Last result must be successful
  if (lastResult.is_error === true) {
    return { needsReview: false };
  }

  // Check if there are any tool_use or message activities after the last result
  const activitiesAfterResult = agent.recentActivity.slice(lastResultIndex + 1);
  const hasActivityAfterResult = activitiesAfterResult.some(
    activity => activity.type === 'tool_use' || activity.type === 'message'
  );

  if (hasActivityAfterResult) {
    return { needsReview: false };
  }

  // All conditions met - this is a review candidate
  return {
    needsReview: true,
    reason: `Successful operation completed, no activity for ${Math.floor(ageSeconds)}s`
  };
}

/**
 * Codex 에이전트의 needsReview 상태를 체크하는 순수 함수
 *
 * Codex는 더 보수적으로 접근:
 * 1. agent.status === 'idle'
 * 2. recentActivity가 있어야 함 (없으면 무조건 false)
 * 3. lastActivity로부터 THRESHOLD_SECONDS 이상 경과
 * 4. 최근 에러가 없어야 함
 * 5. assistant/result가 있어야 함 (없으면 무조건 false)
 * 6. 마지막 result가 성공
 * 7. 마지막 result 이후 tool_use 또는 message가 없어야 함
 */
export function checkCodexNeedsReview(
  agent: NeedsReviewAgentInfo,
  now: number,
  thresholdSeconds: number = 30
): NeedsReviewResult {
  // Must be idle (not actively working)
  if (agent.status !== 'idle') {
    return { needsReview: false };
  }

  // 보수적 접근: activity가 전혀 없는 idle 세션은 needsReview로 만들지 않음
  if (agent.recentActivity.length === 0) {
    return { needsReview: false };
  }

  // Check if enough time has passed since last activity
  const ageSeconds = (now - agent.lastActivity.getTime()) / 1000;
  if (ageSeconds < thresholdSeconds) {
    return { needsReview: false };
  }

  // Check for errors in activity
  const hasRecentError = agent.recentActivity.some(activity => activity.is_error === true);
  if (hasRecentError) {
    return { needsReview: false };
  }

  // Find the last tool_result (assistant response)
  let lastResultIndex = -1;
  for (let i = agent.recentActivity.length - 1; i >= 0; i--) {
    if (agent.recentActivity[i].type === 'result') {
      lastResultIndex = i;
      break;
    }
  }

  // 보수적 접근: assistant/result가 없으면 needsReview로 보지 않음
  // user message만 있는 세션은 검수 필요 후보가 아님
  if (lastResultIndex === -1) {
    return { needsReview: false };
  }

  // Result exists - ensure it's successful and no activity after
  const lastResult = agent.recentActivity[lastResultIndex];
  if (lastResult.is_error === true) {
    return { needsReview: false };
  }

  const activitiesAfterResult = agent.recentActivity.slice(lastResultIndex + 1);
  const hasActivityAfterResult = activitiesAfterResult.some(
    activity => activity.type === 'tool_use' || activity.type === 'message'
  );

  if (hasActivityAfterResult) {
    return { needsReview: false };
  }

  // All conditions met - this is a review candidate
  return {
    needsReview: true,
    reason: `Successful operation completed, idle for ${Math.floor(ageSeconds)}s`
  };
}
