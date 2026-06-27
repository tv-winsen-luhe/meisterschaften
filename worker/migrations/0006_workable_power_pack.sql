CREATE TABLE `draws` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition` text NOT NULL,
	`bracket` text NOT NULL,
	`size` integer NOT NULL,
	`seeding` text NOT NULL,
	`reveal_sequence` text NOT NULL,
	`reveal_cursor` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_draws_competition_bracket` ON `draws` (`competition`,`bracket`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`competition` text NOT NULL,
	`bracket` text NOT NULL,
	`round` integer NOT NULL,
	`position` integer NOT NULL,
	`slot1_reg_id` integer,
	`slot2_reg_id` integer,
	`winner_reg_id` integer,
	`outcome` text
);
--> statement-breakpoint
CREATE INDEX `idx_matches_competition` ON `matches` (`competition`);