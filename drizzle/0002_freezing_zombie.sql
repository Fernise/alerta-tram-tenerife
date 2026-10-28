CREATE TABLE `anonymous_metrics` (
	`day` text NOT NULL,
	`event` text NOT NULL,
	`language` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `event`, `language`)
);
--> statement-breakpoint
PRAGMA optimize;
