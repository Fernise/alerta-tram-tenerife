import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicSourceToken } from '../lib/community-source.ts';

test('public source tokens are bounded, pseudonymous and fail closed', () => {
  const digest = 'abcdef0123456789'.repeat(4);
  assert.equal(publicSourceToken(digest), 'source_abcdef0123456789');
  for (const invalid of [null, undefined, '', 'a'.repeat(63), 'z'.repeat(64), {}]) assert.equal(publicSourceToken(invalid), null);
});

test('reports expose only the bounded source token and map all GET results through the public shape', () => {
  const route = readFileSync(new URL('../app/api/reports/route.ts', import.meta.url), 'utf8');
  assert.match(route, /sourceToken: publicSourceToken\(report\.reporterHash\)/);
  assert.match(route, /reports: result\.results\.map\(publicReport\)\.filter\(Boolean\)/);
  const publicShape = route.slice(route.indexOf('function publicReport'), route.indexOf('export async function GET'));
  assert.doesNotMatch(publicShape, /reporterHash[, }]/);
});

test('the interface can block and undo a source locally without a server mutation', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /BLOCKED_SOURCES_STORAGE_KEY/);
  assert.match(page, /!blockedSourceTokens\.includes\(item\.sourceToken\)/);
  assert.match(page, /function blockReportSource\(report: Report\)/);
  assert.match(page, /function undoSourceBlock\(\)/);
  const blockFunction = page.slice(page.indexOf('function blockReportSource'), page.indexOf('function undoSourceBlock'));
  assert.doesNotMatch(blockFunction, /fetch\(/);
});
