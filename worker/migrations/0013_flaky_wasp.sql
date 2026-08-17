PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`phase` text DEFAULT 'signup' NOT NULL,
	`schedule_published` integer DEFAULT false NOT NULL,
	`cancelled_competitions` text DEFAULT '[]' NOT NULL,
	`social_mixer_day` integer DEFAULT 1 NOT NULL,
	`social_mixer_slot` integer DEFAULT 4 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_app_state`("id", "phase", "schedule_published", "cancelled_competitions", "social_mixer_day", "social_mixer_slot") SELECT "id", "phase", "schedule_published", "cancelled_competitions", "social_mixer_day", "social_mixer_slot" FROM `app_state`;--> statement-breakpoint
DROP TABLE `app_state`;--> statement-breakpoint
ALTER TABLE `__new_app_state` RENAME TO `app_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- The Social mixer's stored placement is a *grid slot*, and the grid's first start moved (ADR-0067):
-- Saturday 9:00 → 10:30 (three 30-minute steps later), Sunday 9:00 → 10:00 (two). Left untouched, the same
-- slot number would silently push the block later on the clock, so each stored placement is shifted back by
-- its day's step count and keeps the clock time it was chosen as — the planned Sunday 12:00 block moves from
-- slot 6 to slot 4. Clamped at 0 for a placement that would otherwise fall before the new first start.
UPDATE `app_state` SET `social_mixer_slot` = MAX(0, `social_mixer_slot` - CASE `social_mixer_day` WHEN 0 THEN 3 ELSE 2 END);
