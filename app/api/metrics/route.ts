import { communityDb } from '@/lib/community-db';
import { CommunityRequestError, readCommunityJson } from '@/lib/community-request';

const EVENTS = new Set([
  'page_load',
  'language_changed',
  'guide_opened',
  'report_form_opened',
  'report_published',
  'inspection_published',
  'incident_published',
  'report_confirmed',
  'report_dismissed',
  'report_flagged',
  'notifications_enabled',
  'notification_test_sent',
  'pwa_installed',
]);

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return new Response(null, { status: 403 });
    const raw = await readCommunityJson(request);
    const body = (raw && typeof raw === 'object' ? raw : {}) as { event?: unknown; language?: unknown };
    const event = typeof body.event === 'string' ? body.event : '';
    const language = body.language === 'en' ? 'en' : body.language === 'es' ? 'es' : '';
    if (!EVENTS.has(event) || !language) return new Response(null, { status: 400 });

    const database = communityDb();
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const retentionCutoff = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await database.batch([
      database.prepare('DELETE FROM anonymous_metrics WHERE day < ?').bind(retentionCutoff),
      database.prepare(`INSERT INTO anonymous_metrics (day, event, language, count) VALUES (?, ?, ?, 1)
        ON CONFLICT(day, event, language) DO UPDATE SET count = count + 1`).bind(day, event, language),
    ]);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof CommunityRequestError) {
      return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET(request: Request) {
  const configured = process.env.METRICS_ADMIN_TOKEN?.trim();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!configured || supplied !== configured) return Response.json({ error: 'not_found' }, { status: 404 });
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const result = await communityDb().prepare(`
      SELECT day, event, language, count
      FROM anonymous_metrics
      WHERE day >= ?
      ORDER BY day DESC, event, language
    `).bind(cutoff).all<{ day: string; event: string; language: string; count: number }>();
    return Response.json({ generatedAt: new Date().toISOString(), metrics: result.results }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'metrics_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
