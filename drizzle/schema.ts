import {
  boolean,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const services = mysqlTable("services", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description").notNull(),
  prefix: varchar("prefix", { length: 4 }).notNull(),
  averageServiceTimeMinutes: decimal("averageServiceTimeMinutes", { precision: 5, scale: 2 }).notNull().default("3.00"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  prefixUnique: uniqueIndex("services_prefix_unique").on(table.prefix),
  activeIndex: index("services_active_idx").on(table.isActive),
}));

export const counters = mysqlTable("counters", {
  id: int("id").autoincrement().primaryKey(),
  serviceId: int("serviceId").notNull().references(() => services.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  status: mysqlEnum("status", ["OPEN", "PAUSED", "CLOSED"]).notNull().default("OPEN"),
  assignedStaffId: int("assignedStaffId").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  serviceIndex: index("counters_service_idx").on(table.serviceId),
  staffIndex: index("counters_staff_idx").on(table.assignedStaffId),
}));

export const queueEntries = mysqlTable("queueEntries", {
  id: int("id").autoincrement().primaryKey(),
  serviceId: int("serviceId").notNull().references(() => services.id, { onDelete: "restrict" }),
  counterId: int("counterId").notNull().references(() => counters.id, { onDelete: "restrict" }),
  userId: int("userId").references(() => users.id, { onDelete: "set null" }),
  tokenNumber: varchar("tokenNumber", { length: 24 }).notNull(),
  sequenceNumber: int("sequenceNumber").notNull(),
  status: mysqlEnum("status", ["WAITING", "CALLED", "SERVING", "COMPLETED", "SKIPPED", "CANCELLED"]).notNull().default("WAITING"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  calledAt: timestamp("calledAt"),
  servingAt: timestamp("servingAt"),
  completedAt: timestamp("completedAt"),
  cancelledAt: timestamp("cancelledAt"),
}, (table) => ({
  activeQueueIndex: index("queue_entries_active_idx").on(table.counterId, table.status, table.sequenceNumber),
  userActiveIndex: index("queue_entries_user_active_idx").on(table.userId, table.status),
  tokenUnique: uniqueIndex("queue_entries_counter_token_unique").on(table.counterId, table.tokenNumber),
  sequenceUnique: uniqueIndex("queue_entries_counter_sequence_unique").on(table.counterId, table.sequenceNumber),
}));

export const queueEvents = mysqlTable("queueEvents", {
  id: int("id").autoincrement().primaryKey(),
  queueEntryId: int("queueEntryId").notNull().references(() => queueEntries.id, { onDelete: "cascade" }),
  eventType: mysqlEnum("eventType", ["JOINED", "CALLED", "SERVING", "COMPLETED", "SKIPPED", "CANCELLED"]).notNull(),
  actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
  metadata: json("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  entryTimeIndex: index("queue_events_entry_time_idx").on(table.queueEntryId, table.createdAt),
}));

export const cameraStations = mysqlTable("cameraStations", {
  id: int("id").autoincrement().primaryKey(),
  counterId: int("counterId").notNull().references(() => counters.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  roi: json("roi").$type<{ x: number; y: number; width: number; height: number }>().notNull(),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const queueMetrics = mysqlTable("queueMetrics", {
  id: int("id").autoincrement().primaryKey(),
  cameraStationId: int("cameraStationId").notNull().references(() => cameraStations.id, { onDelete: "cascade" }),
  peopleCount: int("peopleCount").notNull().default(0),
  estimatedWaitMinutes: decimal("estimatedWaitMinutes", { precision: 7, scale: 2 }).notNull().default("0.00"),
  capturedAt: timestamp("capturedAt").defaultNow().notNull(),
}, (table) => ({
  stationTimeIndex: index("queue_metrics_station_time_idx").on(table.cameraStationId, table.capturedAt),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Service = typeof services.$inferSelect;
export type QueueEntry = typeof queueEntries.$inferSelect;
export type QueueEvent = typeof queueEvents.$inferSelect;
export type QueueMetric = typeof queueMetrics.$inferSelect;
