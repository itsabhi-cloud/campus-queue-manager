/**
 * QueueSense relational schema (MySQL 8, Drizzle ORM, snake_case columns).
 * Hierarchy: services → queue_groups → counters → queue_entries.
 * See docs/database.md for the invariants each constraint enforces.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  date,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from "drizzle-orm/mysql-core";
import {
  ACCOUNT_STATUSES,
  AUTH_CODE_PURPOSES,
  COUNTER_STATUSES,
  MERGE_STRATEGIES,
  NOTIFICATION_TYPES,
  QUEUE_EVENT_TYPES,
  QUEUE_STATUSES,
  ROLES,
  SERVICE_KINDS,
  TRAFFIC_LEVELS,
} from "../shared/domain";

const createdAt = () =>
  timestamp({ fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`);
const updatedAt = () =>
  timestamp({ fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = mysqlTable(
  "users",
  {
    id: int().autoincrement().primaryKey(),
    email: varchar({ length: 254 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    role: mysqlEnum(ROLES).notNull(),
    status: mysqlEnum(ACCOUNT_STATUSES).notNull().default("PENDING"),
    passwordHash: varchar({ length: 255 }),
    passwordUpdatedAt: timestamp({ fsp: 3 }),
    failedLoginCount: int().notNull().default(0),
    lockedUntil: timestamp({ fsp: 3 }),
    lastSignedInAt: timestamp({ fsp: 3 }),
    /** Created by the demo seed (DEMO_MODE). Demo accounts are shared and some actions are blocked. */
    isDemo: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_role_status_idx").on(t.role, t.status),
  ]
);

export const studentProfiles = mysqlTable(
  "student_profiles",
  {
    userId: int()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    collegeId: varchar({ length: 40 }).notNull(),
    department: varchar({ length: 120 }),
    phone: varchar({ length: 24 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex("student_profiles_college_id_unique").on(t.collegeId),
    index("student_profiles_department_idx").on(t.department),
  ]
);

export const staffProfiles = mysqlTable(
  "staff_profiles",
  {
    userId: int()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    employeeId: varchar({ length: 40 }),
    designation: varchar({ length: 120 }),
    phone: varchar({ length: 24 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex("staff_profiles_employee_id_unique").on(t.employeeId)]
);

/** Small, client-resized profile photos (data URLs ≤ ~100 KB). Kept out of `users` to keep that row lean. */
export const userAvatars = mysqlTable("user_avatars", {
  userId: int()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  dataUrl: mediumtext().notNull(),
  updatedAt: updatedAt(),
});

export const notificationPreferences = mysqlTable("notification_preferences", {
  userId: int()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  almostNext: boolean().notNull().default(true),
  positionChanges: boolean().notNull().default(true),
  waitChanges: boolean().notNull().default(true),
  counterStatus: boolean().notNull().default(true),
  almostNextThreshold: tinyint().notNull().default(2),
  updatedAt: updatedAt(),
});

/** One-time activation / password-reset codes. Only an HMAC digest is stored. */
export const authCodes = mysqlTable(
  "auth_codes",
  {
    id: int().autoincrement().primaryKey(),
    userId: int()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: char({ length: 64 }).notNull(),
    purpose: mysqlEnum(AUTH_CODE_PURPOSES).notNull(),
    expiresAt: timestamp({ fsp: 3 }).notNull(),
    usedAt: timestamp({ fsp: 3 }),
    createdByUserId: int().references((): AnyMySqlColumn => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex("auth_codes_hash_unique").on(t.codeHash),
    index("auth_codes_user_idx").on(t.userId),
  ]
);

/** Server-side sessions. `id` is the HMAC-SHA256 of the random cookie token, never the token itself. */
export const sessions = mysqlTable(
  "sessions",
  {
    id: char({ length: 64 }).primaryKey(),
    userId: int()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ fsp: 3 }).notNull(),
    lastSeenAt: timestamp({ fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    userAgent: varchar({ length: 255 }),
    ipAddress: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  t => [
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_idx").on(t.expiresAt),
  ]
);

// ---------------------------------------------------------------------------
// Service catalogue: services → queue_groups → counters
// ---------------------------------------------------------------------------

export const services = mysqlTable(
  "services",
  {
    id: int().autoincrement().primaryKey(),
    slug: varchar({ length: 60 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    description: text().notNull(),
    kind: mysqlEnum(SERVICE_KINDS).notNull().default("OTHER"),
    /** Scope statement shown to students, e.g. "QueueSense manages the line, not food orders." */
    notice: varchar({ length: 500 }),
    isActive: boolean().notNull().default(true),
    displayOrder: int().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex("services_slug_unique").on(t.slug)]
);

export const queueGroups = mysqlTable(
  "queue_groups",
  {
    id: int().autoincrement().primaryKey(),
    serviceId: int()
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    slug: varchar({ length: 60 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    description: text(),
    /** Noun used in the UI: "people", "jobs", "riders". */
    unitLabel: varchar({ length: 24 }).notNull().default("people"),
    /** Configured seconds per service cycle at one counter. */
    averageServiceSeconds: int().notNull().default(180),
    /** How many tokens one "call" serves together (1 for desks, e.g. 8 for a lift car). */
    serveCapacity: int().notNull().default(1),
    maxWaiting: int().notNull().default(200),
    mergeStrategy: mysqlEnum(MERGE_STRATEGIES).notNull().default("ALTERNATE"),
    trafficLevel: mysqlEnum(TRAFFIC_LEVELS).notNull().default("NORMAL"),
    trafficDelaySeconds: int().notNull().default(0),
    trafficReason: varchar({ length: 200 }),
    trafficUpdatedAt: timestamp({ fsp: 3 }),
    trafficUpdatedByUserId: int().references(() => users.id, {
      onDelete: "set null",
    }),
    /** When true, fresh camera congestion can raise (never lower) the effective traffic level. */
    cameraAssist: boolean().notNull().default(false),
    cameraModerateAt: int().notNull().default(6),
    cameraHeavyAt: int().notNull().default(12),
    isActive: boolean().notNull().default(true),
    displayOrder: int().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex("queue_groups_service_slug_unique").on(t.serviceId, t.slug),
    check(
      "queue_groups_service_seconds_positive",
      sql`${t.averageServiceSeconds} between 10 and 7200`
    ),
    check(
      "queue_groups_capacity_range",
      sql`${t.serveCapacity} between 1 and 50`
    ),
    check(
      "queue_groups_max_waiting_positive",
      sql`${t.maxWaiting} between 1 and 5000`
    ),
    check(
      "queue_groups_delay_range",
      sql`${t.trafficDelaySeconds} between 0 and 7200`
    ),
  ]
);

export const counters = mysqlTable(
  "counters",
  {
    id: int().autoincrement().primaryKey(),
    queueGroupId: int()
      .notNull()
      .references(() => queueGroups.id, { onDelete: "restrict" }),
    name: varchar({ length: 80 }).notNull(),
    tokenPrefix: varchar({ length: 4 }).notNull(),
    status: mysqlEnum(COUNTER_STATUSES).notNull().default("OPEN"),
    statusReason: varchar({ length: 200 }),
    statusUpdatedAt: timestamp({ fsp: 3 }),
    /** Set while this counter's queue has been merged into another counter. */
    mergedIntoCounterId: int().references((): AnyMySqlColumn => counters.id, {
      onDelete: "set null",
    }),
    /** Daily token sequence, allocated under a row lock. */
    nextSequence: int().notNull().default(1),
    sequenceDate: date({ mode: "string" }),
    /** Monotonic ordering key for this counter's waiting line (rewritten on merge). */
    nextOrderKey: bigint({ mode: "number" }).notNull().default(1),
    isActive: boolean().notNull().default(true),
    displayOrder: int().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex("counters_token_prefix_unique").on(t.tokenPrefix),
    index("counters_group_idx").on(t.queueGroupId),
    check("counters_sequence_positive", sql`${t.nextSequence} >= 1`),
  ]
);

export const staffCounterAssignments = mysqlTable(
  "staff_counter_assignments",
  {
    id: int().autoincrement().primaryKey(),
    staffUserId: int()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    counterId: int()
      .notNull()
      .references(() => counters.id, { onDelete: "cascade" }),
    assignedByUserId: int().references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex("staff_counter_unique").on(t.staffUserId, t.counterId),
    index("staff_counter_counter_idx").on(t.counterId),
  ]
);

// ---------------------------------------------------------------------------
// Queue entries and events
// ---------------------------------------------------------------------------

export const queueEntries = mysqlTable(
  "queue_entries",
  {
    id: int().autoincrement().primaryKey(),
    serviceId: int()
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    queueGroupId: int()
      .notNull()
      .references(() => queueGroups.id, { onDelete: "restrict" }),
    /** Counter currently responsible for the entry (changes on merge). */
    counterId: int()
      .notNull()
      .references(() => counters.id, { onDelete: "restrict" }),
    /** Counter that issued the token (never changes). */
    originalCounterId: int()
      .notNull()
      .references(() => counters.id, { onDelete: "restrict" }),
    userId: int()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenNumber: varchar({ length: 12 }).notNull(),
    queueDate: date({ mode: "string" }).notNull(),
    sequenceNumber: int().notNull(),
    orderKey: bigint({ mode: "number" }).notNull(),
    status: mysqlEnum(QUEUE_STATUSES).notNull().default("WAITING"),
    isPriority: boolean().notNull().default(false),
    priorityReason: varchar({ length: 200 }),
    priorityAt: timestamp({ fsp: 3 }),
    priorityByUserId: int().references(() => users.id, {
      onDelete: "set null",
    }),
    estimatedWaitSeconds: int().notNull().default(0),
    estimateUpdatedAt: timestamp({ fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    almostNextNotifiedAt: timestamp({ fsp: 3 }),
    joinedAt: createdAt(),
    calledAt: timestamp({ fsp: 3 }),
    servingAt: timestamp({ fsp: 3 }),
    completedAt: timestamp({ fsp: 3 }),
    cancelledAt: timestamp({ fsp: 3 }),
    skippedAt: timestamp({ fsp: 3 }),
    closedReason: varchar({ length: 200 }),
    closedByUserId: int().references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
    /**
     * Equals queue_group_id while the entry is active, NULL otherwise. Together with the unique index
     * below, the database itself guarantees one active token per student per queue group.
     */
    activeGroupKey: int().generatedAlwaysAs(
      sql`(case when \`status\` in ('WAITING','CALLED','SERVING') then \`queue_group_id\` else null end)`,
      { mode: "stored" }
    ),
  },
  t => [
    uniqueIndex("queue_entries_sequence_unique").on(
      t.originalCounterId,
      t.queueDate,
      t.sequenceNumber
    ),
    uniqueIndex("queue_entries_one_active_per_group").on(
      t.userId,
      t.activeGroupKey
    ),
    index("queue_entries_line_idx").on(
      t.counterId,
      t.status,
      t.isPriority,
      t.orderKey
    ),
    index("queue_entries_user_idx").on(t.userId, t.joinedAt),
    index("queue_entries_group_status_idx").on(t.queueGroupId, t.status),
    index("queue_entries_joined_idx").on(t.joinedAt),
  ]
);

export const queueEvents = mysqlTable(
  "queue_events",
  {
    id: int().autoincrement().primaryKey(),
    type: mysqlEnum(QUEUE_EVENT_TYPES).notNull(),
    queueEntryId: int().references(() => queueEntries.id, {
      onDelete: "cascade",
    }),
    counterId: int().references(() => counters.id, { onDelete: "cascade" }),
    queueGroupId: int().references(() => queueGroups.id, {
      onDelete: "cascade",
    }),
    actorUserId: int().references(() => users.id, { onDelete: "set null" }),
    fromStatus: varchar({ length: 16 }),
    toStatus: varchar({ length: 16 }),
    metadata: json().$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  t => [
    index("queue_events_entry_idx").on(t.queueEntryId, t.createdAt),
    index("queue_events_group_idx").on(t.queueGroupId, t.createdAt),
    index("queue_events_type_idx").on(t.type, t.createdAt),
  ]
);

export const notifications = mysqlTable(
  "notifications",
  {
    id: int().autoincrement().primaryKey(),
    userId: int()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: mysqlEnum(NOTIFICATION_TYPES).notNull(),
    title: varchar({ length: 120 }).notNull(),
    message: varchar({ length: 500 }).notNull(),
    queueEntryId: int().references(() => queueEntries.id, {
      onDelete: "set null",
    }),
    tokenNumber: varchar({ length: 12 }),
    readAt: timestamp({ fsp: 3 }),
    createdAt: createdAt(),
  },
  t => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_unread_idx").on(t.userId, t.readAt),
  ]
);

// ---------------------------------------------------------------------------
// Computer vision (aggregate counts only — never frames, faces or identities)
// ---------------------------------------------------------------------------

export const cameraStations = mysqlTable(
  "camera_stations",
  {
    id: int().autoincrement().primaryKey(),
    name: varchar({ length: 120 }).notNull(),
    queueGroupId: int()
      .notNull()
      .references(() => queueGroups.id, { onDelete: "restrict" }),
    roi: json()
      .$type<{ x: number; y: number; width: number; height: number }>()
      .notNull(),
    confidenceThreshold: tinyint().notNull().default(55),
    isActive: boolean().notNull().default(true),
    lastReportedAt: timestamp({ fsp: 3 }),
    lastPeopleCount: int(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index("camera_stations_group_idx").on(t.queueGroupId)]
);

export const cameraMetrics = mysqlTable(
  "camera_metrics",
  {
    id: int().autoincrement().primaryKey(),
    cameraStationId: int()
      .notNull()
      .references(() => cameraStations.id, { onDelete: "cascade" }),
    peopleCount: int().notNull(),
    rawDetections: int().notNull(),
    trafficLevel: mysqlEnum(TRAFFIC_LEVELS).notNull(),
    capturedAt: createdAt(),
  },
  t => [
    index("camera_metrics_station_idx").on(t.cameraStationId, t.capturedAt),
    check(
      "camera_metrics_non_negative",
      sql`${t.peopleCount} >= 0 and ${t.rawDetections} >= 0`
    ),
  ]
);

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int().autoincrement().primaryKey(),
    actorUserId: int().references(() => users.id, { onDelete: "set null" }),
    action: varchar({ length: 64 }).notNull(),
    entityType: varchar({ length: 40 }).notNull(),
    entityId: varchar({ length: 64 }),
    metadata: json().$type<Record<string, unknown>>().notNull(),
    ipAddress: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  t => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ]
);

export const systemSettings = mysqlTable(
  "system_settings",
  {
    key: varchar({ length: 64 }).notNull(),
    value: json().$type<unknown>().notNull(),
    updatedByUserId: int().references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  t => [primaryKey({ columns: [t.key] })]
);

export type User = typeof users.$inferSelect;
export type Service = typeof services.$inferSelect;
export type QueueGroup = typeof queueGroups.$inferSelect;
export type Counter = typeof counters.$inferSelect;
export type QueueEntry = typeof queueEntries.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type CameraStation = typeof cameraStations.$inferSelect;
