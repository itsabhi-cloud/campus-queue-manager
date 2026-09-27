/** Read models. Positions and estimates are always derived from authoritative database state. */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { ACTIVE_QUEUE_STATUSES } from "../../shared/domain";
import {
  counters,
  queueEntries,
  queueEvents,
  queueGroups,
  services,
  studentProfiles,
  users,
  type Counter,
  type QueueEntry,
  type QueueGroup,
} from "../../drizzle/schema";
import type { Executor } from "../db/client";
import { startOfCampusDay } from "../lib/time";
import { estimateFor, groupParams, inProgressElapsed, type GroupParams } from "./engine";
import { orderWaiting } from "./ordering";

const ACTIVE = [...ACTIVE_QUEUE_STATUSES];

function trafficView(group: QueueGroup, params: GroupParams) {
  return {
    staffLevel: group.trafficLevel,
    effectiveLevel: params.traffic,
    delaySeconds: group.trafficDelaySeconds,
    reason: group.trafficReason,
    updatedAt: group.trafficUpdatedAt,
    cameraAssist: group.cameraAssist,
    serviceSeconds: params.serviceSeconds,
    configuredSeconds: params.configuredSeconds,
    observedSamples: params.observedSamples,
  };
}

function cameraView(params: GroupParams) {
  return params.camera
    ? { peopleCount: params.camera.peopleCount, level: params.camera.level, reportedAt: params.camera.reportedAt, fresh: params.camera.fresh }
    : null;
}

function counterLine(group: QueueGroup, params: GroupParams, counter: Counter, active: QueueEntry[], now: Date) {
  const mine = active.filter(entry => entry.counterId === counter.id);
  const waiting = orderWaiting(mine.filter(entry => entry.status === "WAITING"));
  const inProgress = mine.filter(entry => entry.status === "CALLED" || entry.status === "SERVING");
  const elapsed = inProgressElapsed(mine, now);
  return { waiting, inProgress, newJoinerSeconds: estimateFor(group, params, waiting.length, elapsed).seconds };
}

async function groupSummary(executor: Executor, group: QueueGroup, groupCounters: Counter[], active: QueueEntry[], now: Date) {
  const params = await groupParams(executor, group, now);
  const countersOut = groupCounters.map(counter => {
    const line = counterLine(group, params, counter, active, now);
    return {
      id: counter.id,
      name: counter.name,
      tokenPrefix: counter.tokenPrefix,
      status: counter.status,
      statusReason: counter.statusReason,
      mergedIntoCounterId: counter.mergedIntoCounterId,
      waiting: line.waiting.length,
      nowServing: line.inProgress.map(entry => entry.tokenNumber),
      estimatedWaitSeconds: line.newJoinerSeconds,
    };
  });
  const open = countersOut.filter(counter => counter.status === "OPEN");
  return {
    id: group.id,
    serviceId: group.serviceId,
    slug: group.slug,
    name: group.name,
    description: group.description,
    unitLabel: group.unitLabel,
    serveCapacity: group.serveCapacity,
    waiting: countersOut.reduce((sum, counter) => sum + counter.waiting, 0),
    openCounters: open.length,
    estimatedWaitSeconds: open.length ? Math.min(...open.map(counter => counter.estimatedWaitSeconds)) : null,
    traffic: trafficView(group, params),
    camera: cameraView(params),
    counters: countersOut,
  };
}

/** Public-to-signed-in-users service catalogue with live aggregate numbers (no personal data). */
export async function catalogView(executor: Executor, now = new Date()) {
  const serviceRows = await executor.select().from(services).where(eq(services.isActive, true)).orderBy(asc(services.displayOrder), asc(services.id));
  const groupRows = await executor.select().from(queueGroups).where(eq(queueGroups.isActive, true)).orderBy(asc(queueGroups.displayOrder), asc(queueGroups.id));
  const counterRows = await executor.select().from(counters).where(eq(counters.isActive, true)).orderBy(asc(counters.displayOrder), asc(counters.id));
  const active = await executor.select().from(queueEntries).where(inArray(queueEntries.status, ACTIVE));

  const groupsOut: Array<Awaited<ReturnType<typeof groupSummary>>> = [];
  for (const group of groupRows) {
    groupsOut.push(await groupSummary(executor, group, counterRows.filter(counter => counter.queueGroupId === group.id), active, now));
  }
  return {
    serverTime: now,
    services: serviceRows.map(service => ({
      id: service.id,
      slug: service.slug,
      name: service.name,
      description: service.description,
      kind: service.kind,
      notice: service.notice,
      groups: groupsOut.filter(group => group.serviceId === service.id),
    })),
  };
}

/** The signed-in student's active tokens with live positions. */
export async function myActiveView(executor: Executor, userId: number, now = new Date()) {
  const mine = await executor
    .select({ entry: queueEntries, counter: counters, group: queueGroups, service: services })
    .from(queueEntries)
    .innerJoin(counters, eq(counters.id, queueEntries.counterId))
    .innerJoin(queueGroups, eq(queueGroups.id, queueEntries.queueGroupId))
    .innerJoin(services, eq(services.id, queueEntries.serviceId))
    .where(and(eq(queueEntries.userId, userId), inArray(queueEntries.status, ACTIVE)))
    .orderBy(asc(queueEntries.joinedAt));
  if (mine.length === 0) return { serverTime: now, entries: [] };

  const counterIds = [...new Set(mine.map(row => row.counter.id))];
  const lines = await executor
    .select()
    .from(queueEntries)
    .where(and(inArray(queueEntries.counterId, counterIds), inArray(queueEntries.status, ACTIVE)));
  const originals = await executor
    .select({ id: counters.id, name: counters.name })
    .from(counters)
    .where(inArray(counters.id, [...new Set(mine.map(row => row.entry.originalCounterId))]));

  const entries = [];
  for (const { entry, counter, group, service } of mine) {
    const atCounter = lines.filter(row => row.counterId === counter.id);
    const waiting = orderWaiting(atCounter.filter(row => row.status === "WAITING"));
    const index = waiting.findIndex(row => row.id === entry.id);
    const params = await groupParams(executor, group, now);
    entries.push({
      id: entry.id,
      tokenNumber: entry.tokenNumber,
      status: entry.status,
      isPriority: entry.isPriority,
      joinedAt: entry.joinedAt,
      calledAt: entry.calledAt,
      servingAt: entry.servingAt,
      position: index >= 0 ? index + 1 : 0,
      peopleAhead: index >= 0 ? index : 0,
      waitingTotal: waiting.length,
      estimatedWaitSeconds: entry.status === "WAITING" ? entry.estimatedWaitSeconds : 0,
      estimateUpdatedAt: entry.estimateUpdatedAt,
      nowServing: atCounter.filter(row => row.status === "CALLED" || row.status === "SERVING").map(row => row.tokenNumber),
      movedFrom: entry.originalCounterId !== entry.counterId ? (originals.find(c => c.id === entry.originalCounterId)?.name ?? null) : null,
      service: { id: service.id, name: service.name, kind: service.kind, slug: service.slug, notice: service.notice },
      group: { id: group.id, name: group.name, unitLabel: group.unitLabel },
      counter: { id: counter.id, name: counter.name, status: counter.status, statusReason: counter.statusReason },
      traffic: trafficView(group, params),
      camera: cameraView(params),
    });
  }
  return { serverTime: now, entries };
}

/** Everything a staff member needs to run one counter. */
export async function staffBoardView(executor: Executor, counterId: number, now = new Date()) {
  const [row] = await executor
    .select({ counter: counters, group: queueGroups, service: services })
    .from(counters)
    .innerJoin(queueGroups, eq(queueGroups.id, counters.queueGroupId))
    .innerJoin(services, eq(services.id, queueGroups.serviceId))
    .where(eq(counters.id, counterId))
    .limit(1);
  if (!row) return null;
  const { counter, group, service } = row;
  const params = await groupParams(executor, group, now);
  const siblings = await executor.select().from(counters).where(and(eq(counters.queueGroupId, group.id), eq(counters.isActive, true))).orderBy(asc(counters.displayOrder), asc(counters.id));
  const active = await executor
    .select({ entry: queueEntries, name: users.name, collegeId: studentProfiles.collegeId })
    .from(queueEntries)
    .innerJoin(users, eq(users.id, queueEntries.userId))
    .leftJoin(studentProfiles, eq(studentProfiles.userId, queueEntries.userId))
    .where(and(inArray(queueEntries.counterId, siblings.map(s => s.id)), inArray(queueEntries.status, ACTIVE)));
  const here = active.filter(item => item.entry.counterId === counter.id);
  const waiting = orderWaiting(here.filter(item => item.entry.status === "WAITING").map(item => item.entry));
  const elapsed = inProgressElapsed(here.map(item => item.entry), now);
  const origins = new Map(siblings.map(s => [s.id, s.name]));

  const dayStart = startOfCampusDay(now);
  const today = await executor
    .select({ status: queueEntries.status, servingAt: queueEntries.servingAt, completedAt: queueEntries.completedAt, calledAt: queueEntries.calledAt, joinedAt: queueEntries.joinedAt })
    .from(queueEntries)
    .where(and(eq(queueEntries.counterId, counter.id), gte(queueEntries.joinedAt, dayStart)));
  const served = today.filter(entry => entry.status === "COMPLETED" && entry.servingAt && entry.completedAt);
  const recentEvents = await executor
    .select({ id: queueEvents.id, type: queueEvents.type, createdAt: queueEvents.createdAt, tokenNumber: queueEntries.tokenNumber, metadata: queueEvents.metadata, toStatus: queueEvents.toStatus })
    .from(queueEvents)
    .leftJoin(queueEntries, eq(queueEntries.id, queueEvents.queueEntryId))
    .where(eq(queueEvents.counterId, counter.id))
    .orderBy(desc(queueEvents.createdAt), desc(queueEvents.id))
    .limit(12);

  return {
    serverTime: now,
    counter: {
      id: counter.id,
      name: counter.name,
      tokenPrefix: counter.tokenPrefix,
      status: counter.status,
      statusReason: counter.statusReason,
      statusUpdatedAt: counter.statusUpdatedAt,
      mergedIntoCounterId: counter.mergedIntoCounterId,
    },
    group: {
      id: group.id,
      name: group.name,
      unitLabel: group.unitLabel,
      serveCapacity: group.serveCapacity,
      mergeStrategy: group.mergeStrategy,
      maxWaiting: group.maxWaiting,
    },
    service: { id: service.id, name: service.name, kind: service.kind },
    traffic: trafficView(group, params),
    camera: cameraView(params),
    // Name and college ID are shown only for tokens at the counter, so staff can verify the holder.
    inProgress: here
      .filter(item => item.entry.status === "CALLED" || item.entry.status === "SERVING")
      .map(item => ({
        id: item.entry.id,
        tokenNumber: item.entry.tokenNumber,
        status: item.entry.status,
        calledAt: item.entry.calledAt,
        servingAt: item.entry.servingAt,
        holderName: item.name,
        holderCollegeId: item.collegeId,
      })),
    waiting: waiting.map((entry, index) => ({
      id: entry.id,
      tokenNumber: entry.tokenNumber,
      position: index + 1,
      isPriority: entry.isPriority,
      priorityReason: entry.priorityReason,
      joinedAt: entry.joinedAt,
      estimatedWaitSeconds: estimateFor(group, params, index, elapsed).seconds,
      movedFrom: entry.originalCounterId !== entry.counterId ? (origins.get(entry.originalCounterId) ?? "another counter") : null,
    })),
    siblings: siblings
      .filter(s => s.id !== counter.id)
      .map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        mergedIntoCounterId: s.mergedIntoCounterId,
        waiting: active.filter(item => item.entry.counterId === s.id && item.entry.status === "WAITING").length,
      })),
    today: {
      joined: today.length,
      completed: today.filter(entry => entry.status === "COMPLETED").length,
      skipped: today.filter(entry => entry.status === "SKIPPED").length,
      cancelled: today.filter(entry => entry.status === "CANCELLED").length,
      averageServiceSeconds: served.length
        ? Math.round(served.reduce((sum, entry) => sum + (entry.completedAt!.getTime() - entry.servingAt!.getTime()) / 1000, 0) / served.length)
        : null,
    },
    recentEvents: recentEvents.map(event => ({ ...event, metadata: undefined, reason: (event.metadata as { reason?: string })?.reason ?? null })),
  };
}

export type CatalogView = Awaited<ReturnType<typeof catalogView>>;
export type MyActiveView = Awaited<ReturnType<typeof myActiveView>>;
export type StaffBoardView = NonNullable<Awaited<ReturnType<typeof staffBoardView>>>;
