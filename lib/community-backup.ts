export const BACKUP_FORMAT = 'alerta-tram-community-v3';
export const BACKUP_SCHEMA = '0007_community_restrictions';
export const BACKUP_TABLES = ['community_reports', 'report_confirmations', 'report_flags', 'anonymous_metrics', 'beta_feedback', 'community_restrictions'] as const;
export const BACKUP_ROW_LIMIT = 25_000;

export async function exportCommunityBackup(database: D1Database, now = Date.now()) {
  // One D1 batch is transactional: parent and child tables belong to one snapshot.
  // Fetch one extra row to reject oversized exports instead of silently truncating.
  const results = await database.batch(BACKUP_TABLES.map((table) =>
    database.prepare(`SELECT * FROM ${table} LIMIT ?`).bind(BACKUP_ROW_LIMIT + 1),
  ));
  if (results.some((result) => !result.success || !Array.isArray(result.results))) throw new Error('backup_unavailable');
  if (results.some((result) => result.results.length > BACKUP_ROW_LIMIT)) throw new Error('backup_too_large');
  const tables = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, results[index].results]));
  const rowCounts = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, results[index].results.length]));
  return { format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, createdAt: new Date(now).toISOString(), rowCounts, tables };
}
