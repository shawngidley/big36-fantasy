CREATE TABLE `divisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`sortOrder` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `divisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `division_sort_order_unique` UNIQUE(`sortOrder`)
);
--> statement-breakpoint
CREATE TABLE `draft_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`position` enum('QB','RB','WR','TE','DEF_ST','FLEX') NOT NULL,
	`draftPosition` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `draft_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_position_assignment_unique` UNIQUE(`ownerId`,`position`),
	CONSTRAINT `position_draft_order_unique` UNIQUE(`position`,`draftPosition`)
);
--> statement-breakpoint
CREATE TABLE `draft_picks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`position` enum('QB','RB','WR','TE','DEF_ST','FLEX') NOT NULL,
	`schoolName` varchar(120) NOT NULL,
	`selectedByUserId` int,
	`selectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `draft_picks_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_position_pick_unique` UNIQUE(`ownerId`,`position`),
	CONSTRAINT `school_position_lock_unique` UNIQUE(`schoolName`,`position`)
);
--> statement-breakpoint
CREATE TABLE `league_owners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`teamName` varchar(120) NOT NULL,
	`email` varchar(320),
	`divisionId` int,
	`linkedUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `league_owners_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `scoring_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weekId` int NOT NULL,
	`schoolName` varchar(120) NOT NULL,
	`position` enum('QB','RB','WR','TE','DEF_ST','FLEX') NOT NULL,
	`eventType` enum('TOUCHDOWN','PASSING_YARDS','RUSHING_YARDS','RECEIVING_YARDS','INTERCEPTION','SACK','FUMBLE_RECOVERY','SHUTOUT','RETURN_TOUCHDOWN') NOT NULL,
	`statValue` decimal(12,2) NOT NULL,
	`yardDistance` int,
	`scoringRuleId` int,
	`computedPoints` decimal(12,2) NOT NULL,
	`correctionOfEventId` int,
	`note` text,
	`recordedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scoring_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scoring_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`label` varchar(120) NOT NULL,
	`eventType` enum('TOUCHDOWN','PASSING_YARDS','RUSHING_YARDS','RECEIVING_YARDS','INTERCEPTION','SACK','FUMBLE_RECOVERY','SHUTOUT','RETURN_TOUCHDOWN') NOT NULL,
	`positionScope` enum('ALL','QB','RB','WR','TE','DEF_ST','FLEX') NOT NULL DEFAULT 'ALL',
	`minYards` int,
	`maxYards` int,
	`flatPoints` decimal(10,2),
	`pointsPerUnit` decimal(10,4),
	`isActive` enum('true','false') NOT NULL DEFAULT 'true',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scoring_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scoring_weeks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weekNumber` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`status` enum('UPCOMING','OPEN','FINAL') NOT NULL DEFAULT 'UPCOMING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scoring_weeks_id` PRIMARY KEY(`id`),
	CONSTRAINT `scoring_week_number_unique` UNIQUE(`weekNumber`)
);
--> statement-breakpoint
ALTER TABLE `draft_assignments` ADD CONSTRAINT `draft_assignments_ownerId_league_owners_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `league_owners`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `draft_picks` ADD CONSTRAINT `draft_picks_ownerId_league_owners_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `league_owners`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `draft_picks` ADD CONSTRAINT `draft_picks_selectedByUserId_users_id_fk` FOREIGN KEY (`selectedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `league_owners` ADD CONSTRAINT `league_owners_divisionId_divisions_id_fk` FOREIGN KEY (`divisionId`) REFERENCES `divisions`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `league_owners` ADD CONSTRAINT `league_owners_linkedUserId_users_id_fk` FOREIGN KEY (`linkedUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scoring_events` ADD CONSTRAINT `scoring_events_weekId_scoring_weeks_id_fk` FOREIGN KEY (`weekId`) REFERENCES `scoring_weeks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scoring_events` ADD CONSTRAINT `scoring_events_scoringRuleId_scoring_rules_id_fk` FOREIGN KEY (`scoringRuleId`) REFERENCES `scoring_rules`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scoring_events` ADD CONSTRAINT `scoring_events_recordedByUserId_users_id_fk` FOREIGN KEY (`recordedByUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `pick_owner_index` ON `draft_picks` (`ownerId`);--> statement-breakpoint
CREATE INDEX `owner_division_index` ON `league_owners` (`divisionId`);--> statement-breakpoint
CREATE INDEX `score_event_week_index` ON `scoring_events` (`weekId`);--> statement-breakpoint
CREATE INDEX `score_event_school_position_index` ON `scoring_events` (`schoolName`,`position`);--> statement-breakpoint
CREATE INDEX `score_event_correction_index` ON `scoring_events` (`correctionOfEventId`);--> statement-breakpoint
CREATE INDEX `rule_lookup_index` ON `scoring_rules` (`eventType`,`positionScope`,`isActive`);