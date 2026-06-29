-- The schedule publish gate (ADR-0041): a global, operator-set flag on the single app_state row, off by
-- default, that gates the planned public schedule. No data backfill — before the event the table is
-- effectively empty, and the NOT NULL default covers the pinned row.
ALTER TABLE `app_state` ADD `schedule_published` integer DEFAULT false NOT NULL;