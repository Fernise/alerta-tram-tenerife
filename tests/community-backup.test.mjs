import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCommunityBackup, BACKUP_TABLES, BACKUP_ROW_LIMIT } from '../lib/community-backup.ts';
import { readFileSync } from 'node:fs';
import { isOwner } from '../lib/owner-auth.ts';

function fakeDatabase(results) {
  return {
    prepare(sql) {
      assert.match(sql, /^SELECT \* FROM (community_reports|report_confirmations|report_flags|anonymous_metrics|beta_feedback|community_restrictions) LIMIT \?$/);
      return { bind(limit) { assert.equal(limit, BACKUP_ROW_LIMIT + 1); return sql; } };
    },
    async batch(statements) { assert.equal(statements.length, BACKUP_TABLES.length); return results; },
  };
}
test('complete bounded snapshot in a single batch', async () => {
  const result = await exportCommunityBackup(fakeDatabase(BACKUP_TABLES.map(() => ({success: true, results: []}))), 0);
  assert.deepEqual(Object.keys(result.tables), [...BACKUP_TABLES]);
  assert.equal(result.createdAt, '1970-01-01T00:00:00.000Z');
});
test('oversized export is rejected, not silently truncated', async () => {
  const results = BACKUP_TABLES.map(() => ({success: true, results: []}));
  results[0].results = Array(BACKUP_ROW_LIMIT + 1).fill({id: 'sample'});
  await assert.rejects(exportCommunityBackup(fakeDatabase(results)), /backup_too_large/);
});
test('failed table cannot produce an apparently valid backup', async () => {
  await assert.rejects(exportCommunityBackup(fakeDatabase(BACKUP_TABLES.map(() => ({success: false})))), /backup_unavailable/);
});

test('moderation uses a native attachment form and does not claim the browser saved it', () => {
  const page = readFileSync(new URL('../app/moderation/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<form action="\/api\/moderation\/backup" method="post" target="community-backup-download"/);
  assert.match(page, /Comprueba que el archivo aparece en Descargas/);
  assert.doesNotMatch(page, /URL\.createObjectURL|Descarga iniciada/);
});
test('owner authorization denies absent and incorrect identity', () => {
  const previousId = process.env.MODERATION_OWNER_USER_ID;
  const previousEmail = process.env.MODERATION_OWNER_EMAIL;
  try {
    process.env.MODERATION_OWNER_USER_ID = 'test-owner';
    delete process.env.MODERATION_OWNER_EMAIL;
    assert.equal(isOwner(new Request('https://example.invalid')), false);
    assert.equal(isOwner(new Request('https://example.invalid', {headers: {'oai-authenticated-user-id': 'someone-else'}})), false);
    assert.equal(isOwner(new Request('https://example.invalid', {headers: {'oai-authenticated-user-id': 'test-owner'}})), true);
  } finally {
    if (previousId === undefined) delete process.env.MODERATION_OWNER_USER_ID; else process.env.MODERATION_OWNER_USER_ID = previousId;
    if (previousEmail === undefined) delete process.env.MODERATION_OWNER_EMAIL; else process.env.MODERATION_OWNER_EMAIL = previousEmail;
  }
});
