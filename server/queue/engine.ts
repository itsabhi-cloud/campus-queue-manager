/**
 * The QueueSense queue engine. Every state change happens here, inside a transaction that holds the
 * affected counter row lock (SELECT … FOR UPDATE), so concurrent joins/calls on the same counter are
 * serialised. Lock order is always: user row → group row → counter rows by ascending id.
 */
import { and, count, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import {
  ACTIVE_QUEUE_STATUSES,
  type MergeStrategy,
  type QueueEventType,
  type QueueStatus,
  type TrafficLevel,
} from "../../shared/domain";
import {
  cameraStations,
  counters,
  queueEntries,
  queueEvents,
  queueGroups,
  services,
  users,
  type Counter,
  type QueueEntry,
  type QueueGroup,
  type Service,
} from "../../drizzle/schema";
import type { SessionUser } from "../auth/sessions";
import { fail } from "../_core/errors";
import { logger } from "../_core/logger";
import {
  db,
  isDuplicateKeyError,
  withTransaction,
  type Executor,
  type Tx,
} from "../db/client";
import { audit } from "../lib/audit";
import { Effects } from "../lib/effects";
import { getSettings } from "../lib/settings";
import { campusDate } from "../lib/time";
import { assertCounterAccess, assertGroupAccess } from "./access";
import {
  blendServiceSeconds,
  effectiveTraffic,
  estimateWait,
  isMeaningfulWaitChange,
  minutesLabel,
  shouldRefreshEstimate,
  trafficFromCount,
  type EstimateBreakdown,
} from "./estimation";
import {
  aheadText,
  almostNextMessage,
  calledMessage,
  counterStatusMessage,
} from "./messages";
import { loadPreferences, notify, type NotificationInput } from "./notify";
import { mergeLines, orderWaiting } from "./ordering";
import { canTransition, STATUS_TIMESTAMP } from "./stateMachine";

const ACTIVE = [...ACTIVE_QUEUE_STATUSES];
const IN_PROGRESS: QueueStatus[] = ["CALLED", "SERVING"];

export type Actor = SessionUser;
type Meta = { ip?: string };

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

async function runOp<T>(work: (tx: Tx, fx: Effects) => Promise<T>): Promise<T> {
  const { result, fx } = await withTransaction(async tx => {
    const fx = new Effects();
    const result = await work(tx, fx);
    return { result, fx };
  });
  fx.flush();
  return result;
}

async function lockCounter(tx: Tx, counterId: number): Promise<Counter> {
  const [counter] = await tx
    .select()
    .from(counters)
    .where(eq(counters.id, counterId))
    .for("update");
  if (!counter || !counter.isActive)
    fail("NOT_FOUND", "That counter doesn't exist.");
  return counter;
}

async function loadGroupContext(
  executor: Executor,
  queueGroupId: number
): Promise<{ group: QueueGroup; service: Service }> {
  const [row] = await executor
    .select({ group: queueGroups, service: services })
    .from(queueGroups)
    .innerJoin(services, eq(services.id, queueGroups.serviceId))
    .where(eq(queueGroups.id, queueGroupId))
    .limit(1);
  if (!row) fail("NOT_FOUND", "That queue doesn't exist.");
  return row;
}

async function activeAtCounters(
  executor: Executor,
  counterIds: number[]
): Promise<QueueEntry[]> {
  if (counterIds.length === 0) return [];
  return executor
    .select()
    .from(queueEntries)
    .where(
      and(
        inArray(queueEntries.counterId, counterIds),
        inArray(queueEntries.status, ACTIVE)
      )
    );
}

async function recordEvent(
  executor: Executor,
  input: {
    type: QueueEventType;
    entryId?: number | null;
    counterId?: number | null;
    groupId?: number | null;
    actorUserId?: number | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await executor.insert(queueEvents).values({
    type: input.type,
    queueEntryId: input.entryId ?? null,
    counterId: input.counterId ?? null,
    queueGroupId: input.groupId ?? null,
    actorUserId: input.actorUserId ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    metadata: input.metadata ?? {},
  });
}

const EVENT_FOR_STATUS: Record<QueueStatus, QueueEventType> = {
  WAITING: "MERGED",
  CALLED: "CALLED",
  SERVING: "SERVING",
  COMPLETED: "COMPLETED",
  SKIPPED: "SKIPPED",
  CANCELLED: "CANCELLED",
};

const VERB: Record<QueueStatus, string> = {
  WAITING: "re-queued",
  CALLED: "called",
  SERVING: "served",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
};

/** Guarded state change: validates against the transition table and against concurrent writers. */
async function transition(
  tx: Tx,
  entry: QueueEntry,
  to: QueueStatus,
  actorUserId: number | null,
  now: Date,
  extra: Partial<typeof queueEntries.$inferInsert> = {},
  metadata: Record<string, unknown> = {}
) {
  if (!canTransition(entry.status, to)) {
    fail(
      "INVALID_TRANSITION",
      `Token ${entry.tokenNumber} is ${entry.status.toLowerCase()} and can't be ${VERB[to]}.`
    );
  }
  const stampColumn =
    to in STATUS_TIMESTAMP
      ? STATUS_TIMESTAMP[to as keyof typeof STATUS_TIMESTAMP]
      : null;
  const patch: Partial<typeof queueEntries.$inferInsert> = {
    status: to,
    ...extra,
  };
  if (stampColumn) patch[stampColumn] = now;
  const [result] = await tx
    .update(queueEntries)
    .set(patch)
    .where(
      and(eq(queueEntries.id, entry.id), eq(queueEntries.status, entry.status))
    );
  if (result.affectedRows !== 1)
    fail(
      "CONFLICT",
      "This token was just updated by someone else. Refresh and try again."
    );
  await recordEvent(tx, {
    type: EVENT_FOR_STATUS[to],
    entryId: entry.id,
    counterId: entry.counterId,
    groupId: entry.queueGroupId,
    actorUserId,
    fromStatus: entry.status,
    toStatus: to,
    metadata,
  });
}

// ---------------------------------------------------------------------------
// Estimation inputs
// ---------------------------------------------------------------------------

export type CameraSignal = {
  peopleCount: number;
  level: TrafficLevel;
  reportedAt: Date;
  fresh: boolean;
} | null;

export async function cameraSignalForGroup(
  executor: Executor,
  group: QueueGroup,
  now: Date
): Promise<CameraSignal> {
  const stations = await executor
    .select({
      lastReportedAt: cameraStations.lastReportedAt,
      lastPeopleCount: cameraStations.lastPeopleCount,
    })
    .from(cameraStations)
    .where(
      and(
        eq(cameraStations.queueGroupId, group.id),
        eq(cameraStations.isActive, true),
        isNotNull(cameraStations.lastReportedAt)
      )
    );
  if (stations.length === 0) return null;
  const { cameraStaleSeconds } = await getSettings();
  const latest = stations.reduce((a, b) =>
    (a.lastReportedAt?.getTime() ?? 0) >= (b.lastReportedAt?.getTime() ?? 0)
      ? a
      : b
  );
  const fresh = stations.filter(
    s =>
      s.lastReportedAt &&
      now.getTime() - s.lastReportedAt.getTime() <= cameraStaleSeconds * 1000
  );
  const source = fresh.length > 0 ? fresh : [latest];
  const peopleCount = Math.max(...source.map(s => s.lastPeopleCount ?? 0));
  return {
    peopleCount,
    level: trafficFromCount(
      peopleCount,
      group.cameraModerateAt,
      group.cameraHeavyAt
    ),
    reportedAt: latest.lastReportedAt!,
    fresh: fresh.length > 0,
  };
}

async function observedServiceSeconds(
  executor: Executor,
  queueGroupId: number,
  now: Date
): Promise<number[]> {
  const rows = await executor
    .select({
      servingAt: queueEntries.servingAt,
      completedAt: queueEntries.completedAt,
    })
    .from(queueEntries)
    .where(
      and(
        eq(queueEntries.queueGroupId, queueGroupId),
        eq(queueEntries.status, "COMPLETED"),
        gte(queueEntries.completedAt, new Date(now.getTime() - 3 * 3_600_000))
      )
    )
    .orderBy(desc(queueEntries.completedAt))
    .limit(20);
  return rows
    .filter(row => row.servingAt && row.completedAt)
    .map(row => (row.completedAt!.getTime() - row.servingAt!.getTime()) / 1000);
}

export type GroupParams = {
  serviceSeconds: number;
  configuredSeconds: number;
  observedSamples: number;
  staffTraffic: TrafficLevel;
  traffic: TrafficLevel;
  camera: CameraSignal;
};

export async function groupParams(
  executor: Executor,
  group: QueueGroup,
  now: Date
): Promise<GroupParams> {
  const observed = await observedServiceSeconds(executor, group.id, now);
  const camera = await cameraSignalForGroup(executor, group, now);
  return {
    serviceSeconds: blendServiceSeconds(group.averageServiceSeconds, observed),
    configuredSeconds: group.averageServiceSeconds,
    observedSamples: observed.length,
    staffTraffic: group.trafficLevel,
    traffic: effectiveTraffic(
      group.trafficLevel,
      group.cameraAssist && camera?.fresh ? camera.level : null
    ),
    camera,
  };
}

export function inProgressElapsed(
  active: QueueEntry[],
  now: Date
): number | null {
  const started = active
    .filter(entry => IN_PROGRESS.includes(entry.status))
    .map(entry => (entry.servingAt ?? entry.calledAt ?? now).getTime());
  return started.length
    ? Math.max(0, (now.getTime() - Math.min(...started)) / 1000)
    : null;
}

export function estimateFor(
  group: QueueGroup,
  params: GroupParams,
  peopleAhead: number,
  elapsed: number | null
): EstimateBreakdown {
  return estimateWait({
    peopleAhead,
    serviceSeconds: params.serviceSeconds,
    serveCapacity: group.serveCapacity,
    traffic: params.traffic,
    delaySeconds: group.trafficDelaySeconds,
    inProgressElapsedSeconds: elapsed,
  });
}

export function remainingSeconds(
  estimateSeconds: number,
  estimateAt: Date,
  now: Date
) {
  return Math.max(
    0,
    Math.round(estimateSeconds - (now.getTime() - estimateAt.getTime()) / 1000)
  );
}

// ---------------------------------------------------------------------------
// Line snapshots and recalculation
// ---------------------------------------------------------------------------

export type LinePosition = {
  entryId: number;
  userId: number;
  tokenNumber: string;
  position: number;
  peopleAhead: number;
  remainingSeconds: number;
};
export type LineState = Map<number, LinePosition>;

export async function snapshotLine(
  executor: Executor,
  counterId: number,
  now: Date
): Promise<LineState> {
  const active = await activeAtCounters(executor, [counterId]);
  const waiting = orderWaiting(
    active.filter(entry => entry.status === "WAITING")
  );
  return new Map(
    waiting.map((entry, index) => [
      entry.id,
      {
        entryId: entry.id,
        userId: entry.userId,
        tokenNumber: entry.tokenNumber,
        position: index + 1,
        peopleAhead: index,
        remainingSeconds: remainingSeconds(
          entry.estimatedWaitSeconds,
          entry.estimateUpdatedAt,
          now
        ),
      },
    ])
  );
}

/**
 * Recomputes positions and estimates for one counter, persists changed estimates, and sends the
 * one-time "almost your turn" alert. The caller must hold the counter lock.
 */
export async function recalculateCounter(
  tx: Tx,
  fx: Effects,
  counterId: number,
  now: Date,
  options: { quietAlmostNextFor?: number } = {}
): Promise<LineState> {
  const [counter] = await tx
    .select()
    .from(counters)
    .where(eq(counters.id, counterId))
    .limit(1);
  const { group, service } = await loadGroupContext(tx, counter.queueGroupId);
  const params = await groupParams(tx, group, now);
  const active = await activeAtCounters(tx, [counterId]);
  const elapsed = inProgressElapsed(active, now);
  const waiting = orderWaiting(
    active.filter(entry => entry.status === "WAITING")
  );
  const prefs = await loadPreferences(
    tx,
    waiting.map(entry => entry.userId)
  );
  const line: LineState = new Map();
  const alerts: NotificationInput[] = [];

  for (const [index, entry] of waiting.entries()) {
    const estimate = estimateFor(group, params, index, elapsed);
    const patch: Partial<typeof queueEntries.$inferInsert> = {};
    let seconds = entry.estimatedWaitSeconds;
    let at = entry.estimateUpdatedAt;
    if (
      shouldRefreshEstimate(
        entry.estimatedWaitSeconds,
        entry.estimateUpdatedAt,
        estimate.seconds,
        now
      )
    ) {
      patch.estimatedWaitSeconds = estimate.seconds;
      patch.estimateUpdatedAt = now;
      seconds = estimate.seconds;
      at = now;
    }
    const threshold = prefs.get(entry.userId)?.almostNextThreshold ?? 2;
    if (
      !entry.almostNextNotifiedAt &&
      index <= threshold &&
      counter.status === "OPEN"
    ) {
      patch.almostNextNotifiedAt = now;
      if (options.quietAlmostNextFor !== entry.id) {
        alerts.push({
          userId: entry.userId,
          type: "ALMOST_NEXT",
          title:
            index === 0
              ? `You're next: ${entry.tokenNumber}`
              : `Almost your turn: ${entry.tokenNumber}`,
          message: almostNextMessage(
            service.kind,
            entry.tokenNumber,
            counter.name,
            index,
            group.unitLabel
          ),
          queueEntryId: entry.id,
          tokenNumber: entry.tokenNumber,
        });
      }
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(queueEntries)
        .set(patch)
        .where(eq(queueEntries.id, entry.id));
      fx.entryChanged(entry.userId, entry.id);
    }
    line.set(entry.id, {
      entryId: entry.id,
      userId: entry.userId,
      tokenNumber: entry.tokenNumber,
      position: index + 1,
      peopleAhead: index,
      remainingSeconds: remainingSeconds(seconds, at, now),
    });
  }
  await notify(tx, fx, alerts, prefs);
  return line;
}

/** Notifies students whose estimate moved meaningfully between two snapshots. */
async function notifyWaitChanges(
  tx: Tx,
  fx: Effects,
  before: LineState,
  after: LineState,
  cause: { up: string; down: string }
) {
  const inputs: NotificationInput[] = [];
  after.forEach(next => {
    const prev = before.get(next.entryId);
    if (
      !prev ||
      !isMeaningfulWaitChange(prev.remainingSeconds, next.remainingSeconds)
    )
      return;
    const increased = next.remainingSeconds > prev.remainingSeconds;
    const from = Math.max(1, Math.round(prev.remainingSeconds / 60));
    const to = Math.max(1, Math.round(next.remainingSeconds / 60));
    inputs.push({
      userId: next.userId,
      type: increased ? "WAIT_INCREASED" : "WAIT_DECREASED",
      title: increased
        ? `Wait increased · ${next.tokenNumber}`
        : `Wait decreased · ${next.tokenNumber}`,
      message: `Estimated wait ${increased ? "increased" : "decreased"} from ${from} to ${to} minutes ${increased ? cause.up : cause.down}.`,
      queueEntryId: next.entryId,
      tokenNumber: next.tokenNumber,
    });
  });
  await notify(tx, fx, inputs);
}

// ---------------------------------------------------------------------------
// Student operations
// ---------------------------------------------------------------------------

export type JoinResult = {
  entryId: number;
  tokenNumber: string;
  counterId: number;
  counterName: string;
  position: number;
  peopleAhead: number;
  estimatedWaitSeconds: number;
};

export async function joinQueue(
  actor: Actor,
  input: { queueGroupId: number; counterId?: number }
): Promise<JoinResult> {
  const settings = await getSettings();
  return runOp(async (tx, fx) => {
    const now = new Date();
    // Serialise this student's joins so the active-token limit cannot be raced.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actor.id))
      .for("update");

    const { group, service } = await loadGroupContext(tx, input.queueGroupId);
    if (!service.isActive || !group.isActive) {
      fail(
        "SERVICE_UNAVAILABLE",
        `${group.name} isn't accepting tokens right now.`
      );
    }

    const mine = await tx
      .select({
        queueGroupId: queueEntries.queueGroupId,
        tokenNumber: queueEntries.tokenNumber,
      })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.userId, actor.id),
          inArray(queueEntries.status, ACTIVE)
        )
      );
    const existing = mine.find(entry => entry.queueGroupId === group.id);
    if (existing)
      fail(
        "DUPLICATE_ACTIVE_TOKEN",
        `You already hold token ${existing.tokenNumber} in ${group.name}.`
      );
    if (mine.length >= settings.maxActiveTokensPerStudent) {
      fail(
        "TOO_MANY_ACTIVE_TOKENS",
        `You can hold up to ${settings.maxActiveTokensPerStudent} active tokens at a time. Finish or cancel one first.`
      );
    }

    const groupCounters = await tx
      .select()
      .from(counters)
      .where(
        and(eq(counters.queueGroupId, group.id), eq(counters.isActive, true))
      );
    let chosenId: number;
    if (input.counterId) {
      const chosen = groupCounters.find(
        counter => counter.id === input.counterId
      );
      if (!chosen) fail("NOT_FOUND", "That counter isn't part of this queue.");
      if (chosen.status !== "OPEN") {
        fail(
          "COUNTER_UNAVAILABLE",
          chosen.status === "PAUSED"
            ? `${chosen.name} is paused. Choose another counter or try again shortly.`
            : `${chosen.name} is offline. Choose another counter.`
        );
      }
      chosenId = chosen.id;
    } else {
      const open = groupCounters.filter(counter => counter.status === "OPEN");
      if (open.length === 0)
        fail(
          "COUNTER_UNAVAILABLE",
          `No ${group.name} counter is open right now.`
        );
      const waitingCounts = await tx
        .select({ counterId: queueEntries.counterId, waiting: count() })
        .from(queueEntries)
        .where(
          and(
            inArray(
              queueEntries.counterId,
              open.map(c => c.id)
            ),
            eq(queueEntries.status, "WAITING")
          )
        )
        .groupBy(queueEntries.counterId);
      const waitingOf = (id: number) =>
        waitingCounts.find(row => row.counterId === id)?.waiting ?? 0;
      chosenId = [...open].sort(
        (a, b) =>
          waitingOf(a.id) - waitingOf(b.id) ||
          a.displayOrder - b.displayOrder ||
          a.id - b.id
      )[0].id;
    }

    const counter = await lockCounter(tx, chosenId);
    if (counter.status !== "OPEN")
      fail(
        "COUNTER_UNAVAILABLE",
        `${counter.name} just became unavailable. Please try again.`
      );

    const [{ waiting }] = await tx
      .select({ waiting: count() })
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.counterId, counter.id),
          eq(queueEntries.status, "WAITING")
        )
      );
    if (waiting >= group.maxWaiting) {
      fail(
        "QUEUE_FULL",
        `${counter.name} has reached its limit of ${group.maxWaiting} waiting. Please try again shortly.`
      );
    }

    const today = campusDate(now);
    const sequence = counter.sequenceDate === today ? counter.nextSequence : 1;
    const tokenNumber = `${counter.tokenPrefix}${String(sequence).padStart(3, "0")}`;
    await tx
      .update(counters)
      .set({
        nextSequence: sequence + 1,
        sequenceDate: today,
        nextOrderKey: counter.nextOrderKey + 1,
      })
      .where(eq(counters.id, counter.id));

    let entryId: number;
    try {
      const [row] = await tx
        .insert(queueEntries)
        .values({
          serviceId: service.id,
          queueGroupId: group.id,
          counterId: counter.id,
          originalCounterId: counter.id,
          userId: actor.id,
          tokenNumber,
          queueDate: today,
          sequenceNumber: sequence,
          orderKey: counter.nextOrderKey,
          status: "WAITING",
          estimateUpdatedAt: now,
          joinedAt: now,
        })
        .$returningId();
      entryId = row.id;
    } catch (error) {
      if (isDuplicateKeyError(error, "queue_entries_one_active_per_group")) {
        fail(
          "DUPLICATE_ACTIVE_TOKEN",
          `You already hold a token in ${group.name}.`
        );
      }
      throw error;
    }

    await recordEvent(tx, {
      type: "JOINED",
      entryId,
      counterId: counter.id,
      groupId: group.id,
      actorUserId: actor.id,
      toStatus: "WAITING",
      metadata: {
        tokenNumber,
        assignment: input.counterId ? "chosen" : "shortest-line",
      },
    });

    const line = await recalculateCounter(tx, fx, counter.id, now, {
      quietAlmostNextFor: entryId,
    });
    const me = line.get(entryId)!;
    await notify(tx, fx, [
      {
        userId: actor.id,
        type: "QUEUE_JOINED",
        title: `You're in the queue: ${tokenNumber}`,
        message: `${service.name} · ${group.name} · ${counter.name}. ${aheadText(me.peopleAhead, group.unitLabel)}; estimated wait about ${minutesLabel(me.remainingSeconds)}. You can leave the physical line — we'll alert you as your turn approaches.`,
        queueEntryId: entryId,
        tokenNumber,
      },
    ]);
    fx.queueChanged([counter.id], [group.id], "JOINED");
    fx.entryChanged(actor.id, entryId);
    return {
      entryId,
      tokenNumber,
      counterId: counter.id,
      counterName: counter.name,
      position: me.position,
      peopleAhead: me.peopleAhead,
      estimatedWaitSeconds: me.remainingSeconds,
    };
  });
}

/** Locks the entry's current counter and re-reads the entry (a merge may have moved it). */
async function lockEntry(
  tx: Tx,
  entryId: number
): Promise<{ entry: QueueEntry; counter: Counter }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [peek] = await tx
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, entryId))
      .limit(1);
    if (!peek) fail("NOT_FOUND", "That token doesn't exist.");
    const counter = await lockCounter(tx, peek.counterId);
    const [entry] = await tx
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, entryId))
      .limit(1);
    if (entry.counterId === counter.id) return { entry, counter };
  }
  fail(
    "CONFLICT",
    "This token was just moved to another counter. Refresh and try again."
  );
}

export async function cancelOwnEntry(actor: Actor, entryId: number) {
  return runOp(async (tx, fx) => {
    const now = new Date();
    const [peek] = await tx
      .select({ userId: queueEntries.userId })
      .from(queueEntries)
      .where(eq(queueEntries.id, entryId))
      .limit(1);
    // Do not reveal whether someone else's token exists.
    if (!peek || peek.userId !== actor.id)
      fail("NOT_FOUND", "That token doesn't exist.");
    const { entry, counter } = await lockEntry(tx, entryId);
    if (entry.status === "SERVING")
      fail(
        "INVALID_TRANSITION",
        "You're already being served, so this token can't be cancelled."
      );
    await transition(tx, entry, "CANCELLED", actor.id, now, {
      closedReason: "Cancelled by student",
      closedByUserId: actor.id,
    });
    await recalculateCounter(tx, fx, counter.id, now);
    fx.queueChanged([counter.id], [entry.queueGroupId], "CANCELLED");
    fx.entryChanged(actor.id, entry.id);
    return { ok: true as const, tokenNumber: entry.tokenNumber };
  });
}

// ---------------------------------------------------------------------------
// Staff operations
// ---------------------------------------------------------------------------

export async function callNext(actor: Actor, counterId: number) {
  return runOp(async (tx, fx) => {
    const now = new Date();
    await assertCounterAccess(tx, actor, counterId);
    const counter = await lockCounter(tx, counterId);
    if (counter.status !== "OPEN") {
      fail(
        "COUNTER_UNAVAILABLE",
        `${counter.name} is ${counter.status.toLowerCase()}. Resume it before calling tokens.`
      );
    }
    const { group, service } = await loadGroupContext(tx, counter.queueGroupId);
    const active = await activeAtCounters(tx, [counterId]);
    const inProgress = active.filter(entry =>
      IN_PROGRESS.includes(entry.status)
    );
    const slots = group.serveCapacity - inProgress.length;
    if (slots <= 0) {
      fail(
        "INVALID_TRANSITION",
        group.serveCapacity === 1
          ? `Complete, skip or cancel ${inProgress[0].tokenNumber} before calling the next token.`
          : `This counter already has a full batch of ${group.serveCapacity} in progress.`
      );
    }
    const next = orderWaiting(
      active.filter(entry => entry.status === "WAITING")
    ).slice(0, slots);
    if (next.length === 0)
      fail("NOT_FOUND", "No one is waiting at this counter.");

    for (const entry of next) {
      await transition(tx, entry, "CALLED", actor.id, now);
      fx.entryChanged(entry.userId, entry.id);
    }
    await notify(
      tx,
      fx,
      next.map(entry => ({
        userId: entry.userId,
        type: "TOKEN_CALLED" as const,
        title: `Your turn: ${entry.tokenNumber}`,
        message: calledMessage(service.kind, entry.tokenNumber, counter.name),
        queueEntryId: entry.id,
        tokenNumber: entry.tokenNumber,
      }))
    );
    await recalculateCounter(tx, fx, counterId, now);
    fx.queueChanged([counterId], [group.id], "CALLED");
    return {
      called: next.map(entry => ({
        id: entry.id,
        tokenNumber: entry.tokenNumber,
      })),
    };
  });
}

type EntryAction = "SERVE" | "COMPLETE" | "SKIP" | "CANCEL";

const ACTION_TARGET: Record<EntryAction, QueueStatus> = {
  SERVE: "SERVING",
  COMPLETE: "COMPLETED",
  SKIP: "SKIPPED",
  CANCEL: "CANCELLED",
};

/** Serve / complete / skip / cancel one or more tokens at a single counter. */
export async function actOnEntries(
  actor: Actor,
  input: { entryIds: number[]; action: EntryAction; reason?: string },
  meta: Meta = {}
) {
  const ids = [...new Set(input.entryIds)];
  if (input.action === "CANCEL" && !input.reason?.trim())
    fail("VALIDATION", "Please give a reason for cancelling.");
  return runOp(async (tx, fx) => {
    const now = new Date();
    const first = await lockEntry(tx, ids[0]);
    await assertCounterAccess(tx, actor, first.counter.id);
    const { group, service } = await loadGroupContext(
      tx,
      first.counter.queueGroupId
    );
    const to = ACTION_TARGET[input.action];
    const results: Array<{ id: number; tokenNumber: string }> = [];
    const alerts: NotificationInput[] = [];
    for (const id of ids) {
      const [entry] = await tx
        .select()
        .from(queueEntries)
        .where(eq(queueEntries.id, id))
        .limit(1);
      if (!entry || entry.counterId !== first.counter.id)
        fail(
          "VALIDATION",
          "All selected tokens must belong to the same counter."
        );
      const reason = input.reason?.trim() || null;
      await transition(
        tx,
        entry,
        to,
        actor.id,
        now,
        to === "SKIPPED" || to === "CANCELLED"
          ? { closedReason: reason, closedByUserId: actor.id }
          : {},
        reason ? { reason } : {}
      );
      fx.entryChanged(entry.userId, entry.id);
      results.push({ id: entry.id, tokenNumber: entry.tokenNumber });
      const counterName = first.counter.name;
      if (to === "SERVING") {
        alerts.push({
          userId: entry.userId,
          type: "SERVICE_STARTED",
          title: `Now serving ${entry.tokenNumber}`,
          message:
            service.kind === "ELEVATOR"
              ? `Boarding ${counterName} with token ${entry.tokenNumber}.`
              : `${counterName} is now serving token ${entry.tokenNumber}.`,
          queueEntryId: entry.id,
          tokenNumber: entry.tokenNumber,
        });
      } else if (to === "COMPLETED") {
        alerts.push({
          userId: entry.userId,
          type: "SERVICE_COMPLETED",
          title: `Completed · ${entry.tokenNumber}`,
          message: `Your ${service.name} visit with token ${entry.tokenNumber} is complete. Thanks for using QueueSense.`,
          queueEntryId: entry.id,
          tokenNumber: entry.tokenNumber,
        });
      } else if (to === "SKIPPED") {
        alerts.push({
          userId: entry.userId,
          type: "TOKEN_SKIPPED",
          title: `Token skipped · ${entry.tokenNumber}`,
          message: `Token ${entry.tokenNumber} at ${counterName} was skipped${reason ? ` (${reason})` : " because it wasn't answered"}. You can take a new token if you still need ${group.name}.`,
          queueEntryId: entry.id,
          tokenNumber: entry.tokenNumber,
        });
      } else if (to === "CANCELLED") {
        alerts.push({
          userId: entry.userId,
          type: "TOKEN_CANCELLED",
          title: `Token cancelled · ${entry.tokenNumber}`,
          message: `Staff cancelled token ${entry.tokenNumber} at ${counterName}: ${reason}.`,
          queueEntryId: entry.id,
          tokenNumber: entry.tokenNumber,
        });
      }
    }
    await notify(tx, fx, alerts);
    if (to === "CANCELLED") {
      await audit(tx, {
        actorUserId: actor.id,
        action: "queue.token_cancelled",
        entityType: "queue_entry",
        entityId: ids.join(","),
        metadata: {
          reason: input.reason,
          tokens: results.map(r => r.tokenNumber),
        },
        ip: meta.ip,
      });
    }
    await recalculateCounter(tx, fx, first.counter.id, now);
    fx.queueChanged([first.counter.id], [group.id], EVENT_FOR_STATUS[to]);
    return { updated: results };
  });
}

export async function setPriority(
  actor: Actor,
  input: { entryId: number; enabled: boolean; reason: string },
  meta: Meta = {}
) {
  const reason = input.reason.trim();
  if (reason.length < 3)
    fail("VALIDATION", "A reason of at least 3 characters is required.");
  return runOp(async (tx, fx) => {
    const now = new Date();
    const { entry, counter } = await lockEntry(tx, input.entryId);
    await assertCounterAccess(tx, actor, counter.id);
    if (entry.status !== "WAITING")
      fail(
        "INVALID_TRANSITION",
        `Only waiting tokens can have their priority changed; ${entry.tokenNumber} is ${entry.status.toLowerCase()}.`
      );
    if (entry.isPriority === input.enabled) {
      fail(
        "CONFLICT",
        input.enabled
          ? `${entry.tokenNumber} already has priority.`
          : `${entry.tokenNumber} doesn't have priority.`
      );
    }
    const before = await snapshotLine(tx, counter.id, now);
    await tx
      .update(queueEntries)
      .set(
        input.enabled
          ? {
              isPriority: true,
              priorityAt: now,
              priorityReason: reason,
              priorityByUserId: actor.id,
            }
          : {
              isPriority: false,
              priorityAt: null,
              priorityReason: null,
              priorityByUserId: null,
            }
      )
      .where(eq(queueEntries.id, entry.id));
    const after = await recalculateCounter(tx, fx, counter.id, now);
    const previousPosition = before.get(entry.id)?.position ?? null;
    const newPosition = after.get(entry.id)?.position ?? null;
    await recordEvent(tx, {
      type: input.enabled ? "PRIORITY_ASSIGNED" : "PRIORITY_REMOVED",
      entryId: entry.id,
      counterId: counter.id,
      groupId: entry.queueGroupId,
      actorUserId: actor.id,
      metadata: { reason, previousPosition, newPosition },
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: input.enabled
        ? "queue.priority_assigned"
        : "queue.priority_removed",
      entityType: "queue_entry",
      entityId: entry.id,
      metadata: {
        tokenNumber: entry.tokenNumber,
        counterId: counter.id,
        reason,
        previousPosition,
        newPosition,
      },
      ip: meta.ip,
    });

    const alerts: NotificationInput[] = [
      input.enabled
        ? {
            userId: entry.userId,
            type: "PRIORITY_ASSIGNED",
            title: `Priority given · ${entry.tokenNumber}`,
            message: `Your token ${entry.tokenNumber} has been given priority${newPosition ? ` and is now position ${newPosition}` : ""}. Please be ready when called.`,
            queueEntryId: entry.id,
            tokenNumber: entry.tokenNumber,
          }
        : {
            userId: entry.userId,
            type: "POSITION_CHANGED",
            title: `Priority removed · ${entry.tokenNumber}`,
            message: `Priority was removed from token ${entry.tokenNumber}. Your position is now ${newPosition}.`,
            queueEntryId: entry.id,
            tokenNumber: entry.tokenNumber,
          },
    ];
    after.forEach(next => {
      const prev = before.get(next.entryId);
      if (next.entryId === entry.id || !prev || prev.position === next.position)
        return;
      alerts.push({
        userId: next.userId,
        type: "PRIORITY_ADJUSTMENT",
        title: `Queue order updated · ${next.tokenNumber}`,
        message: `Queue order was updated due to a priority adjustment. Your token ${next.tokenNumber} is now position ${next.position}.`,
        queueEntryId: next.entryId,
        tokenNumber: next.tokenNumber,
      });
    });
    await notify(tx, fx, alerts);
    fx.queueChanged(
      [counter.id],
      [entry.queueGroupId],
      input.enabled ? "PRIORITY_ASSIGNED" : "PRIORITY_REMOVED"
    );
    fx.entryChanged(entry.userId, entry.id);
    return { tokenNumber: entry.tokenNumber, previousPosition, newPosition };
  });
}

export async function setTraffic(
  actor: Actor,
  input: {
    queueGroupId: number;
    level: TrafficLevel;
    delaySeconds: number;
    reason?: string;
  },
  meta: Meta = {}
) {
  return runOp(async (tx, fx) => {
    const now = new Date();
    await assertGroupAccess(tx, actor, input.queueGroupId);
    const [group] = await tx
      .select()
      .from(queueGroups)
      .where(eq(queueGroups.id, input.queueGroupId))
      .for("update");
    if (!group) fail("NOT_FOUND", "That queue doesn't exist.");
    const groupCounters = await tx
      .select({ id: counters.id })
      .from(counters)
      .where(eq(counters.queueGroupId, group.id))
      .orderBy(counters.id)
      .for("update");
    const before = new Map<number, LineState>();
    for (const counter of groupCounters)
      before.set(counter.id, await snapshotLine(tx, counter.id, now));

    const reason = input.reason?.trim() || null;
    await tx
      .update(queueGroups)
      .set({
        trafficLevel: input.level,
        trafficDelaySeconds: input.delaySeconds,
        trafficReason: reason,
        trafficUpdatedAt: now,
        trafficUpdatedByUserId: actor.id,
      })
      .where(eq(queueGroups.id, group.id));

    const because = reason ? ` (${reason})` : "";
    for (const counter of groupCounters) {
      const after = await recalculateCounter(tx, fx, counter.id, now);
      await notifyWaitChanges(tx, fx, before.get(counter.id)!, after, {
        up: `due to ${input.level === "NORMAL" ? "a service delay" : "heavier traffic"}${because}`,
        down: `as traffic eased${because}`,
      });
    }
    const change = {
      from: {
        level: group.trafficLevel,
        delaySeconds: group.trafficDelaySeconds,
      },
      to: { level: input.level, delaySeconds: input.delaySeconds },
      reason,
    };
    await recordEvent(tx, {
      type: "TRAFFIC_UPDATED",
      groupId: group.id,
      actorUserId: actor.id,
      metadata: change,
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: "queue.traffic_updated",
      entityType: "queue_group",
      entityId: group.id,
      metadata: change,
      ip: meta.ip,
    });
    fx.queueChanged(
      groupCounters.map(c => c.id),
      [group.id],
      "TRAFFIC_UPDATED"
    );
    return { ok: true as const };
  });
}

async function mergeInsideTx(
  tx: Tx,
  fx: Effects,
  actor: Actor,
  input: {
    sourceCounterId: number;
    targetCounterId: number;
    strategy?: MergeStrategy;
    reason: string;
  },
  now: Date,
  meta: Meta
) {
  if (input.sourceCounterId === input.targetCounterId)
    fail("VALIDATION", "Choose a different counter to merge into.");
  // Authorised if the actor operates either side of the merge.
  if (actor.role !== "ADMIN") {
    try {
      await assertCounterAccess(tx, actor, input.sourceCounterId);
    } catch {
      await assertCounterAccess(tx, actor, input.targetCounterId);
    }
  }
  const [lowId, highId] = [input.sourceCounterId, input.targetCounterId].sort(
    (a, b) => a - b
  );
  const low = await lockCounter(tx, lowId);
  const high = await lockCounter(tx, highId);
  const source = low.id === input.sourceCounterId ? low : high;
  const target = low.id === input.targetCounterId ? low : high;
  if (source.queueGroupId !== target.queueGroupId)
    fail("VALIDATION", "Counters can only be merged within the same queue.");
  if (target.status === "OFFLINE")
    fail(
      "COUNTER_UNAVAILABLE",
      `${target.name} is offline and can't take over another queue.`
    );
  const { group, service } = await loadGroupContext(tx, source.queueGroupId);
  const strategy = input.strategy ?? group.mergeStrategy;

  const sourceActive = await activeAtCounters(tx, [source.id]);
  const serving = sourceActive.filter(entry => entry.status === "SERVING");
  if (serving.length > 0) {
    fail(
      "INVALID_TRANSITION",
      `Finish serving ${serving.map(e => e.tokenNumber).join(", ")} at ${source.name} before merging.`
    );
  }
  const beforeTarget = await snapshotLine(tx, target.id, now);
  const beforeSource = await snapshotLine(tx, source.id, now);

  // Tokens already called to the unavailable counter go back to the front of its line.
  for (const called of sourceActive.filter(
    entry => entry.status === "CALLED"
  )) {
    await transition(
      tx,
      called,
      "WAITING",
      actor.id,
      now,
      {},
      { requeuedFrom: source.id }
    );
  }
  const sourceWaiting = (await activeAtCounters(tx, [source.id])).filter(
    entry => entry.status === "WAITING"
  );
  const targetWaiting = (await activeAtCounters(tx, [target.id])).filter(
    entry => entry.status === "WAITING"
  );
  const woven = mergeLines(
    targetWaiting.filter(entry => !entry.isPriority),
    sourceWaiting.filter(entry => !entry.isPriority),
    strategy
  );
  let orderKey = target.nextOrderKey;
  for (const entry of woven) {
    await tx
      .update(queueEntries)
      .set({ counterId: target.id, orderKey: orderKey++ })
      .where(eq(queueEntries.id, entry.id));
  }
  for (const entry of sourceWaiting.filter(e => e.isPriority)) {
    await tx
      .update(queueEntries)
      .set({ counterId: target.id })
      .where(eq(queueEntries.id, entry.id));
  }
  await tx
    .update(counters)
    .set({ nextOrderKey: orderKey })
    .where(eq(counters.id, target.id));
  const reason = input.reason.trim();
  await tx
    .update(counters)
    .set({
      status: "OFFLINE",
      statusReason: reason,
      statusUpdatedAt: now,
      mergedIntoCounterId: target.id,
    })
    .where(eq(counters.id, source.id));

  for (const entry of sourceWaiting) {
    await recordEvent(tx, {
      type: "MERGED",
      entryId: entry.id,
      counterId: target.id,
      groupId: group.id,
      actorUserId: actor.id,
      metadata: {
        fromCounterId: source.id,
        toCounterId: target.id,
        strategy,
        reason,
      },
    });
  }
  await recordEvent(tx, {
    type: "COUNTER_STATUS",
    counterId: source.id,
    groupId: group.id,
    actorUserId: actor.id,
    fromStatus: source.status,
    toStatus: "OFFLINE",
    metadata: {
      reason,
      mergedIntoCounterId: target.id,
      moved: sourceWaiting.length,
    },
  });

  const after = await recalculateCounter(tx, fx, target.id, now);
  const alerts: NotificationInput[] = [];
  sourceWaiting.forEach(entry => {
    const next = after.get(entry.id);
    if (!next) return;
    alerts.push({
      userId: entry.userId,
      type: "QUEUE_MERGED",
      title: `Moved to ${target.name} · ${entry.tokenNumber}`,
      message: `${source.name} is unavailable (${reason}). Your token ${entry.tokenNumber} now continues at ${target.name} — position ${next.position}, about ${minutesLabel(next.remainingSeconds)}. Your place was not lost.`,
      queueEntryId: entry.id,
      tokenNumber: entry.tokenNumber,
    });
    fx.entryChanged(entry.userId, entry.id);
  });
  after.forEach(next => {
    const prev = beforeTarget.get(next.entryId);
    if (!prev || prev.position === next.position) return;
    alerts.push({
      userId: next.userId,
      type: "POSITION_CHANGED",
      title: `Queues merged · ${next.tokenNumber}`,
      message: `${source.name}'s queue was merged into ${target.name}. Your token ${next.tokenNumber} is now position ${next.position} (was ${prev.position}).`,
      queueEntryId: next.entryId,
      tokenNumber: next.tokenNumber,
    });
  });
  await notify(tx, fx, alerts);
  await audit(tx, {
    actorUserId: actor.id,
    action: "queue.merged",
    entityType: "counter",
    entityId: source.id,
    metadata: {
      sourceCounterId: source.id,
      targetCounterId: target.id,
      strategy,
      reason,
      moved: sourceWaiting.length,
    },
    ip: meta.ip,
  });
  fx.queueChanged([source.id, target.id], [group.id], "MERGED");
  void service;
  void beforeSource;
  return { moved: sourceWaiting.length, strategy, targetCounterId: target.id };
}

export async function mergeCounters(
  actor: Actor,
  input: {
    sourceCounterId: number;
    targetCounterId: number;
    strategy?: MergeStrategy;
    reason: string;
  },
  meta: Meta = {}
) {
  if (input.reason.trim().length < 3)
    fail("VALIDATION", "A reason of at least 3 characters is required.");
  return runOp((tx, fx) =>
    mergeInsideTx(tx, fx, actor, input, new Date(), meta)
  );
}

export async function setCounterStatus(
  actor: Actor,
  input: {
    counterId: number;
    status: "OPEN" | "PAUSED" | "OFFLINE";
    reason?: string;
    mergeIntoCounterId?: number;
    strategy?: MergeStrategy;
  },
  meta: Meta = {}
) {
  if (input.status === "OFFLINE" && input.mergeIntoCounterId) {
    return mergeCounters(
      actor,
      {
        sourceCounterId: input.counterId,
        targetCounterId: input.mergeIntoCounterId,
        strategy: input.strategy,
        reason: input.reason?.trim() || "Counter unavailable",
      },
      meta
    );
  }
  return runOp(async (tx, fx) => {
    const now = new Date();
    await assertCounterAccess(tx, actor, input.counterId);
    const counter = await lockCounter(tx, input.counterId);
    if (counter.status === input.status) return { moved: 0 };
    const reason = input.reason?.trim() || null;
    await tx
      .update(counters)
      .set({
        status: input.status,
        statusReason: reason,
        statusUpdatedAt: now,
        ...(input.status === "OPEN" ? { mergedIntoCounterId: null } : {}),
      })
      .where(eq(counters.id, counter.id));
    await recordEvent(tx, {
      type: "COUNTER_STATUS",
      counterId: counter.id,
      groupId: counter.queueGroupId,
      actorUserId: actor.id,
      fromStatus: counter.status,
      toStatus: input.status,
      metadata: { reason },
    });
    await audit(tx, {
      actorUserId: actor.id,
      action: `counter.${input.status === "OPEN" ? "resumed" : input.status === "PAUSED" ? "paused" : "offline"}`,
      entityType: "counter",
      entityId: counter.id,
      metadata: { from: counter.status, to: input.status, reason },
      ip: meta.ip,
    });
    const line = await recalculateCounter(tx, fx, counter.id, now);
    const type =
      input.status === "OPEN"
        ? "COUNTER_RESUMED"
        : input.status === "PAUSED"
          ? "COUNTER_PAUSED"
          : "COUNTER_OFFLINE";
    const alerts: NotificationInput[] = [];
    line.forEach(position =>
      alerts.push({
        userId: position.userId,
        type,
        title: `${counter.name} ${input.status === "OPEN" ? "reopened" : input.status === "PAUSED" ? "paused" : "offline"}`,
        message: counterStatusMessage(
          input.status,
          counter.name,
          position.tokenNumber,
          reason
        ),
        queueEntryId: position.entryId,
        tokenNumber: position.tokenNumber,
      })
    );
    await notify(tx, fx, alerts);
    fx.queueChanged([counter.id], [counter.queueGroupId], "COUNTER_STATUS");
    return { moved: 0 };
  });
}

/** Cancels every active token a user holds (e.g. account suspended). */
export async function cancelAllForUser(
  tx: Tx,
  fx: Effects,
  userId: number,
  actorUserId: number,
  reason: string
) {
  const now = new Date();
  const active = await tx
    .select({ id: queueEntries.id })
    .from(queueEntries)
    .where(
      and(eq(queueEntries.userId, userId), inArray(queueEntries.status, ACTIVE))
    );
  for (const { id } of active) {
    const { entry, counter } = await lockEntry(tx, id);
    if (!ACTIVE.includes(entry.status as (typeof ACTIVE)[number])) continue;
    await transition(
      tx,
      entry,
      "CANCELLED",
      actorUserId,
      now,
      { closedReason: reason, closedByUserId: actorUserId },
      { reason }
    );
    await recalculateCounter(tx, fx, counter.id, now);
    fx.queueChanged([counter.id], [entry.queueGroupId], "CANCELLED");
    fx.entryChanged(userId, entry.id);
  }
  return active.length;
}

/**
 * Re-evaluates the estimate of every counter that has people waiting. Runs periodically so estimates
 * stay honest when service takes longer than expected, and after camera-driven traffic changes.
 */
export async function recalculateGroups(
  queueGroupIds: number[] | null,
  cause?: { up: string; down: string }
) {
  const rows = await db
    .selectDistinct({
      counterId: queueEntries.counterId,
      queueGroupId: queueEntries.queueGroupId,
    })
    .from(queueEntries)
    .where(
      queueGroupIds
        ? and(
            eq(queueEntries.status, "WAITING"),
            inArray(queueEntries.queueGroupId, queueGroupIds)
          )
        : eq(queueEntries.status, "WAITING")
    );
  for (const row of rows) {
    try {
      await runOp(async (tx, fx) => {
        const now = new Date();
        await lockCounter(tx, row.counterId);
        const before = cause
          ? await snapshotLine(tx, row.counterId, now)
          : null;
        const after = await recalculateCounter(tx, fx, row.counterId, now);
        if (before && cause)
          await notifyWaitChanges(tx, fx, before, after, cause);
        if (fx.hasEntryChanges)
          fx.queueChanged([row.counterId], [row.queueGroupId], "CONFIG");
      });
    } catch (error) {
      logger.warn("Periodic recalculation failed for counter", {
        counterId: row.counterId,
        error,
      });
    }
  }
}
