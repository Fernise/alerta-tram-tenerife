import { upstreamFreshness } from '@/lib/realtime-freshness';

type UpstreamTram = {
  service?: string | number;
  coordinate?: { lat?: number; lon?: number };
  route?: number;
  direction?: number;
  remainingMinutes?: number;
  nextStop?: string;
  nextStopDescription?: string;
  destinationStop?: string;
  destinationStopDescription?: string;
  orderStop?: number;
};

type Terminal = {
  stop: string;
  lat: number;
  lon: number;
};

// Cabildo de Tenerife / Metrotenerife open stop coordinates (CC BY).
// The live feed can keep a positive remainingMinutes value while a vehicle is
// dwelling at a terminal, so position is the reliable signal in that case.
const TERMINALS: Record<string, Terminal> = {
  '1:1': { stop: 'TRI', lat: 28.48579349, lon: -16.31643223 },
  '1:2': { stop: 'INT', lat: 28.45893894, lon: -16.25105038 },
  '2:1': { stop: 'CUE', lat: 28.46707, lon: -16.28602 },
  '2:2': { stop: 'TIN', lat: 28.44376, lon: -16.30459 },
};
const TERMINAL_RADIUS_METERS = 40;

const DEFAULT_VEHICLE_LOCATION_URL =
  'https://tranviaonline.metrotenerife.com/api/infoStops/vehicleLocation';

function getVehicleLocationUrl() {
  const configured = process.env.TRANVIA_REALTIME_URL?.trim();
  const url = new URL(configured || DEFAULT_VEHICLE_LOCATION_URL);
  if (url.protocol !== 'https:') {
    throw new Error('TRANVIA_REALTIME_URL must use HTTPS');
  }
  return url.toString();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function distanceMeters(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to.lat - from.lat);
  const longitudeDelta = radians(to.lon - from.lon);
  const fromLatitude = radians(from.lat);
  const toLatitude = radians(to.lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function normalizeTram(item: UpstreamTram) {
  if (
    !item || typeof item !== 'object' ||
    (item.route !== 1 && item.route !== 2) ||
    (item.direction !== 1 && item.direction !== 2) ||
    !isFiniteNumber(item.coordinate?.lat) ||
    !isFiniteNumber(item.coordinate?.lon) ||
    !item.nextStop ||
    !item.destinationStop
  ) {
    return null;
  }

  const terminal = TERMINALS[`${item.route}:${item.direction}`];
  const reportedMinutes = isFiniteNumber(item.remainingMinutes)
    ? Math.max(0, Math.round(item.remainingMinutes))
    : null;
  const atTerminal = Boolean(
    terminal
    && item.nextStop === terminal.stop
    && distanceMeters({ lat: item.coordinate.lat, lon: item.coordinate.lon }, terminal) <= TERMINAL_RADIUS_METERS,
  );

  return {
    service: String(item.service ?? ''),
    route: item.route,
    direction: item.direction,
    coordinate: { lat: item.coordinate.lat, lon: item.coordinate.lon },
    remainingMinutes: atTerminal ? 0 : reportedMinutes,
    departureMinutes: atTerminal ? reportedMinutes : null,
    atTerminal,
    nextStop: item.nextStop,
    nextStopDescription: item.nextStopDescription || item.nextStop,
    destinationStop: item.destinationStop,
    destinationStopDescription:
      item.destinationStopDescription || item.destinationStop,
    orderStop: isFiniteNumber(item.orderStop) ? item.orderStop : null,
  };
}

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const relayToken = process.env.TRANVIA_REALTIME_TOKEN?.trim();
    const upstream = await fetch(getVehicleLocationUrl(), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AlertaTram/1.0 (+authorized Metrotenerife integration)',
        ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
      },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      throw new Error(`Upstream returned ${upstream.status}`);
    }

    const payload = (await upstream.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error('Unexpected upstream payload');

    const trams = payload
      .map((item) => normalizeTram(item as UpstreamTram))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (payload.length > 0 && trams.length === 0) throw new Error('Invalid vehicle data');

    return Response.json(
      {
        source: 'Metrotenerife · TranvíaOnline',
        ...upstreamFreshness(upstream.headers),
        trams,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'La fuente oficial no respondió a tiempo.'
        : 'No se pudieron obtener las posiciones oficiales.';

    return Response.json(
      { source: 'Metrotenerife · TranvíaOnline', fetchedAt: null, trams: [], error: message },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
