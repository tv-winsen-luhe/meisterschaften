ALTER TABLE `matches` ADD `court` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `day` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `slot` integer;--> statement-breakpoint
ALTER TABLE `matches` ADD `status` text DEFAULT 'planned' NOT NULL;