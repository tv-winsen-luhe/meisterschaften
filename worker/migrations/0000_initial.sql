-- IF NOT EXISTS so this baseline migration applies cleanly to the pre-existing prod
-- table created by the retired worker/schema.sql workflow, while still creating the
-- table on a fresh DB (local dev, tests). Mirrors the old schema.sql's idempotency.
CREATE TABLE IF NOT EXISTS `registrations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text NOT NULL,
	`competition` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`club` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`note` text,
	`player_id` text,
	`lk` text,
	`status` text DEFAULT 'new' NOT NULL,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_registrations_status` ON `registrations` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_registrations_player_id` ON `registrations` (`player_id`);