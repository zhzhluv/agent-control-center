/**
 * Redaction 테스트 - Node assert 기반
 * 실행: npx tsx server/src/redact.test.ts
 */

import assert from 'node:assert';
import { redactSecrets, redactObject } from './redact.js';

const REDACTED = '[REDACTED]';

console.log('=== Redaction 테스트 시작 ===\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  오류: ${(e as Error).message}`);
    failed++;
  }
}

// === 환경변수 패턴 테스트 ===
console.log('--- 환경변수 패턴 ---');

test('PGPASSWORD 마스킹', () => {
  assert.strictEqual(redactSecrets('PGPASSWORD=secretvalue'), 'PGPASSWORD=[REDACTED]');
  assert.strictEqual(redactSecrets('PGPASSWORD=abc psql -U user'), 'PGPASSWORD=[REDACTED] psql -U user');
});

test('PASSWORD 마스킹', () => {
  assert.strictEqual(redactSecrets('PASSWORD=abc123'), 'PASSWORD=[REDACTED]');
});

test('TOKEN 마스킹', () => {
  assert.strictEqual(redactSecrets('TOKEN=abc123'), 'TOKEN=[REDACTED]');
  assert.strictEqual(redactSecrets('AUTH_TOKEN=abc npm start'), 'AUTH_TOKEN=[REDACTED] npm start');
});

test('API_KEY 마스킹', () => {
  assert.strictEqual(redactSecrets('API_KEY=sk-1234'), 'API_KEY=[REDACTED]');
  assert.strictEqual(redactSecrets('OPENAI_API_KEY=sk-proj-abc'), 'OPENAI_API_KEY=[REDACTED]');
  assert.strictEqual(redactSecrets('ANTHROPIC_API_KEY=sk-ant-xyz'), 'ANTHROPIC_API_KEY=[REDACTED]');
});

test('DATABASE_URL 마스킹', () => {
  assert.strictEqual(redactSecrets('DATABASE_URL=postgres://user:pass@host:5432/db'), 'DATABASE_URL=[REDACTED]');
});

test('AWS_SECRET_ACCESS_KEY 마스킹', () => {
  assert.strictEqual(
    redactSecrets('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG'),
    'AWS_SECRET_ACCESS_KEY=[REDACTED]'
  );
});

// === 헤더 패턴 테스트 ===
console.log('\n--- 헤더 패턴 ---');

test('Bearer 토큰 마스킹', () => {
  assert.strictEqual(redactSecrets('Bearer abc123'), 'Bearer [REDACTED]');
  assert.strictEqual(redactSecrets('bearer abc123'), 'Bearer [REDACTED]');
});

test('Authorization 헤더 마스킹', () => {
  // Authorization: Bearer abc → Authorization: [REDACTED] (중복 없음)
  const result = redactSecrets('Authorization: Bearer abc');
  assert.ok(
    result === 'Authorization: [REDACTED]' || result === 'Authorization: Bearer [REDACTED]',
    `기대: "Authorization: [REDACTED]" 또는 "Authorization: Bearer [REDACTED]", 실제: "${result}"`
  );
  // 중복 [REDACTED] 금지
  assert.ok(!result.includes('[REDACTED] [REDACTED]'), `중복 마스킹 발견: "${result}"`);
});

test('curl Authorization 헤더', () => {
  const result = redactSecrets('curl -H "Authorization: Bearer abc"');
  assert.ok(!result.includes('[REDACTED] [REDACTED]'), `중복 마스킹 발견: "${result}"`);
  assert.ok(result.includes('[REDACTED]'), `마스킹 없음: "${result}"`);
});

test('X-API-Key 헤더 마스킹', () => {
  assert.strictEqual(redactSecrets('X-API-Key: myapikey'), 'X-API-Key: [REDACTED]');
});

// === URL 쿼리 파라미터 테스트 ===
console.log('\n--- URL 쿼리 파라미터 ---');

test('단일 token 파라미터', () => {
  assert.strictEqual(
    redactSecrets('https://api.example.com?token=abc123'),
    'https://api.example.com?token=[REDACTED]'
  );
});

test('복수 민감 파라미터', () => {
  const result = redactSecrets('https://x.test?a=1&token=abc&secret=def');
  assert.strictEqual(result, 'https://x.test?a=1&token=[REDACTED]&secret=[REDACTED]');
});

test('api_key 파라미터', () => {
  assert.strictEqual(
    redactSecrets('http://host?api_key=key123'),
    'http://host?api_key=[REDACTED]'
  );
});

// === 엣지 케이스 ===
console.log('\n--- 엣지 케이스 ---');

test('빈 문자열', () => {
  assert.strictEqual(redactSecrets(''), '');
});

test('null/undefined 처리', () => {
  assert.strictEqual(redactSecrets(null as unknown as string), null);
  assert.strictEqual(redactSecrets(undefined as unknown as string), undefined);
});

test('민감값 없는 문자열', () => {
  const safe = 'This is a normal command: ls -la';
  assert.strictEqual(redactSecrets(safe), safe);
});

test('복수 민감값', () => {
  const input = 'PGPASSWORD=pass1 API_KEY=key2';
  const result = redactSecrets(input);
  assert.ok(result.includes('PGPASSWORD=[REDACTED]'));
  assert.ok(result.includes('API_KEY=[REDACTED]'));
});

test('대소문자 무시', () => {
  assert.strictEqual(redactSecrets('pgpassword=secret'), 'pgpassword=[REDACTED]');
});

// === redactObject 테스트 ===
console.log('\n--- redactObject ---');

test('객체 내 문자열 마스킹', () => {
  const obj = { cmd: 'PGPASSWORD=secret psql' };
  const result = redactObject(obj);
  assert.strictEqual(result.cmd, 'PGPASSWORD=[REDACTED] psql');
});

test('중첩 객체 마스킹', () => {
  const obj = { outer: { inner: 'TOKEN=abc' } };
  const result = redactObject(obj);
  assert.strictEqual(result.outer.inner, 'TOKEN=[REDACTED]');
});

test('배열 마스킹', () => {
  const arr = ['PASS=1', 'normal', 'SECRET=2'];
  const result = redactObject(arr);
  assert.strictEqual(result[0], 'PASS=[REDACTED]');
  assert.strictEqual(result[1], 'normal');
  assert.strictEqual(result[2], 'SECRET=[REDACTED]');
});

test('null/undefined 보존', () => {
  assert.strictEqual(redactObject(null), null);
  assert.strictEqual(redactObject(undefined), undefined);
});

test('비문자열 값 보존', () => {
  const obj = { num: 42, bool: true, str: 'TOKEN=abc' };
  const result = redactObject(obj);
  assert.strictEqual(result.num, 42);
  assert.strictEqual(result.bool, true);
  assert.strictEqual(result.str, 'TOKEN=[REDACTED]');
});

// === 결과 출력 ===
console.log('\n=== 테스트 결과 ===');
console.log(`통과: ${passed}`);
console.log(`실패: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
