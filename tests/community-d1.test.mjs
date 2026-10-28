// Integration check against the local Cloudflare D1 runtime provided by Wrangler.
// No production credentials, remote database or real community reports are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { CONFIRM_COOLDOWN, confirmCommunityReport, createCommunityReport, flagCommunityReport, moderateCommunityReport } from '../lib/community-safety.ts';

test('local D1 transactions enforce one confirmation and atomic moderation, including rollback', { timeout: 60_000 }, async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', d1Databases: { DB: 'community-safety-test' } }));
  try {
    const db = await runtime.getD1Database('DB');
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    for (const entry of journal.entries) {
      const sql = readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint').filter((s) => s.trim())) await db.prepare(statement).run();
    }
    const now = 1_800_000_000_000;
    const id = crypto.randomUUID();
    const input = { line: 'L1', direction: 'ida', stop: 'Weyler', zone: 'Delante', kind: 'inspection', incidentType: null, note: null };
    await createCommunityReport(db, id, 'author', input, now);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => confirmCommunityReport(db, id, 'reader', now + 1)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const result of results.filter((r) => r.status === 'rejected')) assert.equal(result.reason.code, 'confirm_cooldown');
    assert.equal((await db.prepare('SELECT confirmations FROM community_reports WHERE id = ?').bind(id).first()).confirmations, 2);
    await confirmCommunityReport(db, id, 'reader', now + 1 + CONFIRM_COOLDOWN);
    assert.equal((await db.prepare('SELECT confirmations FROM community_reports WHERE id = ?').bind(id).first()).confirmations, 3);

    // A failed second write must roll back the first, not leave an orphan counter.
    await assert.rejects(db.batch([
      db.prepare('UPDATE community_reports SET confirmations = confirmations + 100 WHERE id = ?').bind(id),
      db.prepare('INSERT INTO report_confirmations VALUES (?, ?, ?)').bind('absent-parent', 'test', now),
    ]));
    assert.equal((await db.prepare('SELECT confirmations FROM community_reports WHERE id = ?').bind(id).first()).confirmations, 3);

    const flags = await Promise.allSettled(Array.from({ length: 10 }, () => flagCommunityReport(db, id, 'flagger', 'false_or_spam', now + 1 + CONFIRM_COOLDOWN)));
    assert.equal(flags.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await db.prepare('SELECT flag_count FROM community_reports WHERE id = ?').bind(id).first()).flag_count, 1);
    await moderateCommunityReport(db, id, 'restrict', now + CONFIRM_COOLDOWN + 2);
    // Exercise the actual private listing SQL, including joins and pause anchors.
    const routeSource = readFileSync(new URL('../app/api/moderation/reports/route.ts', import.meta.url), 'utf8');
    const listQueries = [...routeSource.matchAll(/database\.prepare\(`([\s\S]*?)`\)/g)].map((match) => match[1]);
    assert.equal(listQueries.length, 2);
    const [queue, pauses] = await db.batch(listQueries.map((sql) => db.prepare(sql).bind(now + CONFIRM_COOLDOWN + 2)));
    assert.equal(queue.results[0].id, id);
    assert.equal(queue.results[0].status, 'moderated');
    assert.equal(typeof queue.results[0].restrictionUntil, 'number');
    assert.equal(pauses.results[0].reportId, id);
    for (const response of [queue.results[0], pauses.results[0]]) {
      assert.equal(Object.keys(response).some((key) => /hash/i.test(key)), false);
    }
    await assert.rejects(createCommunityReport(db, crypto.randomUUID(), 'author', { ...input, stop: 'La Paz' }, now + CONFIRM_COOLDOWN + 3), (e) => e.code === 'device_restricted');
    await moderateCommunityReport(db, id, 'release', now + CONFIRM_COOLDOWN + 4);
    assert.equal((await db.prepare('SELECT status FROM community_reports WHERE id = ?').bind(id).first()).status, 'moderated');
    await moderateCommunityReport(db, id, 'restore', now + CONFIRM_COOLDOWN + 5);
    assert.equal((await db.prepare('SELECT flag_count FROM community_reports WHERE id = ?').bind(id).first()).flag_count, 0);
  } finally { await runtime.dispose(); }
});
