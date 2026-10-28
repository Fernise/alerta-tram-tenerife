CREATE TABLE `community_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`line` text NOT NULL,
	`direction` text NOT NULL,
	`stop` text NOT NULL,
	`zone` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_confirmed_at` integer NOT NULL,
	`confirmations` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`reporter_hash` text NOT NULL,
	`removed_at` integer,
	`removed_by_hash` text
);
--> statement-breakpoint
CREATE INDEX `idx_community_reports_active` ON `community_reports` (`line`,`direction`,`status`,`last_confirmed_at`);--> statement-breakpoint
CREATE INDEX `idx_community_reports_reporter_created` ON `community_reports` (`reporter_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `report_confirmations` (
	`report_id` text NOT NULL,
	`device_hash` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`report_id`, `device_hash`),
	FOREIGN KEY (`report_id`) REFERENCES `community_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA optimize;
