export const REPORT_LIFETIME = 15 * 60_000;
export const CONFIRM_COOLDOWN = 10 * 60_000;
export const RESTRICTION_DURATION = 24 * 60 * 60_000;
export const UNDO_WINDOW = 5 * 60_000;

export class CommunityError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, details?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}

export async function assertParticipation(database: D1Database, hash: string, now: number) {
  const restriction = await database.prepare(`SELECT expires_at AS expiresAt FROM community_restrictions
    WHERE device_hash = ? AND expires_at > ?`).bind(hash, now).first<{ expiresAt: number }>();
  if (restriction) throw new CommunityError(403, 'device_restricted', { restrictionUntil: restriction.expiresAt });
}

export async function purgeRestrictions(database: D1Database, now: number) {
  await database.prepare('DELETE FROM community_restrictions WHERE expires_at <= ?').bind(now).run();
}

// Every permission/cooldown predicate is repeated INSIDE the write, not only in
// a preceding read. D1 batches are transactions; changes() refers to the preceding
// write on the same SQLite connection. Do not insert a write between these pairs.
export async function confirmCommunityReport(database: D1Database, id: string, hash: string, now: number) {
  const results = await database.batch([
    database.prepare(`INSERT INTO report_confirmations (report_id, device_hash, confirmed_at)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM community_reports WHERE id = ?
        AND status = 'active' AND last_confirmed_at > ?)
      AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = ? AND expires_at > ?)
      ON CONFLICT(report_id, device_hash) DO UPDATE SET confirmed_at = excluded.confirmed_at
      WHERE report_confirmations.confirmed_at <= ?`)
      .bind(id, hash, now, id, now - REPORT_LIFETIME, hash, now, now - CONFIRM_COOLDOWN),
    database.prepare(`UPDATE community_reports SET confirmations = confirmations + 1,
      last_confirmed_at = MAX(last_confirmed_at, ?) WHERE id = ? AND changes() = 1`).bind(now, id),
  ]);
  if (results[0].meta.changes === 1) return;
  await assertParticipation(database, hash, now);
  const report = await database.prepare(`SELECT status, last_confirmed_at AS lastConfirmedAt
    FROM community_reports WHERE id = ?`).bind(id).first<{ status: string; lastConfirmedAt: number }>();
  if (!report || report.status !== 'active' || report.lastConfirmedAt <= now - REPORT_LIFETIME) {
    throw new CommunityError(409, 'report_expired');
  }
  const previous = await database.prepare(`SELECT confirmed_at AS confirmedAt FROM report_confirmations
    WHERE report_id = ? AND device_hash = ?`).bind(id, hash).first<{ confirmedAt: number }>();
  throw new CommunityError(429, 'confirm_cooldown', {
    retryAfterMinutes: Math.max(1, Math.ceil(((previous?.confirmedAt ?? now) + CONFIRM_COOLDOWN - now) / 60_000)),
  });
}

type NewReport = {
  line: string; direction: string; stop: string; zone: string;
  kind: string; incidentType: string | null; note: string | null;
};

export async function createCommunityReport(database: D1Database, id: string, hash: string, input: NewReport, now: number) {
  const results = await database.batch([
    database.prepare(`INSERT INTO community_reports
      (id, line, direction, stop, zone, kind, incident_type, note, created_at, last_confirmed_at, confirmations, status, reporter_hash)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?
      WHERE NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = ? AND expires_at > ?)
      AND NOT EXISTS (SELECT 1 FROM community_reports WHERE reporter_hash = ? AND created_at > ?)
      AND (SELECT COUNT(*) FROM community_reports WHERE reporter_hash = ? AND created_at > ?) < 8
      AND (SELECT COUNT(*) FROM community_reports WHERE reporter_hash = ? AND status = 'active' AND last_confirmed_at > ?) < 3
      AND NOT EXISTS (SELECT 1 FROM community_reports WHERE line = ? AND direction = ? AND stop = ?
        AND kind = ? AND incident_type IS ? AND status = 'active' AND last_confirmed_at > ?)`)
      .bind(id, input.line, input.direction, input.stop, input.zone, input.kind, input.incidentType, input.note, now, now, hash,
        hash, now, hash, now - 60_000, hash, now - 24 * 60 * 60_000, hash, now - REPORT_LIFETIME,
        input.line, input.direction, input.stop, input.kind, input.incidentType, now - REPORT_LIFETIME),
    database.prepare(`INSERT INTO report_confirmations (report_id, device_hash, confirmed_at)
      SELECT ?, ?, ? WHERE changes() = 1`).bind(id, hash, now),
  ]);
  if (results[0].meta.changes === 1) return { id, deduplicated: false };
  await assertParticipation(database, hash, now);
  // A competing creation may have won since the route's preflight reads.
  const duplicate = await database.prepare(`SELECT id FROM community_reports WHERE line = ? AND direction = ? AND stop = ?
    AND kind = ? AND incident_type IS ? AND status = 'active' AND last_confirmed_at > ? LIMIT 1`)
    .bind(input.line, input.direction, input.stop, input.kind, input.incidentType, now - REPORT_LIFETIME).first<{ id: string }>();
  if (duplicate) {
    await confirmCommunityReport(database, duplicate.id, hash, now);
    return { id: duplicate.id, deduplicated: true };
  }
  throw new CommunityError(429, 'create_cooldown');
}

export async function dismissCommunityReport(database: D1Database, id: string, hash: string, now: number) {
  const result = await database.prepare(`UPDATE community_reports SET status = 'removed', removed_at = ?, removed_by_hash = ?
    WHERE id = ? AND status = 'active' AND last_confirmed_at > ?
    AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = ? AND expires_at > ?)
    AND NOT EXISTS (SELECT 1 FROM community_reports WHERE removed_by_hash = ? AND removed_at > ?)`)
    .bind(now, hash, id, now - REPORT_LIFETIME, hash, now, hash, now - 60_000).run();
  if (result.meta.changes === 1) return;
  await assertParticipation(database, hash, now);
  throw new CommunityError(409, 'dismiss_not_allowed');
}

export async function undoCommunityDismissal(database: D1Database, id: string, hash: string, now: number) {
  const result = await database.prepare(`UPDATE community_reports SET status = 'active', removed_at = NULL, removed_by_hash = NULL
    WHERE id = ? AND status = 'removed' AND removed_by_hash = ? AND removed_at >= ? AND last_confirmed_at > ?
    AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = ? AND expires_at > ?)
    AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = community_reports.reporter_hash AND expires_at > ?)`)
    .bind(id, hash, now - UNDO_WINDOW, now - REPORT_LIFETIME, hash, now, now).run();
  if (result.meta.changes === 1) return;
  await assertParticipation(database, hash, now);
  throw new CommunityError(403, 'undo_not_allowed');
}

export async function flagCommunityReport(database: D1Database, id: string, hash: string, reason: string, now: number) {
  const results = await database.batch([
    database.prepare(`INSERT INTO report_flags (report_id, device_hash, reason, created_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM community_reports WHERE id = ?
        AND status = 'active' AND last_confirmed_at > ? AND reporter_hash != ?)
      AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = ? AND expires_at > ?)
      AND (SELECT COUNT(*) FROM report_flags WHERE device_hash = ? AND created_at > ?) < 10
      ON CONFLICT(report_id, device_hash) DO NOTHING`)
      .bind(id, hash, reason, now, id, now - REPORT_LIFETIME, hash, hash, now, hash, now - 24 * 60 * 60_000),
    database.prepare(`UPDATE community_reports SET flag_count = flag_count + 1 WHERE id = ? AND changes() = 1`).bind(id),
    database.prepare(`UPDATE community_reports SET status = 'moderated', moderated_at = ?, moderation_reason = 'community_flags'
      WHERE id = ? AND status = 'active' AND flag_count >= 3`).bind(now, id),
  ]);
  if (results[0].meta.changes !== 1) {
    await assertParticipation(database, hash, now);
    throw new CommunityError(409, 'flag_not_allowed');
  }
  return { hidden: results[2].meta.changes === 1 };
}

export type ModerationAction = 'remove' | 'restore' | 'restrict' | 'release';

export async function moderateCommunityReport(database: D1Database, id: string, action: ModerationAction, now: number) {
  const report = await database.prepare('SELECT id FROM community_reports WHERE id = ?').bind(id).first();
  if (!report) throw new CommunityError(404, 'report_not_found');
  if (action === 'restrict') {
    await database.batch([
      database.prepare(`INSERT INTO community_restrictions (device_hash, created_at, expires_at)
        SELECT reporter_hash, ?, ? FROM community_reports WHERE id = ?
        ON CONFLICT(device_hash) DO UPDATE SET created_at = excluded.created_at, expires_at = excluded.expires_at
        WHERE community_restrictions.expires_at <= ?`).bind(now, now + RESTRICTION_DURATION, id, now),
      // Also hide removed reports: a later undo or release must not revive them.
      database.prepare(`UPDATE community_reports SET status = 'moderated', moderated_at = ?, moderation_reason = 'device_restricted'
        WHERE reporter_hash = (SELECT reporter_hash FROM community_reports WHERE id = ?) AND status IN ('active', 'removed')`)
        .bind(now, id),
    ]);
    return;
  }
  if (action === 'release') {
    await database.prepare(`DELETE FROM community_restrictions WHERE device_hash =
      (SELECT reporter_hash FROM community_reports WHERE id = ?)`).bind(id).run();
    return; // Reports stay hidden, and no expiry/confirmation timestamp is reset.
  }
  if (action === 'remove') {
    await database.prepare(`UPDATE community_reports SET status = 'moderated', moderated_at = ?, moderation_reason = 'admin_removed' WHERE id = ?`)
      .bind(now, id).run();
    return;
  }
  const results = await database.batch([
    database.prepare(`UPDATE community_reports SET status = 'active', flag_count = 0, moderated_at = NULL, moderation_reason = NULL
      WHERE id = ? AND status = 'moderated' AND last_confirmed_at > ?
      AND NOT EXISTS (SELECT 1 FROM community_restrictions WHERE device_hash = community_reports.reporter_hash AND expires_at > ?)`)
      .bind(id, now - REPORT_LIFETIME, now),
    database.prepare('DELETE FROM report_flags WHERE report_id = ? AND changes() = 1').bind(id),
  ]);
  if (results[0].meta.changes !== 1) throw new CommunityError(409, 'restore_not_allowed');
}
