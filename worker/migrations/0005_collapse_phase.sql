-- The phase collapses to three values (ADR-0027): the `draw`/`live` distinction is no longer an
-- operator-set value — within `tournament` the public presentation is derived per Konkurrenz. Map
-- any row persisted under the old values onto `tournament` so it stays valid against the trimmed
-- Phase enum. The `signup` default is unchanged. Before the event the table is effectively empty,
-- so this is a safety net rather than a real backfill.
UPDATE `app_state` SET `phase` = 'tournament' WHERE `phase` IN ('draw', 'live');
