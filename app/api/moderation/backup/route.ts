import { communityDb } from '@/lib/community-db';
import { isOwner } from '@/lib/owner-auth';
import { exportCommunityBackup } from '@/lib/community-backup';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function POST(request: Request) {
  if (!isOwner(request)) return Response.json({ error: 'not_found' }, { status: 404, headers: privateHeaders });
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: 'invalid_origin' }, { status: 403, headers: privateHeaders });
  }
  try {
    const snapshot = await exportCommunityBackup(communityDb());
    const json = JSON.stringify(snapshot);
    if (new TextEncoder().encode(json).byteLength > 20_000_000) throw new Error('backup_too_large');
    return new Response(json, { headers: {
      ...privateHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="alerta-tram-community-${snapshot.createdAt.replace(/[:.]/g, '-')}.json"`,
    } });
  } catch (error) {
    const oversized = error instanceof Error && error.message === 'backup_too_large';
    return Response.json({ error: oversized ? 'backup_too_large' : 'backup_unavailable' },
      { status: oversized ? 413 : 503, headers: privateHeaders });
  }
}
