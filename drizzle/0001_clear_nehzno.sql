CREATE TABLE `cameraStations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`counterId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`roi` json NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cameraStations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`status` enum('OPEN','PAUSED','CLOSED') NOT NULL DEFAULT 'OPEN',
	`assignedStaffId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `counters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `queueEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceId` int NOT NULL,
	`counterId` int NOT NULL,
	`userId` int,
	`tokenNumber` varchar(24) NOT NULL,
	`sequenceNumber` int NOT NULL,
	`status` enum('WAITING','CALLED','SERVING','COMPLETED','SKIPPED','CANCELLED') NOT NULL DEFAULT 'WAITING',
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	`calledAt` timestamp,
	`servingAt` timestamp,
	`completedAt` timestamp,
	`cancelledAt` timestamp,
	CONSTRAINT `queueEntries_id` PRIMARY KEY(`id`),
	CONSTRAINT `queue_entries_counter_token_unique` UNIQUE(`counterId`,`tokenNumber`),
	CONSTRAINT `queue_entries_counter_sequence_unique` UNIQUE(`counterId`,`sequenceNumber`)
);
--> statement-breakpoint
CREATE TABLE `queueEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`queueEntryId` int NOT NULL,
	`eventType` enum('JOINED','CALLED','SERVING','COMPLETED','SKIPPED','CANCELLED') NOT NULL,
	`actorUserId` int,
	`metadata` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `queueEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `queueMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cameraStationId` int NOT NULL,
	`peopleCount` int NOT NULL DEFAULT 0,
	`estimatedWaitMinutes` decimal(7,2) NOT NULL DEFAULT '0.00',
	`capturedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `queueMetrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`prefix` varchar(4) NOT NULL,
	`averageServiceTimeMinutes` decimal(5,2) NOT NULL DEFAULT '3.00',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `services_id` PRIMARY KEY(`id`),
	CONSTRAINT `services_prefix_unique` UNIQUE(`prefix`)
);
--> statement-breakpoint
ALTER TABLE `cameraStations` ADD CONSTRAINT `cameraStations_counterId_counters_id_fk` FOREIGN KEY (`counterId`) REFERENCES `counters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `counters` ADD CONSTRAINT `counters_serviceId_services_id_fk` FOREIGN KEY (`serviceId`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `counters` ADD CONSTRAINT `counters_assignedStaffId_users_id_fk` FOREIGN KEY (`assignedStaffId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queueEntries` ADD CONSTRAINT `queueEntries_serviceId_services_id_fk` FOREIGN KEY (`serviceId`) REFERENCES `services`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queueEntries` ADD CONSTRAINT `queueEntries_counterId_counters_id_fk` FOREIGN KEY (`counterId`) REFERENCES `counters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queueEntries` ADD CONSTRAINT `queueEntries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queueEvents` ADD CONSTRAINT `queueEvents_queueEntryId_queueEntries_id_fk` FOREIGN KEY (`queueEntryId`) REFERENCES `queueEntries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queueEvents` ADD CONSTRAINT `queueEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queueMetrics` ADD CONSTRAINT `queueMetrics_cameraStationId_cameraStations_id_fk` FOREIGN KEY (`cameraStationId`) REFERENCES `cameraStations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `counters_service_idx` ON `counters` (`serviceId`);--> statement-breakpoint
CREATE INDEX `counters_staff_idx` ON `counters` (`assignedStaffId`);--> statement-breakpoint
CREATE INDEX `queue_entries_active_idx` ON `queueEntries` (`counterId`,`status`,`sequenceNumber`);--> statement-breakpoint
CREATE INDEX `queue_entries_user_active_idx` ON `queueEntries` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `queue_events_entry_time_idx` ON `queueEvents` (`queueEntryId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `queue_metrics_station_time_idx` ON `queueMetrics` (`cameraStationId`,`capturedAt`);--> statement-breakpoint
CREATE INDEX `services_active_idx` ON `services` (`isActive`);