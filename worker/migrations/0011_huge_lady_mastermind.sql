-- Competition cancellation (ADR-0062): the `app_state` singleton row gains the set of cancelled
-- competition slugs, stored as a JSON array of text (small N, ADR-0021). No data backfill — the `[]`
-- default means „nothing cancelled", which is exactly what every pre-existing row means.
ALTER TABLE `app_state` ADD `cancelled_competitions` text DEFAULT '[]' NOT NULL;
