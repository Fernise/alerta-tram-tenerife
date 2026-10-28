import { CommunityRequestError, readCommunityText } from '@/lib/community-request';

function relayUrl() {
  const configured = process.env.TRANVIA_OCCUPANCY_URL?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('Push relay must use HTTPS');
  url.pathname = '/v1/push/subscriptions';
  url.search = '';
  return url;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function proxy(request: Request, method: 'POST' | 'DELETE') {
  if (!sameOrigin(request) || !request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'Solicitud no permitida.' }, { status: 403 });
  }
  let body: string;
  try {
    body = await readCommunityText(request, 16384);
    if (!body) return Response.json({ error: 'Solicitud no válida.' }, { status: 400 });
    JSON.parse(body);
  } catch (error) {
    return Response.json({ error: 'Solicitud no válida.' }, {
      status: error instanceof CommunityRequestError ? error.status : 400,
    });
  }
  const url = relayUrl();
  const token = process.env.TRANVIA_REALTIME_TOKEN?.trim();
  if (!url || !token) {
    return Response.json({ error: 'Push no disponible.' }, { status: 503 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Relay returned ${response.status}`);
    return Response.json({ ok: true }, { status: method === 'POST' ? 201 : 200 });
  } catch {
    return Response.json({ error: 'No se pudo guardar la suscripción.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  return proxy(request, 'POST');
}

export async function DELETE(request: Request) {
  return proxy(request, 'DELETE');
}
