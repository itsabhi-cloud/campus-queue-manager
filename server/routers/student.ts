import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { counters, notifications, queueEntries, queueEvents, queueGroups, services } from "../../drizzle/schema";
import { avatarSchema, getProfile, profileUpdateSchema, setAvatar, updateProfile } from "../accounts";
import { fail } from "../_core/errors";
import { authedProcedure, router, studentProcedure } from "../_core/trpc";
import { db } from "../db/client";
import { cancelOwnEntry, joinQueue } from "../queue/engine";
import { catalogView, myActiveView } from "../queue/views";

const id = z.number().int().positive();

export const catalogRouter = router({
  /** Services → queue groups → counters with live aggregate numbers. */
  list: authedProcedure.query(() => catalogView(db)),
});

export const queueRouter = router({
  join: studentProcedure
    .input(z.object({ queueGroupId: id, counterId: id.optional() }))
    .mutation(({ ctx, input }) => joinQueue(ctx.user, input)),

  cancel: studentProcedure.input(z.object({ entryId: id })).mutation(({ ctx, input }) => cancelOwnEntry(ctx.user, input.entryId)),

  myActive: studentProcedure.query(({ ctx }) => myActiveView(db, ctx.user.id)),

  /** One of the student's own tokens (active or past) with its timeline. */
  entry: studentProcedure.input(z.object({ entryId: id })).query(async ({ ctx, input }) => {
    const [row] = await db
      .select({ entry: queueEntries, counterName: counters.name, groupName: queueGroups.name, serviceName: services.name, serviceKind: services.kind })
      .from(queueEntries)
      .innerJoin(counters, eq(counters.id, queueEntries.counterId))
      .innerJoin(queueGroups, eq(queueGroups.id, queueEntries.queueGroupId))
      .innerJoin(services, eq(services.id, queueEntries.serviceId))
      .where(and(eq(queueEntries.id, input.entryId), eq(queueEntries.userId, ctx.user.id)))
      .limit(1);
    if (!row) fail("NOT_FOUND", "That token doesn't exist.");
    const timeline = await db
      .select({ id: queueEvents.id, type: queueEvents.type, toStatus: queueEvents.toStatus, createdAt: queueEvents.createdAt })
      .from(queueEvents)
      .where(eq(queueEvents.queueEntryId, row.entry.id))
      .orderBy(queueEvents.createdAt, queueEvents.id);
    const { entry } = row;
    return {
      id: entry.id,
      tokenNumber: entry.tokenNumber,
      status: entry.status,
      joinedAt: entry.joinedAt,
      calledAt: entry.calledAt,
      servingAt: entry.servingAt,
      completedAt: entry.completedAt,
      cancelledAt: entry.cancelledAt,
      skippedAt: entry.skippedAt,
      closedReason: entry.closedReason,
      isPriority: entry.isPriority,
      counterName: row.counterName,
      groupName: row.groupName,
      serviceName: row.serviceName,
      serviceKind: row.serviceKind,
      timeline,
    };
  }),

  history: studentProcedure
    .input(z.object({ cursor: id.optional(), limit: z.number().int().min(5).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({
          id: queueEntries.id,
          tokenNumber: queueEntries.tokenNumber,
          status: queueEntries.status,
          joinedAt: queueEntries.joinedAt,
          calledAt: queueEntries.calledAt,
          completedAt: queueEntries.completedAt,
          cancelledAt: queueEntries.cancelledAt,
          skippedAt: queueEntries.skippedAt,
          closedReason: queueEntries.closedReason,
          counterName: counters.name,
          groupName: queueGroups.name,
          serviceName: services.name,
          serviceKind: services.kind,
        })
        .from(queueEntries)
        .innerJoin(counters, eq(counters.id, queueEntries.counterId))
        .innerJoin(queueGroups, eq(queueGroups.id, queueEntries.queueGroupId))
        .innerJoin(services, eq(services.id, queueEntries.serviceId))
        .where(and(eq(queueEntries.userId, ctx.user.id), inArray(queueEntries.status, ["COMPLETED", "SKIPPED", "CANCELLED"]), input.cursor ? lt(queueEntries.id, input.cursor) : undefined))
        .orderBy(desc(queueEntries.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit);
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    }),
});

export const notificationsRouter = router({
  list: authedProcedure
    .input(z.object({ cursor: id.optional(), limit: z.number().int().min(5).max(50).default(20), unreadOnly: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.userId, ctx.user.id), input.unreadOnly ? isNull(notifications.readAt) : undefined, input.cursor ? lt(notifications.id, input.cursor) : undefined))
        .orderBy(desc(notifications.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = rows.slice(0, input.limit);
      return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    }),

  unreadCount: authedProcedure.query(async ({ ctx }) => {
    const [{ n }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { count: n };
  }),

  markRead: authedProcedure.input(z.object({ ids: z.array(id).min(1).max(100) })).mutation(async ({ ctx, input }) => {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.user.id), inArray(notifications.id, input.ids), isNull(notifications.readAt)));
    return { ok: true as const };
  }),

  markAllRead: authedProcedure.mutation(async ({ ctx }) => {
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.user.id), isNull(notifications.readAt)));
    return { ok: true as const };
  }),
});

export const profileRouter = router({
  get: authedProcedure.query(({ ctx }) => getProfile(ctx.user.id)),
  update: authedProcedure.input(profileUpdateSchema).mutation(({ ctx, input }) => updateProfile(ctx.user, input)),
  setAvatar: authedProcedure.input(z.object({ dataUrl: avatarSchema.nullable() })).mutation(({ ctx, input }) => setAvatar(ctx.user.id, input.dataUrl)),
});
