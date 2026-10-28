import { communityDb } from '@/lib/community-db';
import { isOwner } from '@/lib/owner-auth';
import { CommunityRequestError, readCommunityJson } from '@/lib/community-request';
import { CommunityError, REPORT_LIFETIME, moderateCommunityReport, purgeRestrictions, sameOrigin, type ModerationAction } from '@/lib/community-safety';

const privateHeaders = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  if (!isOwner(request)) return Response.json({ error: 'not_found' }, { status: 404, headers: privateHeaders });
  try {
    const database = communityDb();
    const now = Date.now();
    await purgeRestrictions(database, now);
    const [result, pauses] = await database.batch([database.prepare(`
      SELECT r.id, r.line, r.direction, r.stop, r.zone, r.kind,
        r.incident_type AS incidentType, r.note,
        r.created_at AS createdAt, r.last_confirmed_at AS lastConfirmedAt,
        r.confirmations, r.flag_count AS flagCount, r.status,
        r.moderated_at AS moderatedAt, r.moderation_reason AS moderationReason,
        s.expires_at AS restrictionUntil,
        SUM(CASE WHEN f.reason = 'personal_data' THEN 1 ELSE 0 END) AS personalDataFlags,
        SUM(CASE WHEN f.reason = 'false_or_spam' THEN 1 ELSE 0 END) AS spamFlags,
        SUM(CASE WHEN f.reason = 'inappropriate' THEN 1 ELSE 0 END) AS inappropriateFlags
      FROM community_reports r
      LEFT JOIN report_flags f ON f.report_id = r.id
      LEFT JOIN community_restrictions s ON s.device_hash = r.reporter_hash AND s.expires_at > ?
      WHERE r.flag_count > 0 OR r.status = 'moderated'
      GROUP BY r.id
      ORDER BY COALESCE(r.moderated_at, r.last_confirmed_at) DESC
      LIMIT 200
    `).bind(now), database.prepare(`SELECT MIN(r.id) AS reportId, s.expires_at AS expiresAt
      FROM community_restrictions s JOIN community_reports r ON r.reporter_hash = s.device_hash
      WHERE s.expires_at > ? GROUP BY s.device_hash ORDER BY s.expires_at`).bind(now)]);
    return Response.json({ reports: result.results, pauses: pauses.results, activeCutoff: now - REPORT_LIFETIME }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: 'moderation_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function PATCH(request: Request) {
  if (!isOwner(request)) return Response.json({ error: 'not_found' }, { status: 404, headers: privateHeaders });
  if (!sameOrigin(request)) return Response.json({ error: 'invalid_origin' }, { status: 403, headers: privateHeaders });
  try {
    const raw = await readCommunityJson(request);
    const body = (raw && typeof raw === 'object' ? raw : {}) as { id?: unknown; action?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    const action = typeof body.action === 'string' ? body.action : '';
    if (!/^[a-f0-9-]{16,64}$/i.test(id) || !['remove', 'restore', 'restrict', 'release'].includes(action)) {
      return Response.json({ error: 'invalid_action' }, { status: 400, headers: privateHeaders });
    }
    const database = communityDb();
    await moderateCommunityReport(database, id, action as ModerationAction, Date.now());
    return Response.json({ updated: true, action }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof CommunityRequestError) return Response.json({ error: error.code }, { status: error.status, headers: privateHeaders });
    if (error instanceof CommunityError) return Response.json({ error: error.code }, { status: error.status, headers: privateHeaders });
    return Response.json({ error: 'moderation_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
