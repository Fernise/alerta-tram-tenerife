import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  CONFIRM_COOLDOWN, REPORT_LIFETIME, RESTRICTION_DURATION, UNDO_WINDOW,
  assertParticipation, confirmCommunityReport, createCommunityReport, dismissCommunityReport,
  flagCommunityReport, moderateCommunityReport, purgeRestrictions, sameOrigin, undoCommunityDismissal,
} from '../lib/community-safety.ts';

const now = 1_800_000_000_000;
const input = { line: 'L1', direction: 'ida', stop: 'Weyler', zone: 'Delante', kind: 'inspection', incidentType: null, note: null };

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('PRAGMA foreign_keys = ON');
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  for (const entry of journal.entries) sqlite.exec(readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) {
      const statement = { bind(...values) { return {
        run() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; },
        first() { return sqlite.prepare(sql).get(...values) ?? null; },
      }; } };
      return { ...statement, first() { return statement.bind().first(); } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map((s) => s.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
async function seed(db, id = 'report-a', author = 'author', time = now, stop = 'Weyler') {
  await createCommunityReport(db, id, author, { ...input, stop }, time);
  return id;
}
const row = (db, id = 'report-a') => db.sqlite.prepare('SELECT * FROM community_reports WHERE id = ?').get(id);
const errorCode = (code) => (error) => error.code === code;

test('concurrent confirmations count exactly once per device; retry does not refresh age', async (t) => {
  const db = database(t), id = await seed(db);
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => confirmCommunityReport(db, id, 'reader', now + 1)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const result of results.filter((r) => r.status === 'rejected')) assert.equal(result.reason.code, 'confirm_cooldown');
  assert.equal(row(db).confirmations, 2);
  await assert.rejects(confirmCommunityReport(db, id, 'reader', now + CONFIRM_COOLDOWN), errorCode('confirm_cooldown'));
  assert.equal(row(db).last_confirmed_at, now + 1);
  await confirmCommunityReport(db, id, 'reader', now + 1 + CONFIRM_COOLDOWN);
  assert.equal(row(db).confirmations, 3);
  await confirmCommunityReport(db, id, 'another-reader', now + 2 + CONFIRM_COOLDOWN);
  assert.equal(row(db).confirmations, 4);
});

test('creator cannot immediately self-confirm and older requests cannot move timestamps backwards', async (t) => {
  const db = database(t), id = await seed(db);
  await assert.rejects(confirmCommunityReport(db, id, 'author', now), errorCode('confirm_cooldown'));
  await confirmCommunityReport(db, id, 'reader-newer', now + 100);
  await confirmCommunityReport(db, id, 'reader-older', now + 50);
  assert.equal(row(db).last_confirmed_at, now + 100);
});

test('simultaneous duplicate publications converge to one report without inflating confirmations', async (t) => {
  const db = database(t);
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => createCommunityReport(db, `report-${i}`, 'author', input, now)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM community_reports').get().n, 1);
  assert.equal(row(db, 'report-0').confirmations, 1);
  const duplicate = await createCommunityReport(db, 'new-id', 'other-author', input, now + 1);
  assert.equal(duplicate.id, 'report-0'); assert.equal(duplicate.deduplicated, true);
  assert.equal(row(db, 'report-0').confirmations, 2);
  await assert.rejects(createCommunityReport(db, 'retry-id', 'other-author', input, now + 2), errorCode('confirm_cooldown'));
});

test('creation cooldown, active and daily limits are enforced inside SQL', async (t) => {
  const db = database(t);
  await seed(db);
  await assert.rejects(seed(db, 'too-soon', 'author', now + 59_999, 'La Paz'), errorCode('create_cooldown'));
  await seed(db, 'report-b', 'author', now + 60_000, 'La Paz');
  await seed(db, 'report-c', 'author', now + 120_000, 'Taco');
  await assert.rejects(seed(db, 'fourth-active', 'author', now + 180_000, 'Gracia'), errorCode('create_cooldown'));
  for (let i = 3; i < 8; i++) await seed(db, `daily-${i}`, 'author', now + i * REPORT_LIFETIME, `stop-${i}`);
  await assert.rejects(seed(db, 'ninth-daily', 'author', now + 9 * REPORT_LIFETIME, 'stop-9'), errorCode('create_cooldown'));
});

test('restrict hides all authored active/removed reports and denies every community mutation', async (t) => {
  const db = database(t), id = await seed(db);
  await seed(db, 'report-b', 'author', now + 60_000, 'La Paz');
  await seed(db, 'other-report', 'other-author', now + 60_000, 'Taco');
  await dismissCommunityReport(db, 'report-b', 'author', now + 60_001);
  await assertParticipation(db, 'author', now + 60_002); // Simulated stale permission read.
  await moderateCommunityReport(db, id, 'restrict', now + 60_003);
  assert.equal(row(db).status, 'moderated'); assert.equal(row(db, 'report-b').status, 'moderated');
  const restricted = errorCode('device_restricted');
  await assert.rejects(seed(db, 'new-report', 'author', now + 60_004, 'Gracia'), restricted);
  await assert.rejects(confirmCommunityReport(db, 'other-report', 'author', now + 60_004), restricted);
  await assert.rejects(dismissCommunityReport(db, 'other-report', 'author', now + 60_004), restricted);
  await assert.rejects(undoCommunityDismissal(db, 'report-b', 'author', now + 60_004), restricted);
  await assert.rejects(flagCommunityReport(db, 'other-report', 'author', 'false_or_spam', now + 60_004), restricted);
  assert.equal(row(db, 'other-report').confirmations, 1); assert.equal(row(db, 'other-report').flag_count, 0);
  assert.equal(row(db, 'other-report').status, 'active');
});

test('restriction repeat is idempotent, release does not restore, fresh explicit restoration succeeds', async (t) => {
  const db = database(t), id = await seed(db);
  await flagCommunityReport(db, id, 'reader', 'false_or_spam', now + 1);
  await moderateCommunityReport(db, id, 'restrict', now + 2);
  await moderateCommunityReport(db, id, 'restrict', now + 3);
  assert.equal(db.sqlite.prepare('SELECT expires_at FROM community_restrictions').get().expires_at, now + 2 + RESTRICTION_DURATION);
  await assert.rejects(moderateCommunityReport(db, id, 'restore', now + 4), errorCode('restore_not_allowed'));
  assert.equal(row(db).flag_count, 1);
  await moderateCommunityReport(db, id, 'release', now + 5);
  await assertParticipation(db, 'author', now + 6);
  assert.equal(row(db).status, 'moderated'); assert.equal(row(db).last_confirmed_at, now);
  await moderateCommunityReport(db, id, 'restore', now + 7);
  assert.equal(row(db).status, 'active'); assert.equal(row(db).last_confirmed_at, now);
  assert.equal(row(db).flag_count, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM report_flags').get().n, 0);
});

test('restriction expires without cleanup running; expired rows purged without reviving reports', async (t) => {
  const db = database(t), id = await seed(db);
  await moderateCommunityReport(db, id, 'restrict', now);
  await assert.rejects(assertParticipation(db, 'author', now + RESTRICTION_DURATION - 1), errorCode('device_restricted'));
  await assertParticipation(db, 'author', now + RESTRICTION_DURATION);
  await purgeRestrictions(db, now + RESTRICTION_DURATION);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM community_restrictions').get().n, 0);
  assert.equal(row(db).status, 'moderated');
  await assert.rejects(moderateCommunityReport(db, id, 'restore', now + RESTRICTION_DURATION), errorCode('restore_not_allowed'));
});

test('hidden and expired reports cannot be confirmed or recovered through undo', async (t) => {
  const db = database(t), id = await seed(db);
  await dismissCommunityReport(db, id, 'reader', now + 1);
  await moderateCommunityReport(db, id, 'remove', now + 2);
  await assert.rejects(undoCommunityDismissal(db, id, 'reader', now + 3), errorCode('undo_not_allowed'));
  await assert.rejects(confirmCommunityReport(db, id, 'another-reader', now + 4), errorCode('report_expired'));
  await seed(db, 'expired', 'another-author', now - REPORT_LIFETIME, 'Taco');
  await assert.rejects(confirmCommunityReport(db, 'expired', 'reader', now), errorCode('report_expired'));
  assert.equal(row(db, 'expired').confirmations, 1);
});

test('undo enforces remover ownership, five-minute window and report freshness', async (t) => {
  const db = database(t), id = await seed(db);
  await dismissCommunityReport(db, id, 'reader', now + 1);
  await assert.rejects(undoCommunityDismissal(db, id, 'other', now + 2), errorCode('undo_not_allowed'));
  await undoCommunityDismissal(db, id, 'reader', now + UNDO_WINDOW + 1);
  assert.equal(row(db).last_confirmed_at, now);
  await dismissCommunityReport(db, id, 'reader', now + UNDO_WINDOW + 2);
  await assert.rejects(undoCommunityDismissal(db, id, 'reader', now + 2 * UNDO_WINDOW + 3), errorCode('undo_not_allowed'));
  await seed(db, 'nearly-expired', 'other-author', now - REPORT_LIFETIME + 10, 'Taco');
  await dismissCommunityReport(db, 'nearly-expired', 'another-reader', now);
  await assert.rejects(undoCommunityDismissal(db, 'nearly-expired', 'another-reader', now + 10), errorCode('undo_not_allowed'));
});

test('simultaneous dismissals respect global device cooldown and only one undo is successful', async (t) => {
  const db = database(t), id = await seed(db);
  await seed(db, 'other-report', 'other-author', now, 'Taco');
  const results = await Promise.allSettled([id, 'other-report'].map((reportId) => dismissCommunityReport(db, reportId, 'reader', now + 1)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const undos = await Promise.allSettled(Array.from({ length: 4 }, () => undoCommunityDismissal(db, id, 'reader', now + 2)));
  assert.equal(undos.filter((r) => r.status === 'fulfilled').length, 1);
});

test('duplicate flags count once and three distinct devices hide atomically', async (t) => {
  const db = database(t), id = await seed(db);
  await assert.rejects(flagCommunityReport(db, id, 'author', 'false_or_spam', now), errorCode('flag_not_allowed'));
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => flagCommunityReport(db, id, 'reader', 'false_or_spam', now)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1); assert.equal(row(db).flag_count, 1);
  assert.equal((await flagCommunityReport(db, id, 'reader-2', 'personal_data', now + 1)).hidden, false);
  assert.equal((await flagCommunityReport(db, id, 'reader-3', 'inappropriate', now + 2)).hidden, true);
  assert.equal(row(db).status, 'moderated'); assert.equal(row(db).flag_count, 3);
});

test('daily flag limit and expired report guards are enforced inside SQL', async (t) => {
  const db = database(t);
  for (let i = 0; i < 11; i++) await seed(db, `report-${i}`, `author-${i}`, now, `stop-${i}`);
  const results = await Promise.allSettled(Array.from({ length: 11 }, (_, i) => flagCommunityReport(db, `report-${i}`, 'reader', 'false_or_spam', now + 1)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM report_flags').get().n, 10);
  await assert.rejects(flagCommunityReport(db, 'report-10', 'another-reader', 'false_or_spam', now + REPORT_LIFETIME), errorCode('flag_not_allowed'));
});

test('missing report and missing/foreign origin fail closed', async (t) => {
  const db = database(t);
  for (const action of ['remove', 'restore', 'restrict', 'release']) await assert.rejects(moderateCommunityReport(db, 'absent', action, now), errorCode('report_not_found'));
  for (const origin of ['', 'https://other.test', 'invalid']) assert.equal(sameOrigin(new Request('https://site.test/api/reports', { headers: { Origin: origin } })), false);
  assert.equal(sameOrigin(new Request('https://site.test/api/reports', { headers: { Origin: 'https://site.test' } })), true);
});
