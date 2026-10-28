CREATE TABLE `report_flags` (
	`report_id` text NOT NULL,
	`device_hash` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`report_id`, `device_hash`),
	FOREIGN KEY (`report_id`) REFERENCES `community_reports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_report_flags_device_created` ON `report_flags` (`device_hash`,`created_at`);--> statement-breakpoint
ALTER TABLE `community_reports` ADD `flag_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `community_reports` ADD `moderated_at` integer;--> statement-breakpoint
ALTER TABLE `community_reports` ADD `moderation_reason` text;--> statement-breakpoint
PRAGMA optimize;
