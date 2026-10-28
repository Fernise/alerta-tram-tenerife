CREATE INDEX `idx_community_reports_remover_removed` ON `community_reports` (`removed_by_hash`,`removed_at`);
--> statement-breakpoint
PRAGMA optimize;
