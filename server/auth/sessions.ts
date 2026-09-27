import type { Request, Response } from "express";
import { parse as parseCookies } from "cookie";
import { and, eq, gt, lt } from "drizzle-orm";
import { SESSION_COOKIE, type AccountStatus, type Role } from "../../shared/domain";
import { sessions, users } from "../../drizzle/schema";
import { ENV, isProduction } from "../_core/env";
import { db, type Executor } from "../db/client";
import { digest, newSessionToken } from "./tokens";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
};

const TOUCH_INTERVAL_MS = 5 * 60_000;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // Lax blocks cross-site POSTs (CSRF) while allowing top-level navigation back to the app.
    sameSite: "lax" as const,
    secure: isProduction,
    path: "/",
  };
}

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const token = parseCookies(header)[SESSION_COOKIE];
  return token && token.length <= 128 ? token : undefined;
}

export async function createSession(userId: number, req: Request, res: Response) {
  const token = newSessionToken();
  const ttlMs = ENV.SESSION_TTL_HOURS * 3_600_000;
  await db.insert(sessions).values({
    id: digest(token),
    userId,
    expiresAt: new Date(Date.now() + ttlMs),
    userAgent: (req.headers["user-agent"] ?? "").slice(0, 255) || null,
    ipAddress: (req.ip ?? "").slice(0, 64) || null,
  });
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(), maxAge: ttlMs });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

/** Resolves the cookie to an ACTIVE user. Expired or revoked sessions resolve to null. */
export async function resolveSession(token: string | undefined): Promise<{ sessionId: string; user: SessionUser } | null> {
  if (!token) return null;
  const sessionId = digest(token);
  const now = new Date();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || row.status !== "ACTIVE") return null;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, sessionId));
  }
  return {
    sessionId,
    user: { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status },
  };
}

export async function revokeSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(executor: Executor, userId: number) {
  await executor.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
