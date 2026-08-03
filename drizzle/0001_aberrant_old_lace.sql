CREATE TABLE `access_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_name` text NOT NULL,
	`applicant_name` text NOT NULL,
	`github_login` text NOT NULL,
	`contact` text NOT NULL,
	`requested_namespace` text NOT NULL,
	`purpose` text NOT NULL,
	`current_website_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`admin_note` text,
	`notification_status` text DEFAULT 'pending' NOT NULL,
	`notification_error` text,
	`notification_attempted_at` integer,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `access_applications_status_idx` ON `access_applications` (`status`);--> statement-breakpoint
CREATE INDEX `access_applications_namespace_idx` ON `access_applications` (`requested_namespace`);--> statement-breakpoint
CREATE INDEX `access_applications_github_login_idx` ON `access_applications` (`github_login`);--> statement-breakpoint
CREATE INDEX `access_applications_created_idx` ON `access_applications` (`created_at`);