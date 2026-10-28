import test from 'node:test';
import assert from 'node:assert/strict';
import { isFresh, timestampMs, upstreamFreshness } from '../lib/realtime-freshness.ts';

const now = Date.parse('2026-09-02T12:00:00Z');
test('invalid, missing, expired and future dates cannot be live', () => {
  for (const date of [null, NaN, now - 60_000, now + 6_000]) assert.equal(isFresh(date, now), false);
  assert.equal(timestampMs('invalid'), null);
  assert.equal(timestampMs(null), null);
  assert.equal(isFresh(now - 59_000, now), true);
});
test('legacy stale responses never gain a fresh timestamp', () => {
  const data = upstreamFreshness(new Headers({'X-Relay-Cache': 'STALE'}), now);
  assert.equal(data.stale, true);
  assert.equal(data.fetchedAt, null);
});
test('malformed relay timestamps fail closed', () => {
  const data = upstreamFreshness(new Headers({'X-Relay-Cache': 'HIT', 'X-Relay-Fetched-At': 'bad'}), now);
  assert.equal(data.stale, true);
  assert.equal(data.fetchedAt, null);
});
test('cache hits keep the upstream retrieval timestamp', () => {
  const headers = new Headers({'X-Relay-Cache': 'HIT', 'X-Relay-Fetched-At': '2026-09-02T11:59:55Z'});
  assert.equal(upstreamFreshness(headers, now).fetchedAt, '2026-09-02T11:59:55.000Z');
  assert.equal(upstreamFreshness(headers, now + 60_000).stale, true);
});
test('upstream errors mark even a recent cached position stale', () => {
  const headers = new Headers({'X-Relay-Cache': 'STALE', 'X-Relay-Fetched-At': '2026-09-02T11:59:55Z'});
  assert.equal(upstreamFreshness(headers, now).stale, true);
});
test('legacy cache hits conservatively subtract the entire cache window', () => {
  const result = upstreamFreshness(new Headers({'X-Relay-Cache': 'HIT'}), now);
  assert.equal(timestampMs(result.fetchedAt), now - 8000);
  assert.equal(result.stale, false);
});
