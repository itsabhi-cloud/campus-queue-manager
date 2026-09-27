/** Camera stations report aggregate people counts only. No frames, faces or identities reach the server. */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { cameraMetrics, cameraStations, counters, queueGroups, services, staffCounterAssignments } from "../drizzle/schema";
import type { SessionUser } from "./auth/sessions";
import { fail } from "./_core/errors";
import { logger } from "./_core/logger";
import { limiters } from "./_core/rateLimit";
import { db } from "./db/client";
import { getSettings } from "./lib/settings";
import { assertGroupAccess } from "./queue/access";
import { recalculateGroups } from "./queue/engine";
import { effectiveTraffic, trafficFromCount } from "./queue/estimation";
import { broker } from "./realtime/broker";

const METRIC_INTERVAL_MS = 15_000;

export async function listStations(user: SessionUser) {
  let groupFilter: number[] | null = null;
  if (user.role === "STAFF") {
    const rows = await db
      .selectDistinct({ queueGroupId: counters.queueGroupId })
      .from(staffCounterAssignments)
      .innerJoin(counters, eq(counters.id, staffCounterAssignments.counterId))
      .where(eq(staffCounterAssignments.staffUserId, user.id));
    groupFilter = rows.map(row => row.queueGroupId);
    if (groupFilter.length === 0) return { stations: [], staleSeconds: (await getSettings()).cameraStaleSeconds };
  }
  const stations = await db
    .select({ station: cameraStations, groupName: queueGroups.name, serviceName: services.name, cameraAssist: queueGroups.cameraAssist, moderateAt: queueGroups.cameraModerateAt, heavyAt: queueGroups.cameraHeavyAt })
    .from(cameraStations)
    .innerJoin(queueGroups, eq(queueGroups.id, cameraStations.queueGroupId))
    .innerJoin(services, eq(services.id, queueGroups.serviceId))
    .where(groupFilter ? inArray(cameraStations.queueGroupId, groupFilter) : undefined)
    .orderBy(asc(cameraStations.name));
  return { stations, staleSeconds: (await getSettings()).cameraStaleSeconds };
}

export async function reportCount(user: SessionUser, input: { stationId: number; peopleCount: number; rawDetections: number }) {
  if (limiters.cameraByStation.consume(`station:${input.stationId}`) > 0) fail("RATE_LIMITED", "Camera reports are arriving too quickly.");
  const [row] = await db
    .select({ station: cameraStations, group: queueGroups })
    .from(cameraStations)
    .innerJoin(queueGroups, eq(queueGroups.id, cameraStations.queueGroupId))
    .where(eq(cameraStations.id, input.stationId))
    .limit(1);
  if (!row || !row.station.isActive) fail("NOT_FOUND", "Camera station not found or inactive.");
  await assertGroupAccess(db, user, row.group.id);

  const now = new Date();
  const { cameraStaleSeconds } = await getSettings();
  const { station, group } = row;
  const level = trafficFromCount(input.peopleCount, group.cameraModerateAt, group.cameraHeavyAt);
  const previousFresh = station.lastReportedAt && now.getTime() - station.lastReportedAt.getTime() <= cameraStaleSeconds * 1000;
  const previousLevel = previousFresh && station.lastPeopleCount !== null ? trafficFromCount(station.lastPeopleCount, group.cameraModerateAt, group.cameraHeavyAt) : null;

  await db.update(cameraStations).set({ lastReportedAt: now, lastPeopleCount: input.peopleCount }).where(eq(cameraStations.id, station.id));
  const [lastMetric] = await db
    .select({ capturedAt: cameraMetrics.capturedAt, trafficLevel: cameraMetrics.trafficLevel })
    .from(cameraMetrics)
    .where(eq(cameraMetrics.cameraStationId, station.id))
    .orderBy(desc(cameraMetrics.capturedAt))
    .limit(1);
  if (!lastMetric || now.getTime() - lastMetric.capturedAt.getTime() >= METRIC_INTERVAL_MS || lastMetric.trafficLevel !== level) {
    await db.insert(cameraMetrics).values({ cameraStationId: station.id, peopleCount: input.peopleCount, rawDetections: input.rawDetections, trafficLevel: level, capturedAt: now });
  }
  broker.publish({ kind: "all" }, { type: "camera.updated", stationId: station.id, queueGroupId: group.id });

  // Camera congestion can only raise the effective traffic level, and only for camera-assisted queues.
  if (group.cameraAssist && effectiveTraffic(group.trafficLevel, previousLevel) !== effectiveTraffic(group.trafficLevel, level)) {
    recalculateGroups([group.id], { up: "due to crowding detected near the counter", down: "as crowding near the counter eased" }).catch(error =>
      logger.warn("Camera-driven recalculation failed", { error })
    );
  }
  return { trafficLevel: level };
}

export async function stationHistory(user: SessionUser, stationId: number, minutes: number) {
  const [station] = await db.select().from(cameraStations).where(eq(cameraStations.id, stationId)).limit(1);
  if (!station) fail("NOT_FOUND", "Camera station not found.");
  await assertGroupAccess(db, user, station.queueGroupId);
  return db
    .select({ peopleCount: cameraMetrics.peopleCount, trafficLevel: cameraMetrics.trafficLevel, capturedAt: cameraMetrics.capturedAt })
    .from(cameraMetrics)
    .where(and(eq(cameraMetrics.cameraStationId, stationId), gte(cameraMetrics.capturedAt, new Date(Date.now() - minutes * 60_000))))
    .orderBy(asc(cameraMetrics.capturedAt))
    .limit(500);
}
