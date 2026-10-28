ALTER TABLE `community_reports` ADD `kind` text DEFAULT 'inspection' NOT NULL;--> statement-breakpoint
ALTER TABLE `community_reports` ADD `incident_type` text;--> statement-breakpoint
CREATE INDEX `idx_community_reports_duplicate` ON `community_reports` (`line`,`direction`,`stop`,`kind`,`incident_type`,`status`,`last_confirmed_at`);--> statement-breakpoint
PRAGMA optimize;
