function historyUrl(request: Request) {
  const configured = process.env.TRANVIA_HISTORY_URL?.trim();
  if (!configured) return null;
  const upstream = new URL(configured);
  if (upstream.protocol !== 'https:') {
    throw new Error('TRANVIA_HISTORY_URL must use HTTPS');
  }
  const incoming = new URL(request.url);
  for (const key of ['days', 'route', 'direction', 'interval']) {
    const value = incoming.searchParams.get(key);
    if (value) upstream.searchParams.set(key, value);
  }
  return upstream;
}

export async function GET(request: Request) {
  const upstreamUrl = historyUrl(request);
  if (!upstreamUrl) {
    return Response.json({
      generatedAt: new Date().toISOString(),
      days: 30,
      intervalMinutes: 30,
      sampleCount: 0,
      observedDays: 0,
      firstSampleAt: null,
      lastSampleAt: null,
      points: [],
      collecting: true,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const relayToken = process.env.TRANVIA_REALTIME_TOKEN?.trim();
    const response = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { points?: unknown }).points)) {
      throw new Error('Unexpected upstream payload');
    }
    return Response.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch {
    return Response.json(
      { generatedAt: null, sampleCount: 0, observedDays: 0, firstSampleAt: null, lastSampleAt: null, points: [], collecting: true, error: 'Histórico no disponible.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
