-- Result entry + bracket advancement (#90, ADR-0032): the `matches` aggregate gains the third-place flag
-- (its loser-feeders are materialized at draw time), the actual live court (captured at the running
-- transition, may differ from the planned court), and the fixed best-of-2 + Match-Tie-Break score columns
-- (set1/set2/MTB × the two slots). No data backfill — pre-existing rows default to third_place = false and
-- null scores/live court, which is exactly an un-played, un-third-place match.
ALTER TABLE `matches` ADD `third_place` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `live_court` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `set1_slot1` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `set1_slot2` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `set2_slot1` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `set2_slot2` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `mtb_slot1` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `mtb_slot2` integer;