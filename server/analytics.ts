/** Operational analytics for administrators. All numbers come from recorded queue data. */
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { auditLogs, cameraStations, counters, queueEntries, queueGroups, services, users } from "../drizzle/schema";
import { db } from "./db/client";
import { getSettings } from "./lib/settings";
import { campusDate, campusHour, startOfCampusDay } from "./lib/time";
import { broker } from "./realtime/broker";

export async function overview(now = new Date()) {
  const dayStart = startOfCampusDay(now);
  const weekStartDate = campusDate(new Date(now.getTime() - 6 * 86_400_000));

  const userCounts = await db.select({ role: users.role, status: users.status, n: count() }).from(users).groupBy(users.role, users.status);
  const counterRows = await db.select({ id: counters.id, status: counters.status, queueGroupId: counters.queueGroupId }).from(counters).where(eq(counters.isActive, true));
  const groupRows = await db.select({ id: queueGroups.id, serviceId: queueGroups.serviceId }).from(queueGroups);
  const serviceRows = await db.select({ id: services.id, name: services.name, kind: services.kind }).from(services).where(eq(services.isActive, true));
  const live = await db
    .select({ serviceId: queueEntries.serviceId, counterId: queueEntries.counterId, status: queueEntries.status, n: count() })
    .from(queueEntries)
    .where(inArray(queueEntries.status, ["WAITING", "CALLED", "SERVING"]))
    .groupBy(queueEntries.serviceId, queueEntries.counterId, queueEntries.status);
  const today = await db
    .select({
      serviceId: queueEntries.serviceId,
      status: queueEntries.status,
      joinedAt: queueEntries.joinedAt,
      calledAt: queueEntries.calledAt,
      servingAt: queueEntries.servingAt,
      completedAt: queueEntries.completedAt,
      isPriority: queueEntries.isPriority,
    })
    .from(queueEntries)
    .where(gte(queueEntries.joinedAt, dayStart));
  const weekly = await db
    .select({ queueDate: queueEntries.queueDate, status: queueEntries.status, n: count() })
    .from(queueEntries)
    .where(gte(queueEntries.queueDate, weekStartDate))
    .groupBy(queueEntries.queueDate, queueEntries.status);
  const { cameraStaleSeconds } = await getSettings();
  const stations = await db.select({ id: cameraStations.id, name: cameraStations.name, lastReportedAt: cameraStations.lastReportedAt, lastPeopleCount: cameraStations.lastPeopleCount, isActive: cameraStations.isActive }).from(cameraStations);

  const sumUsers = (role: string, status?: string) => userCounts.filter(u => u.role === role && (!status || u.status === status)).reduce((s, u) => s + u.n, 0);
  const waitSeconds = (rows: typeof today) => {
    const called = rows.filter(r => r.calledAt);
    return called.length ? Math.round(called.reduce((s, r) => s + (r.calledAt!.getTime() - r.joinedAt.getTime()) / 1000, 0) / called.length) : null;
  };
  const serviceSeconds = (rows: typeof today) => {
    const done = rows.filter(r => r.status === "COMPLETED" && r.servingAt && r.completedAt);
    return done.length ? Math.round(done.reduce((s, r) => s + (r.completedAt!.getTime() - r.servingAt!.getTime()) / 1000, 0) / done.length) : null;
  };

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, joined: 0, completed: 0 }));
  today.forEach(row => {
    hours[campusHour(row.joinedAt)].joined += 1;
    if (row.completedAt && row.completedAt >= dayStart) hours[campusHour(row.completedAt)].completed += 1;
  });
  const firstActive = hours.findIndex(h => h.joined || h.completed);
  const lastActive = 23 - [...hours].reverse().findIndex(h => h.joined || h.completed);
  const currentHour = campusHour(now);
  const hourly = firstActive === -1 ? hours.slice(Math.max(0, currentHour - 7), currentHour + 1) : hours.slice(Math.min(firstActive, currentHour), Math.max(lastActive, currentHour) + 1);

  const days = Array.from({ length: 7 }, (_, i) => campusDate(new Date(now.getTime() - (6 - i) * 86_400_000)));
  const volume = days.map(day => {
    const rows = weekly.filter(w => String(w.queueDate) === day);
    const get = (status: string) => rows.filter(r => r.status === status).reduce((s, r) => s + r.n, 0);
    return { day, joined: rows.reduce((s, r) => s + r.n, 0), completed: get("COMPLETED"), cancelled: get("CANCELLED"), skipped: get("SKIPPED") };
  });

  const byService = serviceRows.map(service => {
    const serviceCounters = counterRows.filter(c => groupRows.find(g => g.id === c.queueGroupId)?.serviceId === service.id);
    const liveRows = live.filter(l => l.serviceId === service.id);
    const rows = today.filter(r => r.serviceId === service.id);
    const open = serviceCounters.filter(c => c.status === "OPEN");
    const busy = new Set(liveRows.filter(l => l.status === "CALLED" || l.status === "SERVING").map(l => l.counterId));
    return {
      id: service.id,
      name: service.name,
      kind: service.kind,
      waiting: liveRows.filter(l => l.status === "WAITING").reduce((s, l) => s + l.n, 0),
      inService: liveRows.filter(l => l.status !== "WAITING").reduce((s, l) => s + l.n, 0),
      openCounters: open.length,
      totalCounters: serviceCounters.length,
      busyCounters: open.filter(c => busy.has(c.id)).length,
      joinedToday: rows.length,
      completedToday: rows.filter(r => r.status === "COMPLETED").length,
      cancelledToday: rows.filter(r => r.status === "CANCELLED").length,
      skippedToday: rows.filter(r => r.status === "SKIPPED").length,
      averageWaitSeconds: waitSeconds(rows),
      averageServiceSeconds: serviceSeconds(rows),
    };
  });

  return {
    generatedAt: now,
    people: {
      students: sumUsers("STUDENT"),
      activeStudents: sumUsers("STUDENT", "ACTIVE"),
      pendingStudents: sumUsers("STUDENT", "PENDING"),
      staff: sumUsers("STAFF"),
      admins: sumUsers("ADMIN"),
    },
    live: {
      waiting: live.filter(l => l.status === "WAITING").reduce((s, l) => s + l.n, 0),
      inService: live.filter(l => l.status !== "WAITING").reduce((s, l) => s + l.n, 0),
      activeQueues: new Set(live.map(l => l.counterId)).size,
      countersOpen: counterRows.filter(c => c.status === "OPEN").length,
      countersPaused: counterRows.filter(c => c.status === "PAUSED").length,
      countersOffline: counterRows.filter(c => c.status === "OFFLINE").length,
      realtimeConnections: broker.connectionCount,
    },
    today: {
      joined: today.length,
      completed: today.filter(r => r.status === "COMPLETED").length,
      cancelled: today.filter(r => r.status === "CANCELLED").length,
      skipped: today.filter(r => r.status === "SKIPPED").length,
      priority: today.filter(r => r.isPriority).length,
      averageWaitSeconds: waitSeconds(today),
      averageServiceSeconds: serviceSeconds(today),
    },
    hourly,
    volume,
    byService,
    cameras: stations.map(s => ({
      ...s,
      fresh: Boolean(s.lastReportedAt && now.getTime() - s.lastReportedAt.getTime() <= cameraStaleSeconds * 1000),
    })),
  };
}

export async function listAuditLogs(input: { page: number; pageSize: number; action?: string; entityType?: string }) {
  const filters = [];
  if (input.action) filters.push(sql`${auditLogs.action} like ${`${input.action.replace(/[%_\\]/g, m => `\\${m}`)}%`}`);
  if (input.entityType) filters.push(eq(auditLogs.entityType, input.entityType));
  const where = filters.length ? and(...filters) : undefined;
  const rows = await db
    .select({ log: auditLogs, actorName: users.name, actorEmail: users.email, actorRole: users.role })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(auditLogs).where(where);
  return { total, rows };
}

