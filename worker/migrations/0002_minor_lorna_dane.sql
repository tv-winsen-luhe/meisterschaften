PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`phase` text DEFAULT 'signup' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_app_state`("id", "phase") SELECT "id", "phase" FROM `app_state`;--> statement-breakpoint
DROP TABLE `app_state`;--> statement-breakpoint
ALTER TABLE `__new_app_state` RENAME TO `app_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Phase values were renamed from German to English identifiers. Convert any row persisted
-- under the old values so it stays valid against the Phase enum (anmeldung→signup, auslosung→draw).
UPDATE `app_state` SET `phase` = 'signup' WHERE `phase` = 'anmeldung';--> statement-breakpoint
UPDATE `app_state` SET `phase` = 'draw' WHERE `phase` = 'auslosung';