import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { authCodes, sessions, users } from "../../drizzle/schema";
import { SESSION_COOKIE } from "../../shared/domain";
import { db } from "../../server/db/client";
import {
  anonymousCaller,
  callerFor,
  callerFromCookie,
  createQueue,
  createUser,
  describeDb,
  expectAppError,
  resetDatabase,
  TEST_PASSWORD,
} from "../helpers";

describeDb("authentication", () => {
  beforeEach(resetDatabase);

  it("signs in with a password and sets an HTTP-only SameSite=Lax session cookie", async () => {
    const student = await createUser("STUDENT");
    const { caller, http } = anonymousCaller();
    const me = await caller.auth.login({
      email: student.email.toUpperCase(),
      password: TEST_PASSWORD,
    });
    expect(me).toMatchObject({ id: student.id, role: "STUDENT" });
    const cookie = http.cookies.find(c => c.name === SESSION_COOKIE)!;
    expect(cookie.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    // The raw token is never stored.
    const stored = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, student.id));
    expect(stored).toHaveLength(1);
    expect(stored[0].id).not.toBe(cookie.value);
    const authed = await callerFromCookie(cookie.value);
    expect(await authed.auth.me()).toMatchObject({ id: student.id });
  });

  it("gives the same answer for unknown emails and wrong passwords", async () => {
    const student = await createUser("STUDENT");
    const { caller } = anonymousCaller();
    const a = await expectAppError(
      caller.auth.login({ email: student.email, password: "wrong-password-1" }),
      "INVALID_CREDENTIALS"
    );
    const b = await expectAppError(
      caller.auth.login({
        email: "nobody@test.edu",
        password: "wrong-password-1",
      }),
      "INVALID_CREDENTIALS"
    );
    expect(a.message).toBe(b.message);
  });

  it("locks an account after repeated failures", async () => {
    const student = await createUser("STUDENT");
    const { caller } = anonymousCaller();
    for (let i = 0; i < 5; i++)
      await expectAppError(
        caller.auth.login({ email: student.email, password: "nope-nope-1" }),
        "INVALID_CREDENTIALS"
      );
    await expectAppError(
      caller.auth.login({ email: student.email, password: TEST_PASSWORD }),
      "ACCOUNT_LOCKED"
    );
  });

  it("refuses pending and suspended accounts, and suspension kills existing sessions", async () => {
    const pending = await createUser("STUDENT", {
      status: "PENDING",
      passwordHash: null,
    });
    const { caller } = anonymousCaller();
    await expectAppError(
      caller.auth.login({ email: pending.email, password: TEST_PASSWORD }),
      "INVALID_CREDENTIALS"
    );

    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const login = anonymousCaller();
    await login.caller.auth.login({
      email: student.email,
      password: TEST_PASSWORD,
    });
    const token = login.http.cookies[0].value;
    await callerFor(admin).admin.users.setStatus({
      userId: student.id,
      status: "SUSPENDED",
      reason: "Policy review",
    });
    const expired = await callerFromCookie(token);
    expect(await expired.auth.me()).toBeNull();
    await expectAppError(expired.queue.myActive(), "SESSION_EXPIRED");
    await expectAppError(
      anonymousCaller().caller.auth.login({
        email: student.email,
        password: TEST_PASSWORD,
      }),
      "ACCOUNT_INACTIVE"
    );
  });

  it("activates an admin-provisioned account with a one-time code", async () => {
    const admin = await createUser("ADMIN");
    const created = await callerFor(admin).admin.users.create({
      role: "STUDENT",
      name: "New Student",
      email: "new@test.edu",
      collegeId: "NEW-001",
    });
    expect(created.code).toMatch(/^[0-9A-Z]{4}-/);
    const { caller, http } = anonymousCaller();
    await expectAppError(
      caller.auth.activate({
        email: "new@test.edu",
        code: "AAAA-BBBB-CCCC",
        password: "Brand-new-pass-1",
      }),
      "INVALID_CODE"
    );
    const me = await caller.auth.activate({
      email: "new@test.edu",
      code: created.code.toLowerCase(),
      password: "Brand-new-pass-1",
    });
    expect(me.status).toBe("ACTIVE");
    expect(http.cookies).toHaveLength(1);
    // Codes are single-use.
    await expectAppError(
      caller.auth.activate({
        email: "new@test.edu",
        code: created.code,
        password: "Another-pass-22",
      }),
      "INVALID_CODE"
    );
    const [code] = await db
      .select()
      .from(authCodes)
      .where(eq(authCodes.userId, created.userId));
    expect(code.usedAt).not.toBeNull();
    expect(code.codeHash).not.toContain(created.code);
  });

  it("logs out by deleting the server-side session", async () => {
    const student = await createUser("STUDENT");
    const login = anonymousCaller();
    await login.caller.auth.login({
      email: student.email,
      password: TEST_PASSWORD,
    });
    const token = login.http.cookies[0].value;
    const authed = await callerFromCookie(token);
    await authed.auth.logout();
    expect(await (await callerFromCookie(token)).auth.me()).toBeNull();
  });

  it("changes a password and signs out other devices", async () => {
    const student = await createUser("STUDENT");
    const first = anonymousCaller();
    await first.caller.auth.login({
      email: student.email,
      password: TEST_PASSWORD,
    });
    const second = anonymousCaller();
    await second.caller.auth.login({
      email: student.email,
      password: TEST_PASSWORD,
    });
    const firstCaller = await callerFromCookie(first.http.cookies[0].value);
    await firstCaller.auth.changePassword({
      currentPassword: TEST_PASSWORD,
      newPassword: "Rotated-pass-99",
    });
    expect(
      await (await callerFromCookie(first.http.cookies[0].value)).auth.me()
    ).not.toBeNull();
    expect(
      await (await callerFromCookie(second.http.cookies[0].value)).auth.me()
    ).toBeNull();
  });
});

describeDb("role-based access control", () => {
  beforeEach(resetDatabase);

  it("rejects anonymous callers", async () => {
    await expectAppError(
      anonymousCaller().caller.catalog.list(),
      "UNAUTHENTICATED"
    );
    await expectAppError(
      anonymousCaller().caller.admin.overview(),
      "UNAUTHENTICATED"
    );
  });

  it("keeps students out of staff and admin operations", async () => {
    const student = await createUser("STUDENT");
    const { counterIds } = await createQueue();
    const caller = callerFor(student);
    await expectAppError(
      caller.staff.callNext({ counterId: counterIds[0] }),
      "FORBIDDEN"
    );
    await expectAppError(caller.admin.users.list({}), "FORBIDDEN");
    await expectAppError(
      caller.camera.report({ stationId: 1, peopleCount: 1, rawDetections: 1 }),
      "FORBIDDEN"
    );
  });

  it("keeps staff out of admin operations and queue joining", async () => {
    const staff = await createUser("STAFF");
    const { groupId } = await createQueue();
    const caller = callerFor(staff);
    await expectAppError(caller.admin.overview(), "FORBIDDEN");
    await expectAppError(
      caller.admin.catalog.upsertCounter({
        queueGroupId: groupId,
        name: "X",
        tokenPrefix: "ZZ",
        isActive: true,
        displayOrder: 0,
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      caller.queue.join({ queueGroupId: groupId }),
      "FORBIDDEN"
    );
  });

  it("never lets a role come from the client", async () => {
    const student = await createUser("STUDENT");
    await db
      .update(users)
      .set({ name: "Tampered" })
      .where(eq(users.id, student.id));
    // Profile updates cannot carry role/email/collegeId: unknown keys are stripped by validation.
    const profile = await callerFor(student).profile.update({
      phone: "+91 90000 00000",
      role: "ADMIN",
      email: "x@y.z",
      collegeId: "HACK",
    } as never);
    expect(profile.role).toBe("STUDENT");
    expect(profile.email).toBe(student.email);
    expect(profile.student?.collegeId).not.toBe("HACK");
  });

  it("prevents an admin from removing the last active admin", async () => {
    const admin = await createUser("ADMIN");
    const other = await createUser("ADMIN");
    await callerFor(admin).admin.users.setStatus({
      userId: other.id,
      status: "DISABLED",
      reason: "Left the college",
    });
    await expectAppError(
      callerFor(other).admin.users.setStatus({
        userId: admin.id,
        status: "DISABLED",
        reason: "Oops",
      }),
      "CONFLICT"
    );
    await expectAppError(
      callerFor(admin).admin.users.setRole({ userId: admin.id, role: "STAFF" }),
      "FORBIDDEN"
    );
  });
});

describeDb("sign-in throttling", () => {
  beforeEach(resetDatabase);

  it("does not throttle many successful sign-ins from one shared campus IP", async () => {
    const students = await Promise.all(
      Array.from({ length: 60 }, () => createUser("STUDENT"))
    );
    for (const student of students) {
      await expect(
        anonymousCaller().caller.auth.login({
          email: student.email,
          password: TEST_PASSWORD,
        })
      ).resolves.toMatchObject({ id: student.id });
    }
  });

  it("throttles an IP after many failures across accounts", async () => {
    const { caller } = anonymousCaller();
    for (let i = 0; i < 50; i++)
      await expectAppError(
        caller.auth.login({
          email: `nobody${i}@test.edu`,
          password: "Wrong-pass-1",
        }),
        "INVALID_CREDENTIALS"
      );
    await expectAppError(
      caller.auth.login({ email: "nobody@test.edu", password: "Wrong-pass-1" }),
      "RATE_LIMITED"
    );
  });
});
