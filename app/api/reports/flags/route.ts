import { communityDb } from '@/lib/community-db';
import { CommunityRequestError, readCommunityJson } from '@/lib/community-request';
import { CommunityError as FlagError, REPORT_LIFETIME, assertParticipation, flagCommunityReport, sameOrigin } from '@/lib/community-safety';

const REASONS = new Set(['personal_data', 'false_or_spam', 'inappropriate']);
const DAILY_FLAG_LIMIT = 10;

async function deviceHash(request: Request) {
  const deviceId = request.headers.get('x-alerta-device')?.trim() || '';
  if (!/^[a-zA-Z0-9-]{16,128}$/.test(deviceId)) throw new FlagError(400, 'invalid_device');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`alerta-tram:${deviceId}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new FlagError(403, 'invalid_origin');
    const hash = await deviceHash(request);
    const raw = await readCommunityJson(request);
    const body = (raw && typeof raw === 'object' ? raw : {}) as { id?: unknown; reason?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (!/^[a-f0-9-]{16,64}$/i.test(id) || !REASONS.has(reason)) throw new FlagError(400, 'invalid_flag');

    const database = communityDb();
    const now = Date.now();
    await assertParticipation(database, hash, now);
    const report = await database.prepare(`SELECT id, status, reporter_hash AS reporterHash, last_confirmed_at AS lastConfirmedAt
      FROM community_reports WHERE id = ?`).bind(id).first<{ id: string; status: string; reporterHash: string; lastConfirmedAt: number }>();
    if (!report || report.status !== 'active' || now - report.lastConfirmedAt >= REPORT_LIFETIME) throw new FlagError(404, 'report_not_active');
    if (report.reporterHash === hash) throw new FlagError(403, 'own_report');

    const existing = await database.prepare('SELECT 1 AS present FROM report_flags WHERE report_id = ? AND device_hash = ?')
      .bind(id, hash).first<{ present: number }>();
    if (existing) throw new FlagError(409, 'already_flagged');
    const daily = await database.prepare('SELECT COUNT(*) AS total FROM report_flags WHERE device_hash = ? AND created_at > ?')
      .bind(hash, now - 24 * 60 * 60 * 1000).first<{ total: number }>();
    if ((daily?.total || 0) >= DAILY_FLAG_LIMIT) throw new FlagError(429, 'flag_limit');

    const { hidden } = await flagCommunityReport(database, id, hash, reason, now);
    return Response.json({ flagged: true, hidden }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CommunityRequestError) return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof FlagError) return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ error: 'flag_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
