import { TRPCClientError } from "@trpc/client";
import type { AppErrorCode } from "@shared/errors";

export function appCodeOf(error: unknown): AppErrorCode | undefined {
  if (error instanceof TRPCClientError)
    return (error.data as { appCode?: AppErrorCode } | undefined)?.appCode;
  return undefined;
}

/** Messages from the API are written for users; anything else becomes a generic, safe message. */
export function errorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (error instanceof TRPCClientError) {
    if (!error.data && /fetch|network/i.test(error.message))
      return "You appear to be offline. Check your connection and try again.";
    return error.message || fallback;
  }
  return fallback;
}

export function isAuthError(error: unknown) {
  const code = appCodeOf(error);
  return code === "UNAUTHENTICATED" || code === "SESSION_EXPIRED";
}
