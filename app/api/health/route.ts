import { GET as getTrams } from '../trams/route';
import { GET as getOccupancy } from '../occupancy/route';
import { communityDb } from '@/lib/community-db';
import { isFresh, timestampMs, OCCUPANCY_MAX_AGE_MS } from '@/lib/realtime-freshness';

async function feedCheck(load: () => Promise<Response>) {
  try {
    const response = await load();
    const body = await response.json() as { fetchedAt?: string; stale?: boolean; occupancy?: { sourceAt?: string }[] };
    if (!response.ok) return 'unavailable';
    if (body.occupancy?.length && !body.occupancy.some((item) => isFresh(timestampMs(item.sourceAt), Date.now(), OCCUPANCY_MAX_AGE_MS))) return 'stale';
    return !body.stale && isFresh(timestampMs(body.fetchedAt), Date.now()) ? 'ok' : 'stale';
  } catch { return 'unavailable'; }
}

// Coarse readiness only: never disclose origins, keys, database rows or identities.
// A failed feed does not prove a VPN failure or a transport-service interruption.
export async function GET() {
  const [positions, occupancy, community] = await Promise.all([
    feedCheck(getTrams),
    feedCheck(getOccupancy),
    (async () => {
      try {
        await communityDb().prepare('SELECT id FROM community_reports LIMIT 1').first();
        return 'ok';
      } catch { return 'unavailable'; }
    })(),
  ]);
  const ok = [positions, occupancy, community].every((check) => check === 'ok');
  return Response.json({
    status: ok ? 'ok' : 'degraded', checkedAt: new Date().toISOString(),
    checks: { positions, occupancy, community },
  }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
