import { z } from "zod";
import {
  commitStudentImport,
  createUser,
  createUserInput,
  issueAccessCode,
  listUsers,
  previewStudentImport,
  setUserRole,
  setUserStatus,
  updateUser,
  updateUserInput,
  userListInput,
} from "../accounts";
import { listAuditLogs, overview } from "../analytics";
import {
  adminCatalog,
  counterInput,
  groupInput,
  serviceInput,
  setStaffAssignments,
  stationInput,
  upsertCounter,
  upsertGroup,
  upsertService,
  upsertStation,
} from "../catalogAdmin";
import { adminProcedure, notForDemo, router } from "../_core/trpc";

/** Admin actions a shared demo admin may not take: they lock visitors out or break the demo. */
const nonDemoAdminProcedure = adminProcedure.use(notForDemo);
import { db } from "../db/client";
import { audit } from "../lib/audit";
import { getSettings, saveSettings, settingsSchema } from "../lib/settings";

const id = z.number().int().positive();
const csvText = z
  .string()
  .min(1)
  .max(2_000_000, "File is too large (2 MB max).");

export const adminRouter = router({
  overview: adminProcedure.query(() => overview()),

  users: router({
    list: adminProcedure
      .input(userListInput)
      .query(({ input }) => listUsers(input)),
    create: adminProcedure
      .input(createUserInput)
      .mutation(({ ctx, input }) => createUser(ctx.user, input, ctx.ip)),
    update: adminProcedure
      .input(updateUserInput)
      .mutation(({ ctx, input }) => updateUser(ctx.user, input, ctx.ip)),
    setStatus: nonDemoAdminProcedure
      .input(
        z.object({
          userId: id,
          status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]),
          reason: z.string().trim().min(3).max(200),
        })
      )
      .mutation(({ ctx, input }) => setUserStatus(ctx.user, input, ctx.ip)),
    setRole: nonDemoAdminProcedure
      .input(z.object({ userId: id, role: z.enum(["STAFF", "ADMIN"]) }))
      .mutation(({ ctx, input }) => setUserRole(ctx.user, input, ctx.ip)),
    issueCode: nonDemoAdminProcedure
      .input(z.object({ userId: id }))
      .mutation(({ ctx, input }) =>
        issueAccessCode(ctx.user, input.userId, ctx.ip)
      ),
    previewImport: adminProcedure
      .input(z.object({ csv: csvText }))
      .mutation(({ input }) => previewStudentImport(input.csv)),
    commitImport: nonDemoAdminProcedure
      .input(z.object({ csv: csvText }))
      .mutation(({ ctx, input }) =>
        commitStudentImport(ctx.user, input.csv, ctx.ip)
      ),
  }),

  catalog: router({
    get: adminProcedure.query(() => adminCatalog()),
    upsertService: adminProcedure
      .input(serviceInput)
      .mutation(({ ctx, input }) => upsertService(ctx.user, input, ctx.ip)),
    upsertGroup: adminProcedure
      .input(groupInput)
      .mutation(({ ctx, input }) => upsertGroup(ctx.user, input, ctx.ip)),
    upsertCounter: adminProcedure
      .input(counterInput)
      .mutation(({ ctx, input }) => upsertCounter(ctx.user, input, ctx.ip)),
    setAssignments: adminProcedure
      .input(z.object({ staffUserId: id, counterIds: z.array(id).max(100) }))
      .mutation(({ ctx, input }) =>
        setStaffAssignments(ctx.user, input, ctx.ip)
      ),
    upsertStation: adminProcedure
      .input(stationInput)
      .mutation(({ ctx, input }) => upsertStation(ctx.user, input, ctx.ip)),
  }),

  audit: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(10).max(100).default(30),
        action: z.string().trim().max(64).optional(),
        entityType: z.string().trim().max(40).optional(),
      })
    )
    .query(({ input }) => listAuditLogs(input)),

  settings: router({
    get: adminProcedure.query(() => getSettings()),
    update: nonDemoAdminProcedure
      .input(settingsSchema)
      .mutation(async ({ ctx, input }) => {
        const before = await getSettings();
        await db.transaction(async tx => {
          await saveSettings(tx, input, ctx.user.id);
          await audit(tx, {
            actorUserId: ctx.user.id,
            action: "settings.updated",
            entityType: "settings",
            metadata: { before, after: input },
            ip: ctx.ip,
          });
        });
        return getSettings();
      }),
  }),
});
