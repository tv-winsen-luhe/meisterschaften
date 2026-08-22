ALTER TABLE `app_state` ADD `play_suspended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_state` ADD `play_resumes_at` integer;