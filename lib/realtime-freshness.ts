// Age means time since a successful upstream retrieval, not a verified GPS fix.
export const LIVE_MAX_AGE_MS = 60_000;
export const OCCUPANCY_MAX_AGE_MS = 120_000;

export function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isFresh(timestamp: number | null, now: number, maxAge = LIVE_MAX_AGE_MS) {
  return timestamp !== null && Number.isFinite(timestamp)
    && timestamp <= now + 5_000 && now - timestamp < maxAge;
}

export function upstreamFreshness(headers: Headers, now = Date.now()) {
  const relay = headers.get('X-Relay-Cache');
  const header = headers.get('X-Relay-Fetched-At');
  const retrieved = timestampMs(header);
  // Older relays lack timestamps. Their HIT/MISS cache is bounded to 8 seconds;
  // subtract that entire window, rather than resetting its age on each request.
  // A legacy STALE response has unknown age and must never look live.
  const fetchedAt = header !== null ? retrieved
    : (relay?.toUpperCase() === 'STALE' ? null : now - (relay ? 8_000 : 0));
  return {
    fetchedAt: fetchedAt === null ? null : new Date(fetchedAt).toISOString(),
    stale: relay?.toUpperCase() === 'STALE' || !isFresh(fetchedAt, now),
    timestampBasis: retrieved === null ? 'retrieval-estimate' : 'relay-retrieval',
  };
}
