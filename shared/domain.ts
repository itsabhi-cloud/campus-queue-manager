/**
 * Domain vocabulary shared by the server, database schema and client.
 * Keep this file free of runtime dependencies so the browser bundle stays small.
 */

export const ROLES = ["STUDENT", "STAFF", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** PENDING = provisioned by an admin but not yet activated (no password set). */
export const ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Used for icons and scope copy only — queue behaviour comes from queue-group configuration. */
export const SERVICE_KINDS = ["ADMINISTRATION", "PRINTING", "CAFETERIA", "ELEVATOR", "OTHER"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

export const QUEUE_STATUSES = ["WAITING", "CALLED", "SERVING", "COMPLETED", "SKIPPED", "CANCELLED"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export const ACTIVE_QUEUE_STATUSES = ["WAITING", "CALLED", "SERVING"] as const satisfies readonly QueueStatus[];
export const TERMINAL_QUEUE_STATUSES = ["COMPLETED", "SKIPPED", "CANCELLED"] as const satisfies readonly QueueStatus[];

export const COUNTER_STATUSES = ["OPEN", "PAUSED", "OFFLINE"] as const;
export type CounterStatus = (typeof COUNTER_STATUSES)[number];

export const TRAFFIC_LEVELS = ["NORMAL", "MODERATE", "HEAVY"] as const;
export type TrafficLevel = (typeof TRAFFIC_LEVELS)[number];

/** How waiting entries from an unavailable counter are woven into the receiving counter's queue. */
export const MERGE_STRATEGIES = ["ALTERNATE", "JOIN_TIME", "APPEND"] as const;
export type MergeStrategy = (typeof MERGE_STRATEGIES)[number];

export const QUEUE_EVENT_TYPES = [
  "JOINED",
  "CALLED",
  "SERVING",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "PRIORITY_ASSIGNED",
  "PRIORITY_REMOVED",
  "MERGED",
  "COUNTER_STATUS",
  "TRAFFIC_UPDATED",
] as const;
export type QueueEventType = (typeof QUEUE_EVENT_TYPES)[number];

export const NOTIFICATION_TYPES = [
  "QUEUE_JOINED",
  "POSITION_CHANGED",
  "ALMOST_NEXT",
  "TOKEN_CALLED",
  "SERVICE_STARTED",
  "SERVICE_COMPLETED",
  "TOKEN_CANCELLED",
  "TOKEN_SKIPPED",
  "QUEUE_MERGED",
  "PRIORITY_ASSIGNED",
  "PRIORITY_ADJUSTMENT",
  "WAIT_INCREASED",
  "WAIT_DECREASED",
  "COUNTER_PAUSED",
  "COUNTER_RESUMED",
  "COUNTER_OFFLINE",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUTH_CODE_PURPOSES = ["ACTIVATION", "RESET"] as const;
export type AuthCodePurpose = (typeof AUTH_CODE_PURPOSES)[number];

/** Multipliers applied to the service-time part of an estimate. Documented in docs/queue-engine.md. */
export const TRAFFIC_MULTIPLIER: Record<TrafficLevel, number> = {
  NORMAL: 1,
  MODERATE: 1.25,
  HEAVY: 1.5,
};

export const SESSION_COOKIE = "qs_session";

export const isActiveStatus = (status: QueueStatus) =>
  (ACTIVE_QUEUE_STATUSES as readonly QueueStatus[]).includes(status);

/** Realtime events carry identifiers only; clients refetch authoritative state. */
export type RealtimeEvent =
  | { type: "hello"; serverTime: number }
  | { type: "queue.changed"; counterIds: number[]; queueGroupIds: number[]; reason: QueueEventType | "CONFIG" }
  | { type: "entry.changed"; entryIds: number[] }
  | { type: "notification.created"; notificationId: number; title: string; message: string; notificationType: NotificationType }
  | { type: "camera.updated"; stationId: number; queueGroupId: number }
  | { type: "catalog.changed" }
  | { type: "session.revoked" };
