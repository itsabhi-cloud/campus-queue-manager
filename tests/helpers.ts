import { describe } from "vitest";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import {
  counters,
  queueGroups,
  services,
  staffCounterAssignments,
  staffProfiles,
  studentProfiles,
  users,
} from "../drizzle/schema";
import { SESSION_COOKIE, type Role } from "../shared/domain";
import { hashPassword } from "../server/auth/password";
import { resolveSession, type SessionUser } from "../server/auth/sessions";
import type { TrpcContext } from "../server/_core/context";
import { limiters } from "../server/_core/rateLimit";
import { db } from "../server/db/client";
import { truncateAll } from "../server/db/reset";
import { invalidateSettingsCache } from "../server/lib/settings";
import { createCallerFactory } from "../server/_core/trpc";
import { appRouter } from "../server/routers";

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
export const describeDb = hasDatabase ? describe : describe.skip;

export const TEST_PASSWORD = "Correct-horse-42";
let cachedHash: string | null = null;

export async function resetDatabase() {
  await truncateAll();
  invalidateSettingsCache();
  Object.values(limiters).forEach(limiter => limiter.clear());
}

let sequence = 0;
export async function createUser(role: Role, overrides: Partial<typeof users.$inferInsert> & { collegeId?: string } = {}): Promise<SessionUser> {
  const n = ++sequence;
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  const email = overrides.email ?? `${role.toLowerCase()}${n}@test.edu`;
  const { collegeId, ...rest } = overrides;
  const [row] = await db
    .insert(users)
    .values({ email, name: `${role} ${n}`, role, status: "ACTIVE", passwordHash: cachedHash, ...rest })
    .$returningId();
  if (role === "STUDENT") await db.insert(studentProfiles).values({ userId: row.id, collegeId: collegeId ?? `T${String(n).padStart(6, "0")}` });
  else await db.insert(staffProfiles).values({ userId: row.id });
  const [user] = await db.select().from(users).where(eq(users.id, row.id));
  return { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status };
}

export async function createQueue(options: { counters?: string[]; averageServiceSeconds?: number; serveCapacity?: number; maxWaiting?: number; cameraAssist?: boolean } = {}) {
  sequence += 1;
  const [service] = await db.insert(services).values({ slug: `svc-${sequence}`, name: `Service ${sequence}`, description: "Test service", kind: "PRINTING" }).$returningId();
  const [group] = await db
    .insert(queueGroups)
    .values({
      serviceId: service.id,
      slug: `grp-${sequence}`,
      name: `Group ${sequence}`,
      averageServiceSeconds: options.averageServiceSeconds ?? 120,
      serveCapacity: options.serveCapacity ?? 1,
      maxWaiting: options.maxWaiting ?? 200,
      cameraAssist: options.cameraAssist ?? false,
    })
    .$returningId();
  const counterIds: number[] = [];
  for (const [index, prefix] of (options.counters ?? [`Q${sequence}`]).entries()) {
    const [counter] = await db.insert(counters).values({ queueGroupId: group.id, name: `Counter ${prefix}`, tokenPrefix: prefix, displayOrder: index }).$returningId();
    counterIds.push(counter.id);
  }
  return { serviceId: service.id, groupId: group.id, counterIds };
}

export async function assign(staff: SessionUser, counterId: number) {
  await db.insert(staffCounterAssignments).values({ staffUserId: staff.id, counterId });
}

export function fakeHttp(cookieHeader?: string) {
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const cleared: string[] = [];
  const req = { headers: { cookie: cookieHeader, "user-agent": "vitest" }, ip: "127.0.0.1", protocol: "http" } as unknown as Request;
  const res = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => cookies.push({ name, value, options }),
    clearCookie: (name: string) => cleared.push(name),
  } as unknown as Response;
  return { req, res, cookies, cleared };
}

const createCaller = createCallerFactory(appRouter);

/** A tRPC caller acting as `user` (no real session needed for procedure-level tests). */
export function callerFor(user: SessionUser | null) {
  const { req, res } = fakeHttp();
  const ctx: TrpcContext = { req, res, user, sessionId: user ? "test-session" : null, sessionExpired: false, ip: "127.0.0.1" };
  return createCaller(ctx);
}

/** A caller whose identity comes from a real session cookie, exercising session resolution. */
export async function callerFromCookie(token: string) {
  const { req, res } = fakeHttp(`${SESSION_COOKIE}=${token}`);
  const session = await resolveSession(token);
  return createCaller({ req, res, user: session?.user ?? null, sessionId: session?.sessionId ?? null, sessionExpired: !session, ip: "127.0.0.1" });
}

export function anonymousCaller() {
  const http = fakeHttp();
  return { caller: createCaller({ req: http.req, res: http.res, user: null, sessionId: null, sessionExpired: false, ip: "127.0.0.1" }), http };
}

export async function expectAppError(promise: Promise<unknown>, appCode: string) {
  try {
    await promise;
  } catch (error) {
    const code = (error as { appCode?: string }).appCode;
    if (code !== appCode) throw new Error(`Expected appCode ${appCode} but got ${code ?? "none"}: ${(error as Error).message}`);
    return error as Error;
  }
  throw new Error(`Expected appCode ${appCode} but the call succeeded`);
}
