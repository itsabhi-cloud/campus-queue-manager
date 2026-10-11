import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { Role } from "../../shared/domain";
import type { AppErrorCode } from "../../shared/errors";
import type { TrpcContext } from "./context";
import { AppError, fail } from "./errors";
import { logger } from "./logger";
import { limiters } from "./rateLimit";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, path }) {
    const appCode: AppErrorCode =
      error instanceof AppError
        ? error.appCode
        : error.cause instanceof ZodError
          ? "VALIDATION"
          : error.code === "UNAUTHORIZED"
            ? "UNAUTHENTICATED"
            : error.code === "FORBIDDEN"
              ? "FORBIDDEN"
              : error.code === "NOT_FOUND"
                ? "NOT_FOUND"
                : error.code === "INTERNAL_SERVER_ERROR"
                  ? "INTERNAL"
                  : "VALIDATION";
    const isInternal = error.code === "INTERNAL_SERVER_ERROR";
    if (isInternal)
      logger.error("Unhandled API error", {
        path,
        error: error.cause ?? error,
      });
    const validation =
      error.cause instanceof ZodError
        ? error.cause.issues.map(issue => ({
            path: issue.path.join("."),
            message: issue.message,
          }))
        : undefined;
    return {
      ...shape,
      // Never leak SQL, stack traces or internal messages to clients.
      message: isInternal
        ? "Something went wrong on our side. Please try again."
        : validation
          ? (validation[0]?.message ?? "Invalid input.")
          : shape.message,
      data: {
        code: shape.data.code,
        httpStatus: shape.data.httpStatus,
        path: shape.data.path,
        appCode,
        validation,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    if (ctx.sessionExpired)
      fail(
        "SESSION_EXPIRED",
        "Your session has expired. Please sign in again."
      );
    fail("UNAUTHENTICATED", "Please sign in to continue.");
  }
  return next({
    ctx: { ...ctx, user: ctx.user, sessionId: ctx.sessionId as string },
  });
});

/** Per-user throttle on writes so a stuck client or script cannot hammer the queue engine. */
const throttleMutations = t.middleware(({ ctx, type, next }) => {
  if (type === "mutation" && ctx.user) {
    const waitMs = limiters.mutationsByUser.consume(`user:${ctx.user.id}`);
    if (waitMs > 0)
      fail(
        "RATE_LIMITED",
        "You're doing that too quickly. Please wait a moment."
      );
  }
  return next();
});

export const authedProcedure = t.procedure
  .use(requireUser)
  .use(throttleMutations);

function requireRole(...roles: Role[]) {
  return t.middleware(({ ctx, next }) => {
    if (!ctx.user || !roles.includes(ctx.user.role))
      fail("FORBIDDEN", "You don't have permission to do that.");
    return next();
  });
}

export const studentProcedure = authedProcedure.use(requireRole("STUDENT"));
/** Staff and admins. Counter-level scope is enforced per call by `assertCounterAccess`. */
export const staffProcedure = authedProcedure.use(
  requireRole("STAFF", "ADMIN")
);
export const adminProcedure = authedProcedure.use(requireRole("ADMIN"));

/**
 * For actions a shared demo account must not perform (they would break the demo for every other
 * visitor or hand someone a private account). Use after an authenticated procedure.
 */
export const notForDemo = t.middleware(({ ctx, next }) => {
  if (ctx.user?.isDemo)
    fail(
      "FORBIDDEN",
      "That's turned off in the demo so it keeps working for everyone."
    );
  return next();
});
