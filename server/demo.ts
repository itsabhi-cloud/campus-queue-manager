/**
 * Public demo mode (DEMO_MODE=true): one-click sign-in to shared, seeded demo accounts and a daily
 * reset of the demo data. Demo accounts get random passwords nobody knows, so the only way in is
 * `auth.demoLogin`, unless DEMO_PASSWORD is set: then all three get that password and the landing
 * page lists their emails for the normal sign-in as well. The reset wipes the database, so it refuses to run while any non-demo account
 * exists: a demo instance needs its own database.
 */
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { and, count, eq, inArray } from "drizzle-orm";
import { systemSettings, users } from "../drizzle/schema";
import { ROLES, type Role } from "../shared/domain";
import { publicUser } from "./accounts";
import { hashPassword } from "./auth/password";
import { createSession } from "./auth/sessions";
import { ENV } from "./_core/env";
import { fail } from "./_core/errors";
import { logger } from "./_core/logger";
import { limiters } from "./_core/rateLimit";
import { db, pool } from "./db/client";
import { truncateTables } from "./db/reset";
import { invalidateSettingsCache } from "./lib/settings";
import { campusDate, campusHour } from "./lib/time";
import { closeAllStreams } from "./realtime/sse";
import { seedCampus } from "./seed/campus";

export const DEMO_EMAIL_DOMAIN = "queuesense.demo";

/** The account `auth.demoLogin` signs into for each role. */
export const DEMO_ACCOUNTS: Record<Role, string> = {
  STUDENT: `student01@${DEMO_EMAIL_DOMAIN}`,
  STAFF: `staff@${DEMO_EMAIL_DOMAIN}`,
  ADMIN: `admin@${DEMO_EMAIL_DOMAIN}`,
};

const LAST_RESET_KEY = "demo.lastResetDate";

export function demoModeEnabled() {
  return ENV.DEMO_MODE === "true";
}

export type DemoInfo = {
  enabled: boolean;
  roles: Role[];
  /** Ready demo accounts that sign in with DEMO_PASSWORD; empty when it isn't set. */
  accounts: Array<{ role: Role; email: string }>;
};

/** What the landing page needs: whether demo sign-in is on, and for which roles it is ready. */
export async function demoInfo(): Promise<DemoInfo> {
  if (!demoModeEnabled()) return { enabled: false, roles: [], accounts: [] };
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(
      and(
        eq(users.isDemo, true),
        eq(users.status, "ACTIVE"),
        inArray(users.email, Object.values(DEMO_ACCOUNTS))
      )
    );
  const ready = new Set(rows.map(row => row.email));
  const roles = ROLES.filter(role => ready.has(DEMO_ACCOUNTS[role]));
  return {
    enabled: true,
    roles,
    accounts: ENV.DEMO_PASSWORD
      ? roles.map(role => ({ role, email: DEMO_ACCOUNTS[role] }))
      : [],
  };
}

/** Signs into the shared demo account for `role`. Same result and session cookie as `auth.login`. */
export async function demoLogin(role: Role, req: Request, res: Response) {
  if (!demoModeEnabled())
    fail("FORBIDDEN", "Demo sign-in isn't available on this server.");
  const ip = (req.ip ?? "unknown").slice(0, 64);
  if (limiters.demoLoginsByIp.consume(ip) > 0)
    fail(
      "RATE_LIMITED",
      "Too many demo sign-ins from your network. Please try again in a few minutes."
    );
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.email, DEMO_ACCOUNTS[role]),
        eq(users.isDemo, true),
        eq(users.status, "ACTIVE")
      )
    )
    .limit(1);
  if (!user)
    fail("NOT_FOUND", "The demo is being reset. Please try again in a minute.");
  await db
    .update(users)
    .set({ lastSignedInAt: new Date() })
    .where(eq(users.id, user.id));
  await createSession(user.id, req, res);
  return publicUser(user);
}

async function demoPasswordHash() {
  if (ENV.DEMO_PASSWORD) return hashPassword(ENV.DEMO_PASSWORD);
  // Never stored or shown anywhere: demo accounts are reachable only through demoLogin.
  return hashPassword(`${randomBytes(24).toString("base64url")}9a`);
}

export type DemoResetResult =
  | { reset: true }
  | { reset: false; reason: string };

/**
 * Wipes the database and seeds the demo campus. Refuses when any non-demo account exists, so it
 * can't destroy a real deployment that was started with DEMO_MODE by mistake. Concurrent calls
 * (scheduler and the seed script) are serialised with a MySQL named lock.
 */
export async function resetDemoData(): Promise<DemoResetResult> {
  const lock = await pool.getConnection();
  try {
    const [rows] = await lock.query(
      "SELECT GET_LOCK('queuesense.demo_reset', 0) AS acquired"
    );
    if ((rows as Array<{ acquired: number | null }>)[0]?.acquired !== 1)
      return { reset: false, reason: "Another demo reset is in progress." };

    const [{ n }] = await db
      .select({ n: count() })
      .from(users)
      .where(eq(users.isDemo, false));
    if (n > 0)
      return {
        reset: false,
        reason: `The database has ${n} non-demo account(s). Demo mode only resets a database that holds nothing but demo data; give the demo its own database.`,
      };

    const [admin, staff, student] = await Promise.all([
      demoPasswordHash(),
      demoPasswordHash(),
      demoPasswordHash(),
    ]);
    await truncateTables();
    invalidateSettingsCache();
    await seedCampus({
      emailDomain: DEMO_EMAIL_DOMAIN,
      isDemo: true,
      hashes: { admin, staff, student },
      pendingStudents: false,
      allCountersStaff: { email: DEMO_ACCOUNTS.STAFF, name: "Demo Staff" },
    });
    await db
      .insert(systemSettings)
      .values({ key: LAST_RESET_KEY, value: campusDate() });
    // Every session was wiped; end open streams so tabs notice and return to sign-in.
    closeAllStreams();
    return { reset: true };
  } finally {
    await lock
      .query("SELECT RELEASE_LOCK('queuesense.demo_reset')")
      .catch(() => undefined);
    lock.release();
  }
}

/** Due once per campus day, at or after DEMO_RESET_HOUR (so a reset missed while asleep catches up). */
export function demoResetDue(
  now: Date,
  lastResetDate: string | null,
  resetHour: number
) {
  if (lastResetDate === campusDate(now)) return false;
  // Never reset yet (e.g. demo accounts seeded by hand): wait for the reset hour like any other day.
  return campusHour(now) >= resetHour;
}

async function lastResetDate(): Promise<string | null> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, LAST_RESET_KEY))
    .limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

/** Seeds an empty database on startup, then checks every few minutes whether the daily reset is due. */
export function startDemoScheduler(): () => void {
  let running = false;
  let lastSkipReason: string | null = null;
  const tick = async (startup: boolean) => {
    if (running) return;
    running = true;
    try {
      const [{ n }] = await db.select({ n: count() }).from(users);
      const due =
        (startup && n === 0) ||
        demoResetDue(new Date(), await lastResetDate(), ENV.DEMO_RESET_HOUR);
      if (!due) return;
      const result = await resetDemoData();
      if (result.reset) {
        lastSkipReason = null;
        logger.info("Demo data reset");
      } else if (result.reason !== lastSkipReason) {
        // Checked every few minutes; say it once rather than on every tick.
        lastSkipReason = result.reason;
        logger.warn("Demo reset skipped", { reason: result.reason });
      }
    } catch (error) {
      logger.error("Demo reset failed", { error });
    } finally {
      running = false;
    }
  };
  void tick(true);
  const timer = setInterval(() => void tick(false), 5 * 60_000);
  return () => clearInterval(timer);
}
