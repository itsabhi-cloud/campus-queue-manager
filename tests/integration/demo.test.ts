import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, users } from "../../drizzle/schema";
import { SESSION_COOKIE } from "../../shared/domain";
import { ENV } from "../../server/_core/env";
import { createCallerFactory } from "../../server/_core/trpc";
import { db } from "../../server/db/client";
import { DEMO_ACCOUNTS, demoResetDue, resetDemoData } from "../../server/demo";
import { appRouter } from "../../server/routers";
import {
  callerFor,
  callerFromCookie,
  createUser,
  describeDb,
  expectAppError,
  fakeHttp,
  resetDatabase,
} from "../helpers";

const createCaller = createCallerFactory(appRouter);

/** A visitor with no session, keeping the cookies the server sets. */
function visitor() {
  const http = fakeHttp();
  const caller = createCaller({
    req: http.req,
    res: http.res,
    user: null,
    sessionId: null,
    sessionExpired: false,
    ip: "203.0.113.7",
  });
  return { caller, cookies: http.cookies };
}

/** Signs in through the demo button and returns a caller bound to that real session. */
async function demoSession(role: "STUDENT" | "STAFF" | "ADMIN") {
  const { caller, cookies } = visitor();
  const user = await caller.auth.demoLogin({ role });
  const cookie = cookies.find(c => c.name === SESSION_COOKIE)!;
  return { user, cookie, caller: await callerFromCookie(cookie.value) };
}

describe("demo reset schedule", () => {
  // CAMPUS_TIMEZONE defaults to Asia/Kolkata (UTC+05:30): 00:00 UTC is 05:30 on campus.
  const at = new Date("2026-10-11T00:00:00Z");
  it("is due once per campus day, at or after the reset hour", () => {
    expect(demoResetDue(at, "2026-10-10", 4)).toBe(true);
    expect(demoResetDue(at, "2026-10-10", 6)).toBe(false);
    expect(demoResetDue(at, "2026-10-11", 4)).toBe(false);
    expect(demoResetDue(at, null, 4)).toBe(true);
  });
});

describeDb("demo mode", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    ENV.DEMO_MODE = "false";
  });

  it("is off by default: info says so and sign-in is FORBIDDEN", async () => {
    expect(await callerFor(null).auth.demo()).toEqual({
      enabled: false,
      roles: [],
    });
    await expectAppError(
      visitor().caller.auth.demoLogin({ role: "STUDENT" }),
      "FORBIDDEN"
    );
  });

  it("refuses to reset a database that has any non-demo account", async () => {
    ENV.DEMO_MODE = "true";
    const real = await createUser("ADMIN");
    const result = await resetDemoData();
    expect(result).toMatchObject({ reset: false });
    expect(!result.reset && result.reason).toMatch(/1 non-demo account/);
    const [stillThere] = await db
      .select()
      .from(users)
      .where(eq(users.id, real.id));
    expect(stillThere).toBeDefined();
  });

  it("seeds demo accounts and signs into each role with the auth.login result shape", async () => {
    ENV.DEMO_MODE = "true";
    expect(await callerFor(null).auth.demo()).toEqual({
      enabled: true,
      roles: [],
    });
    expect(await resetDemoData()).toEqual({ reset: true });
    expect(await callerFor(null).auth.demo()).toEqual({
      enabled: true,
      roles: ["STUDENT", "STAFF", "ADMIN"],
    });
    const everyone = await db.select({ isDemo: users.isDemo }).from(users);
    expect(everyone.length).toBeGreaterThan(10);
    expect(everyone.every(u => u.isDemo)).toBe(true);

    for (const role of ["STUDENT", "STAFF", "ADMIN"] as const) {
      const { user, cookie, caller } = await demoSession(role);
      expect(Object.keys(user).sort()).toEqual(
        ["email", "id", "name", "role", "status"].sort()
      );
      expect(user).toMatchObject({
        role,
        email: DEMO_ACCOUNTS[role],
        status: "ACTIVE",
      });
      expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax" });
      expect(await caller.auth.me()).toEqual(user);
    }
    // The demo accounts' passwords are random; the normal sign-in can't be used.
    await expectAppError(
      visitor().caller.auth.login({
        email: DEMO_ACCOUNTS.ADMIN,
        password: "DevAdmin#2026",
      }),
      "INVALID_CREDENTIALS"
    );
  });

  it("lets demo users run the demo but blocks password changes and destructive admin actions", async () => {
    ENV.DEMO_MODE = "true";
    await resetDemoData();
    const student = await demoSession("STUDENT");
    const staff = await demoSession("STAFF");
    const admin = await demoSession("ADMIN");

    // The demo itself works: join a queue, staff call it, admin edits the catalog.
    const catalog = await student.caller.catalog.list();
    const group = catalog.services
      .flatMap(s => s.groups)
      .find(g => g.name === "Xerox")!;
    await student.caller.queue.join({ queueGroupId: group.id });
    const counters = await staff.caller.staff.myCounters();
    const xerox = counters.find(c => c.name === "Xerox Counter")!;
    const called = await staff.caller.staff.callNext({ counterId: xerox.id });
    expect(called.called.length).toBe(1);
    await admin.caller.admin.users.create({
      role: "STAFF",
      name: "Visitor Made",
      email: "visitor.made@example.edu",
    });
    const [made] = await db
      .select({ isDemo: users.isDemo })
      .from(users)
      .where(eq(users.email, "visitor.made@example.edu"));
    expect(made.isDemo).toBe(true); // stays restricted, and the reset may wipe it

    await expectAppError(
      student.caller.auth.changePassword({
        currentPassword: "whatever-1",
        newPassword: "Another-pass-9",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      student.caller.profile.setAvatar({
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      }),
      "FORBIDDEN"
    );
    const target = student.user.id;
    await expectAppError(
      admin.caller.admin.users.setStatus({
        userId: target,
        status: "SUSPENDED",
        reason: "testing",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      admin.caller.admin.users.setRole({
        userId: staff.user.id,
        role: "ADMIN",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      admin.caller.admin.users.issueCode({ userId: target }),
      "FORBIDDEN"
    );
    await expectAppError(
      admin.caller.admin.users.commitImport({
        csv: "name,email,college_id\nA B,ab@example.edu,QS1",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      admin.caller.admin.settings.update({
        maxActiveTokensPerStudent: 1,
        cameraStaleSeconds: 60,
        allowedEmailDomains: [],
        activationCodeDays: 14,
      }),
      "FORBIDDEN"
    );
    // Visitors' IP addresses are not kept where the shared admin could read them.
    const logs = await db.select({ ip: auditLogs.ipAddress }).from(auditLogs);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every(log => log.ip === null)).toBe(true);
  });

  it("a later reset starts over and signs everyone out", async () => {
    ENV.DEMO_MODE = "true";
    await resetDemoData();
    const { cookie } = await demoSession("STUDENT");
    expect(await resetDemoData()).toEqual({ reset: true });
    const after = await callerFromCookie(cookie.value);
    expect(await after.auth.me()).toBeNull();
    expect((await callerFor(null).auth.demo()).roles).toHaveLength(3);
  });
});
