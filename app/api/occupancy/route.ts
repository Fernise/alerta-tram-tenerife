import { upstreamFreshness } from '@/lib/realtime-freshness';

type UpstreamOccupancy = {
  VEHICULO?: string | number;
  FECHA?: string;
  SERVICIO?: string | number;
  CARGA?: string | number;
  vehicle?: string | number | null;
  service?: string | number;
  load?: string | number;
  sourceAt?: string | null;
};

const DEFAULT_OCCUPANCY_URL =
  'https://tranviaonline.metrotenerife.com/api/cargaVehiculo';

function getOccupancyUrl() {
  const configured = process.env.TRANVIA_OCCUPANCY_URL?.trim();
  const url = new URL(configured || DEFAULT_OCCUPANCY_URL);
  if (url.protocol !== 'https:') {
    throw new Error('TRANVIA_OCCUPANCY_URL must use HTTPS');
  }
  return url.toString();
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedLoad(rawLoad: number) {
  const thresholds: Array<[number, number]> = [
    [5, 3], [8, 7], [11, 10], [14, 14], [17, 18], [20, 22],
    [23, 25], [26, 29], [29, 33], [32, 36], [35, 40], [38, 44],
    [41, 48], [44, 51], [47, 55], [50, 59], [53, 62], [56, 66],
    [59, 70], [62, 74], [65, 77], [68, 81], [71, 85], [74, 89],
    [77, 92], [80, 96],
  ];
  return thresholds.find(([upper]) => rawLoad < upper)?.[1] ?? 100;
}

function normalize(item: UpstreamOccupancy) {
  if (!item || typeof item !== 'object') return null;
  const service = String(item.service ?? item.SERVICIO ?? '').trim();
  const relayLoad = numeric(item.load);
  const rawLoad = numeric(item.CARGA);
  const load = relayLoad ?? (rawLoad === null ? null : normalizedLoad(Math.max(0, rawLoad)));
  const vehicle = numeric(item.vehicle ?? item.VEHICULO);
  if (!service || load === null) return null;
  return {
    service,
    vehicle: vehicle === null ? null : Math.round(vehicle),
    load: Math.max(0, Math.min(100, Math.round(load))),
    rawLoad: rawLoad === null ? null : Math.max(0, Math.round(rawLoad)),
    sourceAt: item.sourceAt ?? item.FECHA ?? null,
  };
}

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const relayToken = process.env.TRANVIA_REALTIME_TOKEN?.trim();
    const upstream = await fetch(getOccupancyUrl(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AlertaTram/2.0 (+authorized Metrotenerife integration)',
        ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
      },
      signal: controller.signal,
    });
    if (!upstream.ok) throw new Error(`Upstream returned ${upstream.status}`);
    const payload = (await upstream.json()) as unknown;
    const items = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload && 'occupancy' in payload
        ? (payload as { occupancy?: unknown }).occupancy
        : null;
    if (!Array.isArray(items)) throw new Error('Unexpected upstream payload');
    const occupancy = items
      .map((item) => normalize(item as UpstreamOccupancy))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length > 0 && occupancy.length === 0) throw new Error('Invalid occupancy data');
    return Response.json(
      { source: 'Metrotenerife · TranvíaOnline', ...upstreamFreshness(upstream.headers), occupancy },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { source: 'Metrotenerife · TranvíaOnline', fetchedAt: null, occupancy: [], error: 'Ocupación no disponible.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
