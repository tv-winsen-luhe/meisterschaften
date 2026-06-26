-- Retire the `hidden` registration status (ADR-0018): the operator-initiated exclusion now
-- converges on `cancelled`. Convert any row still carrying the old value so it stays valid
-- against the trimmed Phase/status set. Before the event the table is effectively empty, so
-- this is a safety net rather than a real backfill.
UPDATE `registrations` SET `status` = 'cancelled' WHERE `status` = 'hidden';
