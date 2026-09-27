import { z } from "zod";
import { activate, changePassword, emailSchema, login, passwordSchema, publicUser } from "../accounts";
import { clearSessionCookie, revokeSession } from "../auth/sessions";
import { authedProcedure, publicProcedure, router } from "../_core/trpc";

export const authRouter = router({
  /** Current user, or null. Never throws, so the client can render public pages. */
  me: publicProcedure.query(({ ctx }) => (ctx.user ? publicUser(ctx.user) : null)),

  login: publicProcedure
    .input(z.object({ email: emailSchema, password: z.string().min(1, "Enter your password.").max(128) }))
    .mutation(({ ctx, input }) => login(input, ctx.req, ctx.res)),

  activate: publicProcedure
    .input(z.object({ email: emailSchema, code: z.string().trim().min(8).max(20), password: passwordSchema }))
    .mutation(({ ctx, input }) => activate(input, ctx.req, ctx.res)),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.sessionId) await revokeSession(ctx.sessionId);
    clearSessionCookie(ctx.res);
    return { success: true } as const;
  }),

  changePassword: authedProcedure
    .input(z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }))
    .mutation(({ ctx, input }) => changePassword(ctx.user, ctx.sessionId, input, ctx.ip)),
});
