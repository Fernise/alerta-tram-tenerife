import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const relay = readFileSync(new URL('../infra/realtime-relay/server.py', import.meta.url), 'utf8');

test('history response reports coverage without exposing individual services', () => {
  assert.match(relay, /"observedDays": len\(observed_days\)/);
  assert.match(relay, /"daysObserved": len\(bucket\["days"\]\)/);
  assert.match(relay, /"firstSampleAt"/);
  assert.match(relay, /"lastSampleAt"/);
  assert.doesNotMatch(relay.match(/def _history[\s\S]*?class RelayHandler/)?.[0] ?? '', /"service"\s*:/);
});
