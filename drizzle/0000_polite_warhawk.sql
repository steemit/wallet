CREATE TABLE `arecs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`uid` varchar(64),
	`contact_email` varchar(256) NOT NULL,
	`account_name` varchar(64) NOT NULL,
	`owner_key` text,
	`old_owner_key` text,
	`new_owner_key` text,
	`memo_key` text,
	`provider` varchar(64),
	`email_confirmation_code` varchar(64),
	`validation_code` varchar(64),
	`request_submitted_at` datetime,
	`remote_ip` varchar(45),
	`status` varchar(32) DEFAULT 'open',
	`created_at` datetime NOT NULL DEFAULT '2026-05-28 10:00:05.815',
	`updated_at` datetime NOT NULL DEFAULT '2026-05-28 10:00:05.815',
	CONSTRAINT `arecs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_arecs_account_name` ON `arecs` (`account_name`);--> statement-breakpoint
CREATE INDEX `idx_arecs_contact_email` ON `arecs` (`contact_email`);--> statement-breakpoint
CREATE INDEX `idx_arecs_uid` ON `arecs` (`uid`);