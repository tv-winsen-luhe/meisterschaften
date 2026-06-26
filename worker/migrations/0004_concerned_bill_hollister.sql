ALTER TABLE `registrations` ADD `updated_at` text;
--> statement-breakpoint
-- Backfill pre-existing rows so updated_at is never null going forward (the Store stamps it on
-- every write from here on). Before the event the table is effectively empty, so this is a safety
-- net rather than a real backfill.
UPDATE `registrations` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;