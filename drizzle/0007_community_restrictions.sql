CREATE TABLE `community_restrictions` (
	`device_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_community_restrictions_expiry` ON `community_restrictions` (`expires_at`);