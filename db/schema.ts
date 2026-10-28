import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const communityReports = sqliteTable('community_reports', {
  id: text('id').primaryKey(),
  line: text('line').notNull(),
  direction: text('direction').notNull(),
  stop: text('stop').notNull(),
  zone: text('zone').notNull(),
  kind: text('kind').notNull().default('inspection'),
  incidentType: text('incident_type'),
  note: text('note'),
  flagCount: integer('flag_count').notNull().default(0),
  moderatedAt: integer('moderated_at'),
  moderationReason: text('moderation_reason'),
  createdAt: integer('created_at').notNull(),
  lastConfirmedAt: integer('last_confirmed_at').notNull(),
  confirmations: integer('confirmations').notNull().default(1),
  status: text('status').notNull().default('active'),
  reporterHash: text('reporter_hash').notNull(),
  removedAt: integer('removed_at'),
  removedByHash: text('removed_by_hash'),
}, (table) => [
  index('idx_community_reports_active').on(
    table.line,
    table.direction,
    table.status,
    table.lastConfirmedAt,
  ),
  index('idx_community_reports_reporter_created').on(
    table.reporterHash,
    table.createdAt,
  ),
  index('idx_community_reports_duplicate').on(
    table.line,
    table.direction,
    table.stop,
    table.kind,
    table.incidentType,
    table.status,
    table.lastConfirmedAt,
  ),
  index('idx_community_reports_remover_removed').on(
    table.removedByHash,
    table.removedAt,
  ),
]);

// Browser-level moderation, not a verified-person account ban.
export const communityRestrictions = sqliteTable('community_restrictions', {
  deviceHash: text('device_hash').primaryKey(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [
  index('idx_community_restrictions_expiry').on(table.expiresAt),
]);

export const reportConfirmations = sqliteTable('report_confirmations', {
  reportId: text('report_id').notNull().references(() => communityReports.id, { onDelete: 'cascade' }),
  deviceHash: text('device_hash').notNull(),
  confirmedAt: integer('confirmed_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.reportId, table.deviceHash] }),
]);

export const reportFlags = sqliteTable('report_flags', {
  reportId: text('report_id').notNull().references(() => communityReports.id, { onDelete: 'cascade' }),
  deviceHash: text('device_hash').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.reportId, table.deviceHash] }),
  index('idx_report_flags_device_created').on(table.deviceHash, table.createdAt),
]);

export const anonymousMetrics = sqliteTable('anonymous_metrics', {
  day: text('day').notNull(),
  event: text('event').notNull(),
  language: text('language').notNull(),
  count: integer('count').notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.day, table.event, table.language] }),
]);

export const betaFeedback = sqliteTable('beta_feedback', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  message: text('message').notNull(),
  platform: text('platform').notNull(),
  language: text('language').notNull(),
  deviceHash: text('device_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  reviewedAt: integer('reviewed_at'),
}, (table) => [
  index('idx_beta_feedback_created').on(table.createdAt),
  index('idx_beta_feedback_device_created').on(table.deviceHash, table.createdAt),
]);
