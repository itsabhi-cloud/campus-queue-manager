CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actor_user_id` int,
	`action` varchar(64) NOT NULL,
	`entity_type` varchar(40) NOT NULL,
	`entity_id` varchar(64),
	`metadata` json NOT NULL,
	`ip_address` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`code_hash` char(64) NOT NULL,
	`purpose` enum('ACTIVATION','RESET') NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`used_at` timestamp(3),
	`created_by_user_id` int,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `auth_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_codes_hash_unique` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `camera_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`camera_station_id` int NOT NULL,
	`people_count` int NOT NULL,
	`raw_detections` int NOT NULL,
	`traffic_level` enum('NORMAL','MODERATE','HEAVY') NOT NULL,
	`captured_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `camera_metrics_id` PRIMARY KEY(`id`),
	CONSTRAINT `camera_metrics_non_negative` CHECK(`camera_metrics`.`people_count` >= 0 and `camera_metrics`.`raw_detections` >= 0)
);
--> statement-breakpoint
CREATE TABLE `camera_stations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(120) NOT NULL,
	`queue_group_id` int NOT NULL,
	`roi` json NOT NULL,
	`confidence_threshold` tinyint NOT NULL DEFAULT 55,
	`is_active` boolean NOT NULL DEFAULT true,
	`last_reported_at` timestamp(3),
	`last_people_count` int,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `camera_stations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`queue_group_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`token_prefix` varchar(4) NOT NULL,
	`status` enum('OPEN','PAUSED','OFFLINE') NOT NULL DEFAULT 'OPEN',
	`status_reason` varchar(200),
	`status_updated_at` timestamp(3),
	`merged_into_counter_id` int,
	`next_sequence` int NOT NULL DEFAULT 1,
	`sequence_date` date,
	`next_order_key` bigint NOT NULL DEFAULT 1,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `counters_id` PRIMARY KEY(`id`),
	CONSTRAINT `counters_token_prefix_unique` UNIQUE(`token_prefix`),
	CONSTRAINT `counters_sequence_positive` CHECK(`counters`.`next_sequence` >= 1)
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` int NOT NULL,
	`almost_next` boolean NOT NULL DEFAULT true,
	`position_changes` boolean NOT NULL DEFAULT true,
	`wait_changes` boolean NOT NULL DEFAULT true,
	`counter_status` boolean NOT NULL DEFAULT true,
	`almost_next_threshold` tinyint NOT NULL DEFAULT 2,
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notification_preferences_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`type` enum('QUEUE_JOINED','POSITION_CHANGED','ALMOST_NEXT','TOKEN_CALLED','SERVICE_STARTED','SERVICE_COMPLETED','TOKEN_CANCELLED','TOKEN_SKIPPED','QUEUE_MERGED','PRIORITY_ASSIGNED','PRIORITY_ADJUSTMENT','WAIT_INCREASED','WAIT_DECREASED','COUNTER_PAUSED','COUNTER_RESUMED','COUNTER_OFFLINE') NOT NULL,
	`title` varchar(120) NOT NULL,
	`message` varchar(500) NOT NULL,
	`queue_entry_id` int,
	`token_number` varchar(12),
	`read_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `queue_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_id` int NOT NULL,
	`queue_group_id` int NOT NULL,
	`counter_id` int NOT NULL,
	`original_counter_id` int NOT NULL,
	`user_id` int NOT NULL,
	`token_number` varchar(12) NOT NULL,
	`queue_date` date NOT NULL,
	`sequence_number` int NOT NULL,
	`order_key` bigint NOT NULL,
	`status` enum('WAITING','CALLED','SERVING','COMPLETED','SKIPPED','CANCELLED') NOT NULL DEFAULT 'WAITING',
	`is_priority` boolean NOT NULL DEFAULT false,
	`priority_reason` varchar(200),
	`priority_at` timestamp(3),
	`priority_by_user_id` int,
	`estimated_wait_seconds` int NOT NULL DEFAULT 0,
	`estimate_updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`almost_next_notified_at` timestamp(3),
	`joined_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`called_at` timestamp(3),
	`serving_at` timestamp(3),
	`completed_at` timestamp(3),
	`cancelled_at` timestamp(3),
	`skipped_at` timestamp(3),
	`closed_reason` varchar(200),
	`closed_by_user_id` int,
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`active_group_key` int GENERATED ALWAYS AS ((case when `status` in ('WAITING','CALLED','SERVING') then `queue_group_id` else null end)) STORED,
	CONSTRAINT `queue_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `queue_entries_sequence_unique` UNIQUE(`original_counter_id`,`queue_date`,`sequence_number`),
	CONSTRAINT `queue_entries_one_active_per_group` UNIQUE(`user_id`,`active_group_key`)
);
--> statement-breakpoint
CREATE TABLE `queue_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('JOINED','CALLED','SERVING','COMPLETED','SKIPPED','CANCELLED','PRIORITY_ASSIGNED','PRIORITY_REMOVED','MERGED','COUNTER_STATUS','TRAFFIC_UPDATED') NOT NULL,
	`queue_entry_id` int,
	`counter_id` int,
	`queue_group_id` int,
	`actor_user_id` int,
	`from_status` varchar(16),
	`to_status` varchar(16),
	`metadata` json NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `queue_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `queue_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_id` int NOT NULL,
	`slug` varchar(60) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text,
	`unit_label` varchar(24) NOT NULL DEFAULT 'people',
	`average_service_seconds` int NOT NULL DEFAULT 180,
	`serve_capacity` int NOT NULL DEFAULT 1,
	`max_waiting` int NOT NULL DEFAULT 200,
	`merge_strategy` enum('ALTERNATE','JOIN_TIME','APPEND') NOT NULL DEFAULT 'ALTERNATE',
	`traffic_level` enum('NORMAL','MODERATE','HEAVY') NOT NULL DEFAULT 'NORMAL',
	`traffic_delay_seconds` int NOT NULL DEFAULT 0,
	`traffic_reason` varchar(200),
	`traffic_updated_at` timestamp(3),
	`traffic_updated_by_user_id` int,
	`camera_assist` boolean NOT NULL DEFAULT false,
	`camera_moderate_at` int NOT NULL DEFAULT 6,
	`camera_heavy_at` int NOT NULL DEFAULT 12,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `queue_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `queue_groups_service_slug_unique` UNIQUE(`service_id`,`slug`),
	CONSTRAINT `queue_groups_service_seconds_positive` CHECK(`queue_groups`.`average_service_seconds` between 10 and 7200),
	CONSTRAINT `queue_groups_capacity_range` CHECK(`queue_groups`.`serve_capacity` between 1 and 50),
	CONSTRAINT `queue_groups_max_waiting_positive` CHECK(`queue_groups`.`max_waiting` between 1 and 5000),
	CONSTRAINT `queue_groups_delay_range` CHECK(`queue_groups`.`traffic_delay_seconds` between 0 and 7200)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(60) NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` text NOT NULL,
	`kind` enum('ADMINISTRATION','PRINTING','CAFETERIA','ELEVATOR','OTHER') NOT NULL DEFAULT 'OTHER',
	`notice` varchar(500),
	`is_active` boolean NOT NULL DEFAULT true,
	`display_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `services_id` PRIMARY KEY(`id`),
	CONSTRAINT `services_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`last_seen_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`user_agent` varchar(255),
	`ip_address` varchar(64),
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staff_counter_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`staff_user_id` int NOT NULL,
	`counter_id` int NOT NULL,
	`assigned_by_user_id` int,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_counter_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_counter_unique` UNIQUE(`staff_user_id`,`counter_id`)
);
--> statement-breakpoint
CREATE TABLE `staff_profiles` (
	`user_id` int NOT NULL,
	`employee_id` varchar(40),
	`designation` varchar(120),
	`phone` varchar(24),
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `staff_profiles_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `staff_profiles_employee_id_unique` UNIQUE(`employee_id`)
);
--> statement-breakpoint
CREATE TABLE `student_profiles` (
	`user_id` int NOT NULL,
	`college_id` varchar(40) NOT NULL,
	`department` varchar(120),
	`phone` varchar(24),
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `student_profiles_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `student_profiles_college_id_unique` UNIQUE(`college_id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`key` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`updated_by_user_id` int,
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `system_settings_key_pk` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `user_avatars` (
	`user_id` int NOT NULL,
	`data_url` mediumtext NOT NULL,
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `user_avatars_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(254) NOT NULL,
	`name` varchar(120) NOT NULL,
	`role` enum('STUDENT','STAFF','ADMIN') NOT NULL,
	`status` enum('PENDING','ACTIVE','SUSPENDED','DISABLED') NOT NULL DEFAULT 'PENDING',
	`password_hash` varchar(255),
	`password_updated_at` timestamp(3),
	`failed_login_count` int NOT NULL DEFAULT 0,
	`locked_until` timestamp(3),
	`last_signed_in_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_codes` ADD CONSTRAINT `auth_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auth_codes` ADD CONSTRAINT `auth_codes_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `camera_metrics` ADD CONSTRAINT `camera_metrics_camera_station_id_camera_stations_id_fk` FOREIGN KEY (`camera_station_id`) REFERENCES `camera_stations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `camera_stations` ADD CONSTRAINT `camera_stations_queue_group_id_queue_groups_id_fk` FOREIGN KEY (`queue_group_id`) REFERENCES `queue_groups`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `counters` ADD CONSTRAINT `counters_queue_group_id_queue_groups_id_fk` FOREIGN KEY (`queue_group_id`) REFERENCES `queue_groups`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `counters` ADD CONSTRAINT `counters_merged_into_counter_id_counters_id_fk` FOREIGN KEY (`merged_into_counter_id`) REFERENCES `counters`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_queue_entry_id_queue_entries_id_fk` FOREIGN KEY (`queue_entry_id`) REFERENCES `queue_entries`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_queue_group_id_queue_groups_id_fk` FOREIGN KEY (`queue_group_id`) REFERENCES `queue_groups`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_counter_id_counters_id_fk` FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_original_counter_id_counters_id_fk` FOREIGN KEY (`original_counter_id`) REFERENCES `counters`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_priority_by_user_id_users_id_fk` FOREIGN KEY (`priority_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_entries` ADD CONSTRAINT `queue_entries_closed_by_user_id_users_id_fk` FOREIGN KEY (`closed_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_events` ADD CONSTRAINT `queue_events_queue_entry_id_queue_entries_id_fk` FOREIGN KEY (`queue_entry_id`) REFERENCES `queue_entries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_events` ADD CONSTRAINT `queue_events_counter_id_counters_id_fk` FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_events` ADD CONSTRAINT `queue_events_queue_group_id_queue_groups_id_fk` FOREIGN KEY (`queue_group_id`) REFERENCES `queue_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_events` ADD CONSTRAINT `queue_events_actor_user_id_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_groups` ADD CONSTRAINT `queue_groups_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `queue_groups` ADD CONSTRAINT `queue_groups_traffic_updated_by_user_id_users_id_fk` FOREIGN KEY (`traffic_updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_counter_assignments` ADD CONSTRAINT `staff_counter_assignments_staff_user_id_users_id_fk` FOREIGN KEY (`staff_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_counter_assignments` ADD CONSTRAINT `staff_counter_assignments_counter_id_counters_id_fk` FOREIGN KEY (`counter_id`) REFERENCES `counters`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_counter_assignments` ADD CONSTRAINT `staff_counter_assignments_assigned_by_user_id_users_id_fk` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staff_profiles` ADD CONSTRAINT `staff_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `student_profiles` ADD CONSTRAINT `student_profiles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_avatars` ADD CONSTRAINT `user_avatars_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `auth_codes_user_idx` ON `auth_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `camera_metrics_station_idx` ON `camera_metrics` (`camera_station_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `camera_stations_group_idx` ON `camera_stations` (`queue_group_id`);--> statement-breakpoint
CREATE INDEX `counters_group_idx` ON `counters` (`queue_group_id`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_unread_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE INDEX `queue_entries_line_idx` ON `queue_entries` (`counter_id`,`status`,`is_priority`,`order_key`);--> statement-breakpoint
CREATE INDEX `queue_entries_user_idx` ON `queue_entries` (`user_id`,`joined_at`);--> statement-breakpoint
CREATE INDEX `queue_entries_group_status_idx` ON `queue_entries` (`queue_group_id`,`status`);--> statement-breakpoint
CREATE INDEX `queue_entries_joined_idx` ON `queue_entries` (`joined_at`);--> statement-breakpoint
CREATE INDEX `queue_events_entry_idx` ON `queue_events` (`queue_entry_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `queue_events_group_idx` ON `queue_events` (`queue_group_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `queue_events_type_idx` ON `queue_events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `staff_counter_counter_idx` ON `staff_counter_assignments` (`counter_id`);--> statement-breakpoint
CREATE INDEX `student_profiles_department_idx` ON `student_profiles` (`department`);--> statement-breakpoint
CREATE INDEX `users_role_status_idx` ON `users` (`role`,`status`);