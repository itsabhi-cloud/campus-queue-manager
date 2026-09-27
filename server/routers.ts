import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  createPersistentQueueEntry,
  getQueueBackendStatus,
  recordPersistentQueueEvent,
  recordPersistentQueueMetric,
} from "./queueDb";

const queueEventTypes = ["JOINED", "CALLED", "SERVING", "COMPLETED", "SKIPPED", "CANCELLED"] as const;

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  queue: router({
    /** Backend readiness is shown in the UI so judges can see which persistence mode is active. */
    status: publicProcedure.query(() => getQueueBackendStatus()),
    /** Creates a persistent token when the relational database is configured. */
    join: publicProcedure.input(z.object({
      serviceId: z.number().int().positive(),
      counterId: z.number().int().positive(),
      userId: z.number().int().positive().optional(),
    })).mutation(({ input }) => createPersistentQueueEntry(input)),
    /** Records an auditable queue transition for realtime/history adapters. */
    event: publicProcedure.input(z.object({
      queueEntryId: z.number().int().positive(),
      eventType: z.enum(queueEventTypes),
      actorUserId: z.number().int().positive().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })).mutation(({ input }) => recordPersistentQueueEvent(input)),
    /** Persists only aggregate camera metrics, never video or identity data. */
    metric: publicProcedure.input(z.object({
      cameraStationId: z.number().int().positive(),
      peopleCount: z.number().int().min(0),
      estimatedWaitMinutes: z.number().min(0),
    })).mutation(({ input }) => recordPersistentQueueMetric(input)),
  }),
});

export type AppRouter = typeof appRouter;
