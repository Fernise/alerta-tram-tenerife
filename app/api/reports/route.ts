import { communityDb } from '@/lib/community-db';
import { validateIncidentNote } from '@/lib/incident-note';
import { CommunityRequestError, readCommunityJson } from '@/lib/community-request';
import { acceptsCurrentCommunityTerms } from '@/lib/community-terms';
import { publicSourceToken } from '@/lib/community-source';
import {
  CommunityError as ApiError, REPORT_LIFETIME, UNDO_WINDOW, assertParticipation,
  confirmCommunityReport, createCommunityReport, dismissCommunityReport,
  purgeRestrictions, sameOrigin, undoCommunityDismissal,
} from '@/lib/community-safety';

const CREATE_COOLDOWN = 60 * 1000;
const REPORT_RETENTION = 90 * 24 * 60 * 60 * 1000;
const DAILY_CREATE_LIMIT = 8;
const ACTIVE_CREATE_LIMIT = 3;

const NETWORK: Record<string, Set<string>> = {
  L1: new Set([
    'La Trinidad', 'Padre Anchieta', 'Cruz de Piedra', 'Museo de la Ciencia',
    'Gracia', 'Campus Guajara', 'Las Mantecas', 'Hospital Universitario',
    'El Cardonal', 'Taco', 'Hospital La Candelaria', 'Príncipes de España',
    'Chimisay', 'Conservatorio', 'Cruz del Señor', 'Puente Zurita', 'La Paz',
    'Weyler', 'Teatro Guimerá', 'Fundación', 'Intercambiador',
  ]),
  L2: new Set(['La Cuesta', 'Ingenieros', 'Hospital Universitario', 'El Cardonal', 'San Jerónimo', 'Tíncer']),
};
const DIRECTIONS = new Set(['ida', 'vuelta']);
const ZONES = new Set(['Delante', 'Zona central', 'Detrás']);
const REPORT_KINDS = new Set(['inspection', 'incident']);
const INCIDENT_TYPES = new Set(['disruption', 'crowding', 'accessibility', 'other']);

type ReportRow = {
  id: string;
  line: 'L1' | 'L2';
  direction: 'ida' | 'vuelta';
  stop: string;
  zone: 'Delante' | 'Zona central' | 'Detrás';
  kind: 'inspection' | 'incident';
  incidentType: 'disruption' | 'crowding' | 'accessibility' | 'other' | null;
  note: string | null;
  createdAt: number;
  lastConfirmedAt: number;
  confirmations: number;
  flagCount?: number;
  moderatedAt?: number | null;
  moderationReason?: string | null;
  status?: string;
  reporterHash?: string;
  removedAt?: number | null;
  removedByHash?: string | null;
};

const reportColumns = `
  id, line, direction, stop, zone, kind, incident_type AS incidentType, note,
  created_at AS createdAt,
  last_confirmed_at AS lastConfirmedAt,
  confirmations
`;

function jsonError(error: unknown) {
  if (error instanceof CommunityRequestError) {
    return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (error instanceof ApiError) {
    return Response.json({ error: error.code, ...error.details }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ error: 'reports_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

async function deviceHash(request: Request) {
  const deviceId = request.headers.get('x-alerta-device')?.trim() || '';
  if (!/^[a-zA-Z0-9-]{16,128}$/.test(deviceId)) throw new ApiError(400, 'invalid_device');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`alerta-tram:${deviceId}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validReportInput(value: unknown) {
  if (!value || typeof value !== 'object') throw new ApiError(400, 'invalid_report');
  const body = value as Record<string, unknown>;
  const line = typeof body.line === 'string' ? body.line : '';
  const direction = typeof body.direction === 'string' ? body.direction : '';
  const stop = typeof body.stop === 'string' ? body.stop : '';
  const zone = typeof body.zone === 'string' ? body.zone : '';
  const kind = typeof body.kind === 'string' ? body.kind : 'inspection';
  const incidentType = typeof body.incidentType === 'string' ? body.incidentType : '';
  if (!Object.hasOwn(NETWORK, line) || !NETWORK[line].has(stop) || !DIRECTIONS.has(direction) || !ZONES.has(zone) || !REPORT_KINDS.has(kind)) {
    throw new ApiError(400, 'invalid_report');
  }
  if (kind === 'incident' && !INCIDENT_TYPES.has(incidentType)) throw new ApiError(400, 'invalid_report');
  let note: string | null = null;
  if (kind === 'incident' && incidentType === 'other') {
    const validation = validateIncidentNote(body.note);
    if (!validation.ok) throw new ApiError(400, 'invalid_report_note', { noteIssue: validation.issue });
    note = validation.note;
  }
  return {
    line: line as 'L1' | 'L2',
    direction: direction as 'ida' | 'vuelta',
    stop,
    zone: zone as ReportRow['zone'],
    kind: kind as ReportRow['kind'],
    incidentType: kind === 'incident' ? incidentType as NonNullable<ReportRow['incidentType']> : null,
    note,
  };
}

async function findReport(id: string) {
  const database = communityDb();
  return database.prepare(`SELECT ${reportColumns}, status, reporter_hash AS reporterHash, removed_at AS removedAt, removed_by_hash AS removedByHash FROM community_reports WHERE id = ?`)
    .bind(id).first<ReportRow>();
}

function publicReport(report: ReportRow | null) {
  if (!report || (report.status && report.status !== 'active') || report.lastConfirmedAt <= Date.now() - REPORT_LIFETIME) return null;
  const { id, line, direction, stop, zone, kind, incidentType, note, createdAt, lastConfirmedAt, confirmations } = report;
  return { id, line, direction, stop, zone, kind, incidentType, note, createdAt, lastConfirmedAt, confirmations, sourceToken: publicSourceToken(report.reporterHash) };
}

export async function GET() {
  try {
    const cutoff = Date.now() - REPORT_LIFETIME;
    const database = communityDb();
    await purgeRestrictions(database, Date.now());
    // Keep a moderation anchor while its device pause is active, so the owner
    // can always release it. Normally reports are purged after 90 days.
    await database.prepare(`DELETE FROM community_reports WHERE created_at < ?
      AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = reporter_hash AND expires_at > ?)`)
      .bind(Date.now() - REPORT_RETENTION, Date.now()).run();
    const result = await database.prepare(`
      SELECT ${reportColumns}, reporter_hash AS reporterHash
      FROM community_reports
      WHERE status = 'active' AND last_confirmed_at > ?
      ORDER BY last_confirmed_at DESC
      LIMIT 100
    `).bind(cutoff).all<ReportRow>();
    return Response.json({ reports: result.results.map(publicReport).filter(Boolean) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new ApiError(403, 'invalid_origin');
    if (!acceptsCurrentCommunityTerms(request)) throw new ApiError(428, 'community_terms_required');
    const hash = await deviceHash(request);
    const input = validReportInput(await readCommunityJson(request));
    const database = communityDb();
    const now = Date.now();
    await assertParticipation(database, hash, now);
    const dailyCount = await database.prepare('SELECT COUNT(*) AS total FROM community_reports WHERE reporter_hash = ? AND created_at > ?')
      .bind(hash, now - 24 * 60 * 60 * 1000).first<{ total: number }>();
    if ((dailyCount?.total || 0) >= DAILY_CREATE_LIMIT) throw new ApiError(429, 'daily_create_limit');
    const activeCount = await database.prepare(`SELECT COUNT(*) AS total FROM community_reports
      WHERE reporter_hash = ? AND status = 'active' AND last_confirmed_at > ?`)
      .bind(hash, now - REPORT_LIFETIME).first<{ total: number }>();
    if ((activeCount?.total || 0) >= ACTIVE_CREATE_LIMIT) throw new ApiError(429, 'active_create_limit');
    const recent = await database.prepare('SELECT created_at AS createdAt FROM community_reports WHERE reporter_hash = ? ORDER BY created_at DESC LIMIT 1')
      .bind(hash).first<{ createdAt: number }>();
    if (recent && now - recent.createdAt < CREATE_COOLDOWN) {
      throw new ApiError(429, 'create_cooldown', { retryAfterSeconds: Math.ceil((CREATE_COOLDOWN - (now - recent.createdAt)) / 1000) });
    }

    const duplicate = await database.prepare(`
      SELECT ${reportColumns}
      FROM community_reports
      WHERE line = ? AND direction = ? AND stop = ? AND kind = ?
        AND incident_type IS ? AND status = 'active' AND last_confirmed_at > ?
      ORDER BY last_confirmed_at DESC LIMIT 1
    `).bind(input.line, input.direction, input.stop, input.kind, input.incidentType, now - REPORT_LIFETIME).first<ReportRow>();

    if (duplicate) {
      await confirmCommunityReport(database, duplicate.id, hash, now);
      return Response.json({ report: publicReport(await findReport(duplicate.id)), deduplicated: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const id = crypto.randomUUID();
    const created = await createCommunityReport(database, id, hash, input, now);
    return Response.json({ report: publicReport(await findReport(created.id)), deduplicated: created.deduplicated },
      { status: created.deduplicated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) throw new ApiError(403, 'invalid_origin');
    const hash = await deviceHash(request);
    const value = await readCommunityJson(request);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'invalid_action');
    const body = value as { id?: unknown; action?: unknown };
    const id = typeof body.id === 'string' ? body.id : '';
    const action = typeof body.action === 'string' ? body.action : '';
    if (!/^[a-f0-9-]{16,64}$/i.test(id) || !['confirm', 'dismiss', 'undo'].includes(action)) {
      throw new ApiError(400, 'invalid_action');
    }
    const database = communityDb();
    const now = Date.now();
    await assertParticipation(database, hash, now);
    const report = await findReport(id);
    if (!report) throw new ApiError(404, 'report_not_found');

    if (action === 'confirm') {
      await confirmCommunityReport(database, id, hash, now);
      return Response.json({ report: publicReport(await findReport(id)) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action === 'dismiss') {
      await dismissCommunityReport(database, id, hash, now);
      return Response.json({ removed: true, undoUntil: now + UNDO_WINDOW }, { headers: { 'Cache-Control': 'no-store' } });
    }

    await undoCommunityDismissal(database, id, hash, now);
    return Response.json({ report: publicReport(await findReport(id)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return jsonError(error);
  }
}
