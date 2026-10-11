import { TRPCError } from "@trpc/server";
import type { AppErrorCode } from "../../shared/errors";

type TrpcCode = TRPCError["code"];

const DEFAULT_TRPC_CODE: Partial<Record<AppErrorCode, TrpcCode>> = {
  UNAUTHENTICATED: "UNAUTHORIZED",
  SESSION_EXPIRED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  ACCOUNT_INACTIVE: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION: "BAD_REQUEST",
  INVALID_CODE: "BAD_REQUEST",
  RATE_LIMITED: "TOO_MANY_REQUESTS",
  ACCOUNT_LOCKED: "TOO_MANY_REQUESTS",
  INVALID_TRANSITION: "CONFLICT",
  DUPLICATE_ACTIVE_TOKEN: "CONFLICT",
  TOO_MANY_ACTIVE_TOKENS: "CONFLICT",
  CONFLICT: "CONFLICT",
  QUEUE_FULL: "PRECONDITION_FAILED",
  SERVICE_UNAVAILABLE: "PRECONDITION_FAILED",
  COUNTER_UNAVAILABLE: "PRECONDITION_FAILED",
  INTERNAL: "INTERNAL_SERVER_ERROR",
};

export class AppError extends TRPCError {
  readonly appCode: AppErrorCode;
  constructor(appCode: AppErrorCode, message: string) {
    super({ code: DEFAULT_TRPC_CODE[appCode] ?? "BAD_REQUEST", message });
    this.appCode = appCode;
  }
}

/** Throw a user-safe, actionable error. The message is shown to the user verbatim. */
export function fail(appCode: AppErrorCode, message: string): never {
  throw new AppError(appCode, message);
}
