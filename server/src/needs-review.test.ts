/**
 * needsReview 로직 단위 테스트
 *
 * Production 코드 (needs-review.ts)의 checkClaudeNeedsReview, checkCodexNeedsReview 함수를 테스트합니다.
 */

import type { AgentInfo, ActivityLog } from './claude-monitor.js';
import { checkClaudeNeedsReview, checkCodexNeedsReview } from './needs-review.js';

// ============================================================================
// 테스트 헬퍼 함수
// ============================================================================

function createMockAgent(overrides: Partial<AgentInfo> = {}): Pick<AgentInfo, 'status' | 'recentActivity' | 'lastActivity'> {
  return {
    status: 'idle',
    recentActivity: [],
    lastActivity: new Date(Date.now() - 60000), // 60초 전
    ...overrides,
  };
}

function createActivity(
  type: 'tool_use' | 'message' | 'result',
  timestamp: Date,
  isError?: boolean
): ActivityLog {
  return {
    timestamp,
    type,
    summary: `Test ${type}`,
    is_error: isError,
  };
}

// ============================================================================
// 테스트 케이스
// ============================================================================

type TestCase = {
  name: string;
  agent: Pick<AgentInfo, 'status' | 'recentActivity' | 'lastActivity'>;
  now: number;
  expected: { needsReview: boolean };
  provider: 'claude' | 'codex';
};

const testCases: TestCase[] = [
  // ========================================
  // Claude 테스트 케이스
  // ========================================
  {
    name: '[Claude] 성공 result 후 idle 30초 이상 → 후보',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000), // 35초 전
      recentActivity: [
        createActivity('message', new Date(Date.now() - 100000), false),
        createActivity('tool_use', new Date(Date.now() - 90000), false),
        createActivity('result', new Date(Date.now() - 35000), false), // 성공
      ],
    }),
    now: Date.now(),
    expected: { needsReview: true },
  },
  {
    name: '[Claude] user message만 있음 → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('message', new Date(Date.now() - 35000), false),
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] error result가 있음 → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('tool_use', new Date(Date.now() - 90000), false),
        createActivity('result', new Date(Date.now() - 35000), true), // 에러
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] 성공 result 후 새 user message → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('tool_use', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 90000), false), // 성공
        createActivity('message', new Date(Date.now() - 35000), false), // 새 메시지
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] 성공 result 후 새 tool_use → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('tool_use', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 90000), false), // 성공
        createActivity('tool_use', new Date(Date.now() - 35000), false), // 새 tool_use
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] idle 30초 미만 → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 20000), // 20초 전
      recentActivity: [
        createActivity('tool_use', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 20000), false), // 성공
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] working 상태 → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'working',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('tool_use', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 35000), false), // 성공
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] 빈 activity → 후보 아님',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Claude] 성공 result 이후 다른 성공 result → 후보',
    provider: 'claude',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('tool_use', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 90000), false),
        createActivity('result', new Date(Date.now() - 35000), false), // 마지막 result도 성공
      ],
    }),
    now: Date.now(),
    expected: { needsReview: true },
  },

  // ========================================
  // Codex 테스트 케이스
  // ========================================
  {
    name: '[Codex] 성공 result 후 idle 30초 이상 → 후보',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('message', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 35000), false), // 성공
      ],
    }),
    now: Date.now(),
    expected: { needsReview: true },
  },
  {
    name: '[Codex] user message만 있음 → 후보 아님',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('message', new Date(Date.now() - 35000), false),
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Codex] assistant/result 없이 idle → 후보 아님',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('message', new Date(Date.now() - 100000), false),
        createActivity('message', new Date(Date.now() - 35000), false),
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Codex] error result가 있음 → 후보 아님',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('message', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 35000), true), // 에러
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Codex] 성공 result 후 새 message → 후보 아님',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [
        createActivity('message', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 90000), false), // 성공
        createActivity('message', new Date(Date.now() - 35000), false), // 새 메시지
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Codex] 빈 activity → 후보 아님',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 35000),
      recentActivity: [],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
  {
    name: '[Codex] idle 30초 미만 → 후보 아님',
    provider: 'codex',
    agent: createMockAgent({
      status: 'idle',
      lastActivity: new Date(Date.now() - 20000), // 20초 전
      recentActivity: [
        createActivity('message', new Date(Date.now() - 100000), false),
        createActivity('result', new Date(Date.now() - 20000), false), // 성공
      ],
    }),
    now: Date.now(),
    expected: { needsReview: false },
  },
];

// ============================================================================
// 테스트 실행
// ============================================================================

function runTests() {
  let passed = 0;
  let failed = 0;
  const failures: { name: string; expected: boolean; actual: boolean }[] = [];

  console.log('='.repeat(80));
  console.log('needsReview 로직 단위 테스트 (Production 코드 테스트)');
  console.log('='.repeat(80));
  console.log('');

  for (const testCase of testCases) {
    const checkFunction = testCase.provider === 'claude' ? checkClaudeNeedsReview : checkCodexNeedsReview;
    const result = checkFunction(testCase.agent, testCase.now);
    const success = result.needsReview === testCase.expected.needsReview;

    if (success) {
      console.log(`✓ ${testCase.name}`);
      passed++;
    } else {
      console.log(`✗ ${testCase.name}`);
      console.log(`  Expected: ${testCase.expected.needsReview}, Got: ${result.needsReview}`);
      if (result.reason) {
        console.log(`  Reason: ${result.reason}`);
      }
      failed++;
      failures.push({
        name: testCase.name,
        expected: testCase.expected.needsReview,
        actual: result.needsReview,
      });
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log(`테스트 결과: ${passed} passed, ${failed} failed (총 ${testCases.length}개)`);
  console.log('='.repeat(80));

  if (failures.length > 0) {
    console.log('');
    console.log('실패한 테스트:');
    failures.forEach(f => {
      console.log(`  - ${f.name}`);
      console.log(`    Expected: ${f.expected}, Got: ${f.actual}`);
    });
    process.exit(1);
  } else {
    console.log('');
    console.log('모든 테스트 통과!');
    process.exit(0);
  }
}

// ============================================================================
// 메인 실행
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}
