function relayUrl(path: string) {
  const configured = process.env.TRANVIA_OCCUPANCY_URL?.trim();
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== 'https:') throw new Error('Push relay must use HTTPS');
  url.pathname = path;
  url.search = '';
  return url;
}

export async function GET() {
  const url = relayUrl('/v1/push/config');
  const token = process.env.TRANVIA_REALTIME_TOKEN?.trim();
  if (!url || !token) {
    return Response.json({ error: 'Push no disponible.' }, { status: 503 });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Relay returned ${response.status}`);
    const payload = (await response.json()) as { publicKey?: unknown };
    if (typeof payload.publicKey !== 'string' || payload.publicKey.length < 32) {
      throw new Error('Invalid push configuration');
    }
    return Response.json({ publicKey: payload.publicKey }, {
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
    });
  } catch {
    return Response.json({ error: 'Push no disponible.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } finally {
    clearTimeout(timeout);
  }
}
