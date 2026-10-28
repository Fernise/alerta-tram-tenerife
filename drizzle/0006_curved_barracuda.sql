CREATE TABLE `beta_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`platform` text NOT NULL,
	`language` text NOT NULL,
	`device_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_beta_feedback_created` ON `beta_feedback` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_beta_feedback_device_created` ON `beta_feedback` (`device_hash`,`created_at`);