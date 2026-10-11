import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MERGE_STRATEGIES, TRAFFIC_LEVELS } from "../../shared/domain";
import { counters, queueGroups, services } from "../../drizzle/schema";
import { listStations, reportCount, stationHistory } from "../camera";
import { fail } from "../_core/errors";
import { router, staffProcedure } from "../_core/trpc";
import { db } from "../db/client";
import { assertCounterAccess, operableCounterIds } from "../queue/access";
import {
  actOnEntries,
  callNext,
  mergeCounters,
  setCounterStatus,
  setPriority,
  setTraffic,
} from "../queue/engine";
import { staffBoardView } from "../queue/views";

const id = z.number().int().positive();
const reason = z.string().trim().max(200);

export const staffRouter = router({
  /** Counters this user may operate (admins: all), grouped for a picker. */
  myCounters: staffProcedure.query(async ({ ctx }) => {
    const allowed = await operableCounterIds(db, ctx.user);
    if (allowed && allowed.length === 0) return [];
    return db
      .select({
        id: counters.id,
        name: counters.name,
        status: counters.status,
        tokenPrefix: counters.tokenPrefix,
        isActive: counters.isActive,
        groupId: queueGroups.id,
        groupName: queueGroups.name,
        serviceName: services.name,
        serviceKind: services.kind,
      })
      .from(counters)
      .innerJoin(queueGroups, eq(queueGroups.id, counters.queueGroupId))
      .innerJoin(services, eq(services.id, queueGroups.serviceId))
      .where(
        allowed ? inArray(counters.id, allowed) : eq(counters.isActive, true)
      )
      .orderBy(
        asc(services.displayOrder),
        asc(queueGroups.displayOrder),
        asc(counters.displayOrder),
        asc(counters.id)
      );
  }),

  board: staffProcedure
    .input(z.object({ counterId: id }))
    .query(async ({ ctx, input }) => {
      await assertCounterAccess(db, ctx.user, input.counterId);
      const board = await staffBoardView(db, input.counterId);
      if (!board) fail("NOT_FOUND", "Counter not found.");
      return board;
    }),

  callNext: staffProcedure
    .input(z.object({ counterId: id }))
    .mutation(({ ctx, input }) => callNext(ctx.user, input.counterId)),

  serve: staffProcedure
    .input(z.object({ entryIds: z.array(id).min(1).max(50) }))
    .mutation(({ ctx, input }) =>
      actOnEntries(ctx.user, { ...input, action: "SERVE" }, ctx)
    ),
  complete: staffProcedure
    .input(z.object({ entryIds: z.array(id).min(1).max(50) }))
    .mutation(({ ctx, input }) =>
      actOnEntries(ctx.user, { ...input, action: "COMPLETE" }, ctx)
    ),
  skip: staffProcedure
    .input(
      z.object({
        entryIds: z.array(id).min(1).max(50),
        reason: reason.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      actOnEntries(ctx.user, { ...input, action: "SKIP" }, ctx)
    ),
  cancel: staffProcedure
    .input(
      z.object({
        entryIds: z.array(id).min(1).max(50),
        reason: reason.min(3, "Please give a reason."),
      })
    )
    .mutation(({ ctx, input }) =>
      actOnEntries(ctx.user, { ...input, action: "CANCEL" }, ctx)
    ),

  setCounterStatus: staffProcedure
    .input(
      z.object({
        counterId: id,
        status: z.enum(["OPEN", "PAUSED", "OFFLINE"]),
        reason: reason.optional(),
        mergeIntoCounterId: id.optional(),
        strategy: z.enum(MERGE_STRATEGIES).optional(),
      })
    )
    .mutation(({ ctx, input }) => setCounterStatus(ctx.user, input, ctx)),

  merge: staffProcedure
    .input(
      z.object({
        sourceCounterId: id,
        targetCounterId: id,
        strategy: z.enum(MERGE_STRATEGIES).optional(),
        reason: reason.min(3, "Please give a reason."),
      })
    )
    .mutation(({ ctx, input }) => mergeCounters(ctx.user, input, ctx)),

  setTraffic: staffProcedure
    .input(
      z.object({
        queueGroupId: id,
        level: z.enum(TRAFFIC_LEVELS),
        delaySeconds: z.number().int().min(0).max(3600),
        reason: reason.optional(),
      })
    )
    .mutation(({ ctx, input }) => setTraffic(ctx.user, input, ctx)),

  setPriority: staffProcedure
    .input(
      z.object({
        entryId: id,
        enabled: z.boolean(),
        reason: reason.min(3, "A reason is required for priority changes."),
      })
    )
    .mutation(({ ctx, input }) => setPriority(ctx.user, input, ctx)),
});

export const cameraRouter = router({
  stations: staffProcedure.query(({ ctx }) => listStations(ctx.user)),
  report: staffProcedure
    .input(
      z.object({
        stationId: id,
        peopleCount: z.number().int().min(0).max(500),
        rawDetections: z.number().int().min(0).max(500),
      })
    )
    .mutation(({ ctx, input }) => reportCount(ctx.user, input)),
  history: staffProcedure
    .input(
      z.object({
        stationId: id,
        minutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .default(60),
      })
    )
    .query(({ ctx, input }) =>
      stationHistory(ctx.user, input.stationId, input.minutes)
    ),
});
