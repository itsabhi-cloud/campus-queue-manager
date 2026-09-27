import type { QueueStatus } from "../../shared/domain";

/**
 * Every allowed queue-entry transition. Anything not listed is rejected by the engine; clients can
 * only request named actions (call, serve, complete…) and never submit a target status directly.
 *
 * CALLED → WAITING is system-only: it re-queues a called token when its counter is merged away.
 */
export const TRANSITIONS: Readonly<Record<QueueStatus, readonly QueueStatus[]>> = {
  WAITING: ["CALLED", "SKIPPED", "CANCELLED"],
  CALLED: ["SERVING", "SKIPPED", "CANCELLED", "WAITING"],
  SERVING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  SKIPPED: [],
  CANCELLED: [],
};

export function canTransition(from: QueueStatus, to: QueueStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Timestamp column stamped when an entry enters a status. */
export const STATUS_TIMESTAMP = {
  CALLED: "calledAt",
  SERVING: "servingAt",
  COMPLETED: "completedAt",
  SKIPPED: "skippedAt",
  CANCELLED: "cancelledAt",
} as const satisfies Partial<Record<QueueStatus, string>>;
