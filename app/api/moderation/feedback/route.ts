import { communityDb } from '@/lib/community-db';
import { isOwner } from '@/lib/owner-auth';
import { FEEDBACK_RETENTION, FeedbackError, readSmallJson, sameOrigin } from '@/lib/beta-feedback';

const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: Request) {
  if (!isOwner(request)) return Response.json({ error: 'not_found' }, { status: 404, headers });
  const status = new URL(request.url).searchParams.get('status') === 'reviewed' ? 'reviewed' : 'pending';
  const page = Number(new URL(request.url).searchParams.get('page') || '0');
  if (!Number.isInteger(page) || page < 0 || page > 100) return Response.json({ error: 'invalid_page' }, { status: 400, headers });
  try {
    const results = await communityDb().batch([
      communityDb().prepare('DELETE FROM beta_feedback WHERE created_at <= ?').bind(Date.now() - FEEDBACK_RETENTION),
      communityDb().prepare(`SELECT id, category, message, platform, language, created_at AS createdAt, reviewed_at AS reviewedAt
        FROM beta_feedback WHERE reviewed_at IS ${status === 'pending' ? '' : 'NOT '}NULL ORDER BY created_at DESC, id DESC LIMIT 101 OFFSET ?`).bind(page * 100),
    ]);
    if (results.some((result) => !result.success)) throw new Error('unavailable');
    const rows = results[1].results;
    return Response.json({ feedback: rows.slice(0, 100), hasMore: rows.length > 100 }, { headers });
  } catch { return Response.json({ error: 'feedback_unavailable' }, { status: 503, headers }); }
}

export async function PATCH(request: Request) {
  if (!isOwner(request)) return Response.json({ error: 'not_found' }, { status: 404, headers });
  if (!sameOrigin(request)) return Response.json({ error: 'invalid_origin' }, { status: 403, headers });
  try {
    const raw = await readSmallJson(request);
    const { id, action } = (raw && typeof raw === 'object' ? raw : {}) as { id?: unknown; action?: unknown };
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || !['review', 'reopen', 'delete'].includes(action as string)) throw new FeedbackError(400, 'invalid_action');
    const statement = action === 'delete'
      ? communityDb().prepare('DELETE FROM beta_feedback WHERE id = ?').bind(id)
      : communityDb().prepare('UPDATE beta_feedback SET reviewed_at = ? WHERE id = ?').bind(action === 'review' ? Date.now() : null, id);
    const result = await statement.run();
    if (!result.success) throw new Error('unavailable');
    if (!result.meta.changes) return Response.json({ error: 'not_found' }, { status: 404, headers });
    return Response.json({ updated: true }, { headers });
  } catch (error) { return Response.json({ error: error instanceof FeedbackError ? error.code : 'feedback_unavailable' }, { status: error instanceof FeedbackError ? error.status : 503, headers }); }
}
