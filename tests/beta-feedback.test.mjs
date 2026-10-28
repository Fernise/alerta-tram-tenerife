import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { FEEDBACK_COOLDOWN, FEEDBACK_RETENTION, parseFeedback, readSmallJson, submitFeedback } from '../lib/beta-feedback.ts';

const now = 1_800_000_000_000;
const device = '12345678-test-device-id';
const input = () => ({ id: crypto.randomUUID(), category: 'bug', platform: 'ios', language: 'es', message: 'La tarjeta no muestra el sentido esperado.' });
function request(body = input(), id = device, origin = 'https://example.test') {
  return new Request('https://example.test/api/beta-feedback', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Alerta-Device': id }, body: JSON.stringify(body) });
}
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0006_curved_barracuda.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) { return { bind(...values) { return { run() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes) } }; }, first() { return sqlite.prepare(sql).get(...values) ?? null; } }; } }; },
    async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map((statement) => statement.run()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
  };
}
test('valid plain text, normalized; invalid category, length, contact rejected', () => {
  assert.equal(parseFeedback({ ...input(), message: '  Una sugerencia válida para la beta.  ' }).message, 'Una sugerencia válida para la beta.');
  for (const body of [null, [], { ...input(), category: 'inspection' }, { ...input(), message: 'corto' }, { ...input(), message: 'x'.repeat(1001) }, { ...input(), platform: 'unknown' }, { ...input(), language: 'de' }, { ...input(), message: 'Escríbeme a test@example.test por favor' }, { ...input(), message: 'Visita https://example.test por favor' }]) assert.throws(() => parseFeedback(body));
});
test('actual body limit works without Content-Length and bad JSON returns 400', async () => {
  await assert.rejects(readSmallJson(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) })), (e) => e.status === 413);
  await assert.rejects(readSmallJson(new Request('https://example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })), (e) => e.status === 400);
});
test('concurrent submissions: only one saved; raw device not stored', async () => {
  const db = database();
  try {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => submitFeedback(db, request(), now)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const result of results.filter((r) => r.status === 'rejected')) assert.equal(result.reason.status, 429);
    const rows = db.sqlite.prepare('SELECT * FROM beta_feedback').all();
    assert.equal(rows.length, 1); assert.match(rows[0].device_hash, /^[0-9a-f]{64}$/); assert.notEqual(rows[0].device_hash, device);
  } finally { db.sqlite.close(); }
});
test('same id and payload retry is idempotent, but changed text or device is not', async () => {
  const db = database(), body = input();
  try {
    await submitFeedback(db, request(body), now);
    await submitFeedback(db, request(body), now + 1);
    await assert.rejects(submitFeedback(db, request({ ...body, message: 'Un texto completamente diferente.' }), now + 2), (e) => e.status === 429);
    await assert.rejects(submitFeedback(db, request(body, 'another-test-device'), now + 2), (e) => e.status === 429);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM beta_feedback').get().n, 1);
  } finally { db.sqlite.close(); }
});
test('five minute boundary and rolling daily cap enforced in SQLite', async () => {
  const db = database();
  try {
    await submitFeedback(db, request(), now);
    await assert.rejects(submitFeedback(db, request(), now + FEEDBACK_COOLDOWN - 1), (e) => e.status === 429);
    for (let i = 1; i < 10; i++) await submitFeedback(db, request(), now + i * FEEDBACK_COOLDOWN);
    await assert.rejects(submitFeedback(db, request(), now + 10 * FEEDBACK_COOLDOWN), (e) => e.status === 429);
    await submitFeedback(db, request(), now + 24 * 60 * 60 * 1000);
  } finally { db.sqlite.close(); }
});
test('expired feedback is pruned; SQL-looking messages remain text', async () => {
  const db = database();
  try {
    await submitFeedback(db, request(), now - FEEDBACK_RETENTION);
    const message = "'); DROP TABLE beta_feedback; --";
    await submitFeedback(db, request({ ...input(), message }), now);
    const rows = db.sqlite.prepare('SELECT message FROM beta_feedback').all();
    assert.equal(rows.length, 1); assert.equal(rows[0].message, message);
  } finally { db.sqlite.close(); }
});
test('missing/foreign origin and invalid device rejected before writes', async () => {
  const db = database();
  try {
    for (const origin of ['', 'https://evil.test']) await assert.rejects(submitFeedback(db, request(input(), device, origin), now), (e) => e.status === 403);
    await assert.rejects(submitFeedback(db, request(input(), 'x'), now), (e) => e.status === 400);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM beta_feedback').get().n, 0);
  } finally { db.sqlite.close(); }
});
