import { desc, eq, max } from "drizzle-orm";
import { cameraStations, counters, queueEntries, queueEvents, queueMetrics, services } from "../drizzle/schema";
import { getDb } from "./db";

export type QueueEventType = "JOINED" | "CALLED" | "SERVING" | "COMPLETED" | "SKIPPED" | "CANCELLED";

export async function getQueueBackendStatus() {
  const db = await getDb();
  return {
    api: "tRPC over /api/trpc",
    mode: db ? "database" as const : "demo-fallback" as const,
    storage: db ? "MySQL relational database" : "Browser local persistence",
    realtime: db ? "Supabase adapter ready" : "BroadcastChannel demo sync",
  };
}

export async function createPersistentQueueEntry(input: {
  serviceId: number;
  counterId: number;
  userId?: number;
}) {
  const db = await getDb();
  if (!db) return { persisted: false as const };

  const [service] = await db.select().from(services).where(eq(services.id, input.serviceId)).limit(1);
  if (!service) throw new Error("Service not found");

  const [latest] = await db
    .select({ sequenceNumber: max(queueEntries.sequenceNumber) })
    .from(queueEntries)
    .where(eq(queueEntries.counterId, input.counterId));
  const sequenceNumber = Number(latest?.sequenceNumber ?? 0) + 1;
  const tokenNumber = `${service.prefix}${String(sequenceNumber).padStart(3, "0")}`;

  const inserted = await db.insert(queueEntries).values({
    serviceId: input.serviceId,
    counterId: input.counterId,
    userId: input.userId,
    tokenNumber,
    sequenceNumber,
    status: "WAITING",
  }).$returningId();
  const queueEntryId = inserted[0]?.id;
  if (!queueEntryId) throw new Error("Queue entry could not be created");

  await db.insert(queueEvents).values({
    queueEntryId,
    eventType: "JOINED",
    actorUserId: input.userId,
    metadata: { source: "queue.join" },
  });

  return { persisted: true as const, queueEntryId, tokenNumber, sequenceNumber };
}

export async function recordPersistentQueueEvent(input: {
  queueEntryId: number;
  eventType: QueueEventType;
  actorUserId?: number;
  metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return { persisted: false as const };
  await db.insert(queueEvents).values({
    queueEntryId: input.queueEntryId,
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    metadata: input.metadata ?? {},
  });
  return { persisted: true as const };
}

export async function recordPersistentQueueMetric(input: {
  cameraStationId: number;
  peopleCount: number;
  estimatedWaitMinutes: number;
}) {
  const db = await getDb();
  if (!db) return { persisted: false as const };
  await db.insert(queueMetrics).values({
    cameraStationId: input.cameraStationId,
    peopleCount: Math.max(0, Math.round(input.peopleCount)),
    estimatedWaitMinutes: input.estimatedWaitMinutes.toFixed(2),
  });
  return { persisted: true as const };
}

export async function getLatestPersistentMetric(cameraStationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [metric] = await db.select().from(queueMetrics)
    .where(eq(queueMetrics.cameraStationId, cameraStationId))
    .orderBy(desc(queueMetrics.capturedAt))
    .limit(1);
  return metric;
}
