/**
 * Final-readiness checks: a full permissions matrix, account states, concurrency between staff,
 * merge restoration, notification recipients and import hardening.
 */
import { beforeEach, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogs,
  counters,
  notifications,
  queueEntries,
  queueEvents,
  sessions,
  users,
} from "../../drizzle/schema";
import { db } from "../../server/db/client";
import {
  anonymousCaller,
  assign,
  callerFor,
  callerFromCookie,
  createQueue,
  createUser,
  describeDb,
  expectAppError,
  resetDatabase,
  TEST_PASSWORD,
} from "../helpers";

type Caller = ReturnType<typeof callerFor>;

/** Every privileged operation, with valid-looking input, so only authorization can stop it. */
function privilegedCalls(ids: {
  groupId: number;
  counterId: number;
  otherCounterId: number;
  entryId: number;
  userId: number;
  serviceId: number;
}) {
  const staffOnly: Array<[string, (c: Caller) => Promise<unknown>]> = [
    ["staff.board", c => c.staff.board({ counterId: ids.counterId })],
    ["staff.callNext", c => c.staff.callNext({ counterId: ids.counterId })],
    ["staff.serve", c => c.staff.serve({ entryIds: [ids.entryId] })],
    ["staff.complete", c => c.staff.complete({ entryIds: [ids.entryId] })],
    ["staff.skip", c => c.staff.skip({ entryIds: [ids.entryId] })],
    [
      "staff.cancel",
      c => c.staff.cancel({ entryIds: [ids.entryId], reason: "Test reason" }),
    ],
    [
      "staff.setCounterStatus",
      c =>
        c.staff.setCounterStatus({
          counterId: ids.counterId,
          status: "PAUSED",
        }),
    ],
    [
      "staff.merge",
      c =>
        c.staff.merge({
          sourceCounterId: ids.counterId,
          targetCounterId: ids.otherCounterId,
          reason: "Test reason",
        }),
    ],
    [
      "staff.setTraffic",
      c =>
        c.staff.setTraffic({
          queueGroupId: ids.groupId,
          level: "HEAVY",
          delaySeconds: 0,
        }),
    ],
    [
      "staff.setPriority",
      c =>
        c.staff.setPriority({
          entryId: ids.entryId,
          enabled: true,
          reason: "Test reason",
        }),
    ],
    [
      "camera.report",
      c => c.camera.report({ stationId: 1, peopleCount: 1, rawDetections: 1 }),
    ],
  ];
  const adminOnly: Array<[string, (c: Caller) => Promise<unknown>]> = [
    ["admin.overview", c => c.admin.overview()],
    ["admin.users.list", c => c.admin.users.list({})],
    [
      "admin.users.create",
      c =>
        c.admin.users.create({
          role: "ADMIN",
          name: "Escalate",
          email: "escalate@test.edu",
        }),
    ],
    [
      "admin.users.setStatus",
      c =>
        c.admin.users.setStatus({
          userId: ids.userId,
          status: "SUSPENDED",
          reason: "Test",
        }),
    ],
    [
      "admin.users.setRole",
      c => c.admin.users.setRole({ userId: ids.userId, role: "ADMIN" }),
    ],
    [
      "admin.users.issueCode",
      c => c.admin.users.issueCode({ userId: ids.userId }),
    ],
    [
      "admin.users.previewImport",
      c =>
        c.admin.users.previewImport({
          csv: "name,email,college_id\nA B,a@b.edu,X-1",
        }),
    ],
    [
      "admin.users.commitImport",
      c =>
        c.admin.users.commitImport({
          csv: "name,email,college_id\nA B,a@b.edu,X-1",
        }),
    ],
    ["admin.catalog.get", c => c.admin.catalog.get()],
    [
      "admin.catalog.upsertService",
      c =>
        c.admin.catalog.upsertService({
          id: ids.serviceId,
          slug: "hacked",
          name: "Hacked",
          description: "x x",
          kind: "OTHER",
          isActive: false,
          displayOrder: 0,
        }),
    ],
    [
      "admin.catalog.upsertCounter",
      c =>
        c.admin.catalog.upsertCounter({
          id: ids.counterId,
          queueGroupId: ids.groupId,
          name: "Hacked",
          tokenPrefix: "HK",
          isActive: true,
          displayOrder: 0,
        }),
    ],
    [
      "admin.catalog.setAssignments",
      c =>
        c.admin.catalog.setAssignments({
          staffUserId: ids.userId,
          counterIds: [ids.counterId],
        }),
    ],
    ["admin.audit", c => c.admin.audit({})],
    ["admin.settings.get", c => c.admin.settings.get()],
    [
      "admin.settings.update",
      c =>
        c.admin.settings.update({
          maxActiveTokensPerStudent: 10,
          cameraStaleSeconds: 60,
          allowedEmailDomains: [],
          activationCodeDays: 14,
        }),
    ],
  ];
  return { staffOnly, adminOnly };
}

describeDb("permissions matrix", () => {
  beforeEach(resetDatabase);

  it("rejects every staff and admin operation for students, and admin operations for staff", async () => {
    const student = await createUser("STUDENT");
    const staff = await createUser("STAFF");
    const { groupId, counterIds, serviceId } = await createQueue({
      counters: ["PA", "PB"],
    });
    await assign(staff, counterIds[0]);
    const joined = await callerFor(student).queue.join({
      queueGroupId: groupId,
      counterId: counterIds[0],
    });
    const { staffOnly, adminOnly } = privilegedCalls({
      groupId,
      counterId: counterIds[0],
      otherCounterId: counterIds[1],
      entryId: joined.entryId,
      userId: staff.id,
      serviceId,
    });

    for (const [name, call] of [...staffOnly, ...adminOnly]) {
      await expectAppError(call(callerFor(student)), "FORBIDDEN").catch(
        error => {
          throw new Error(`student → ${name}: ${(error as Error).message}`);
        }
      );
    }
    for (const [name, call] of adminOnly) {
      await expectAppError(call(callerFor(staff)), "FORBIDDEN").catch(error => {
        throw new Error(`staff → ${name}: ${(error as Error).message}`);
      });
    }
    for (const [name, call] of [...staffOnly, ...adminOnly]) {
      await expectAppError(
        call(anonymousCaller().caller),
        "UNAUTHENTICATED"
      ).catch(error => {
        throw new Error(`anonymous → ${name}: ${(error as Error).message}`);
      });
    }
    // Nothing changed as a result of any rejected call.
    const [entry] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, joined.entryId));
    expect(entry).toMatchObject({ status: "WAITING", isPriority: false });
    const [counter] = await db
      .select()
      .from(counters)
      .where(eq(counters.id, counterIds[0]));
    expect(counter).toMatchObject({ status: "OPEN", name: "Counter PA" });
    expect(
      await db.select().from(users).where(eq(users.email, "escalate@test.edu"))
    ).toHaveLength(0);
  });

  it("keeps staff to their own counters, including for merges in either direction", async () => {
    const staff = await createUser("STAFF");
    const own = await createQueue({ counters: ["OW"] });
    const other = await createQueue({ counters: ["X1", "X2"] });
    await assign(staff, own.counterIds[0]);
    await expectAppError(
      callerFor(staff).staff.merge({
        sourceCounterId: other.counterIds[0],
        targetCounterId: other.counterIds[1],
        reason: "Not mine",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      callerFor(staff).staff.setCounterStatus({
        counterId: other.counterIds[0],
        status: "OFFLINE",
        mergeIntoCounterId: other.counterIds[1],
        reason: "Not mine",
      }),
      "FORBIDDEN"
    );
    const [x1] = await db
      .select()
      .from(counters)
      .where(eq(counters.id, other.counterIds[0]));
    expect(x1.status).toBe("OPEN");
  });

  it("lets admins perform administrative operations", async () => {
    const admin = await createUser("ADMIN");
    const staff = await createUser("STAFF");
    const { counterIds } = await createQueue();
    const caller = callerFor(admin);
    await expect(caller.admin.overview()).resolves.toBeTruthy();
    await expect(
      caller.admin.catalog.setAssignments({ staffUserId: staff.id, counterIds })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      caller.admin.users.setRole({ userId: staff.id, role: "ADMIN" })
    ).resolves.toMatchObject({ ok: true });
  });
});

describeDb("account states", () => {
  beforeEach(resetDatabase);

  it("refuses disabled accounts and ends their sessions", async () => {
    const admin = await createUser("ADMIN");
    const staff = await createUser("STAFF");
    const login = anonymousCaller();
    await login.caller.auth.login({
      email: staff.email,
      password: TEST_PASSWORD,
    });
    const token = login.http.cookies[0].value;
    await callerFor(admin).admin.users.setStatus({
      userId: staff.id,
      status: "DISABLED",
      reason: "Left the college",
    });
    expect(await (await callerFromCookie(token)).auth.me()).toBeNull();
    expect(
      await db.select().from(sessions).where(eq(sessions.userId, staff.id))
    ).toHaveLength(0);
    await expectAppError(
      anonymousCaller().caller.auth.login({
        email: staff.email,
        password: TEST_PASSWORD,
      }),
      "ACCOUNT_INACTIVE"
    );
  });

  it("treats an expired session as signed out", async () => {
    const student = await createUser("STUDENT");
    const login = anonymousCaller();
    await login.caller.auth.login({
      email: student.email,
      password: TEST_PASSWORD,
    });
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, student.id));
    const expired = await callerFromCookie(login.http.cookies[0].value);
    expect(await expired.auth.me()).toBeNull();
    await expectAppError(expired.queue.myActive(), "SESSION_EXPIRED");
  });
});

describeDb("concurrency between staff and students", () => {
  beforeEach(resetDatabase);

  it("lets only one of two simultaneous 'call next' clicks succeed on a single desk", async () => {
    const [a, b] = [await createUser("STAFF"), await createUser("STAFF")];
    const { groupId, counterIds } = await createQueue({ counters: ["CC"] });
    await assign(a, counterIds[0]);
    await assign(b, counterIds[0]);
    for (let i = 0; i < 3; i++)
      await callerFor(await createUser("STUDENT")).queue.join({
        queueGroupId: groupId,
      });
    const results = await Promise.allSettled([
      callerFor(a).staff.callNext({ counterId: counterIds[0] }),
      callerFor(b).staff.callNext({ counterId: counterIds[0] }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const called = await db
      .select()
      .from(queueEntries)
      .where(
        and(
          eq(queueEntries.counterId, counterIds[0]),
          eq(queueEntries.status, "CALLED")
        )
      );
    expect(called.map(c => c.tokenNumber)).toEqual(["CC001"]);
  });

  it("keeps state consistent when a student cancels while staff calls", async () => {
    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const { groupId, counterIds } = await createQueue({ counters: ["RC"] });
    const joined = await callerFor(student).queue.join({
      queueGroupId: groupId,
    });
    await Promise.allSettled([
      callerFor(student).queue.cancel({ entryId: joined.entryId }),
      callerFor(admin).staff.callNext({ counterId: counterIds[0] }),
    ]);
    const [row] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, joined.entryId));
    // Either the call won (then the student's cancel of a CALLED token is also allowed) or the cancel won.
    expect(["CANCELLED", "CALLED"]).toContain(row.status);
    const events = await db
      .select()
      .from(queueEvents)
      .where(eq(queueEvents.queueEntryId, joined.entryId));
    const terminal = events.filter(e => e.toStatus === "CANCELLED");
    expect(terminal.length).toBeLessThanOrEqual(1);
  });

  it("spreads simultaneous 'any counter' joins without duplicates or lost entries", async () => {
    const students = await Promise.all(
      Array.from({ length: 20 }, () => createUser("STUDENT"))
    );
    const { groupId, counterIds } = await createQueue({
      counters: ["SA", "SB"],
    });
    const results = await Promise.all(
      students.map(s => callerFor(s).queue.join({ queueGroupId: groupId }))
    );
    expect(new Set(results.map(r => r.tokenNumber)).size).toBe(20);
    const rows = await db
      .select()
      .from(queueEntries)
      .where(inArray(queueEntries.counterId, counterIds));
    expect(rows).toHaveLength(20);
    for (const counterId of counterIds) {
      const here = rows
        .filter(r => r.counterId === counterId)
        .sort((x, y) => x.orderKey - y.orderKey);
      expect(here.map(r => r.sequenceNumber)).toEqual(
        here.map((_, i) => i + 1)
      );
    }
  });
});

describeDb("merge restoration", () => {
  beforeEach(resetDatabase);

  it("reopens a merged counter without moving tokens back or corrupting either line", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({
      counters: ["MA", "MB"],
    });
    for (const counterId of counterIds) {
      for (let i = 0; i < 2; i++)
        await callerFor(await createUser("STUDENT")).queue.join({
          queueGroupId: groupId,
          counterId,
        });
    }
    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[1],
      status: "OFFLINE",
      reason: "Jam",
      mergeIntoCounterId: counterIds[0],
    });
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "queue.merged"));
    expect(log.metadata).toMatchObject({ moved: 2, strategy: "ALTERNATE" });

    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[1],
      status: "OPEN",
    });
    const [b] = await db
      .select()
      .from(counters)
      .where(eq(counters.id, counterIds[1]));
    expect(b).toMatchObject({ status: "OPEN", mergedIntoCounterId: null });
    const boardA = await callerFor(admin).staff.board({
      counterId: counterIds[0],
    });
    expect(boardA.waiting.map(w => w.tokenNumber)).toEqual([
      "MA001",
      "MB001",
      "MA002",
      "MB002",
    ]);
    expect(boardA.waiting.map(w => w.position)).toEqual([1, 2, 3, 4]);

    const late = await callerFor(await createUser("STUDENT")).queue.join({
      queueGroupId: groupId,
    });
    expect(late).toMatchObject({
      counterId: counterIds[1],
      tokenNumber: "MB003",
      position: 1,
    });
    const all = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.queueGroupId, groupId));
    expect(all).toHaveLength(5);
  });
});

describeDb("notification recipients and types", () => {
  beforeEach(resetDatabase);

  it("sends wait-decreased, offline and completed notices only to the affected student", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({
      counters: ["NT"],
      averageServiceSeconds: 120,
    });
    const other = await createQueue({ counters: ["NO"] });
    const people = [];
    for (let i = 0; i < 4; i++) {
      const s = await createUser("STUDENT");
      people.push({
        s,
        entry: await callerFor(s).queue.join({ queueGroupId: groupId }),
      });
    }
    const bystander = await createUser("STUDENT");
    await callerFor(bystander).queue.join({ queueGroupId: other.groupId });
    const desk = callerFor(admin);
    await desk.staff.setTraffic({
      queueGroupId: groupId,
      level: "HEAVY",
      delaySeconds: 600,
    });
    await desk.staff.setTraffic({
      queueGroupId: groupId,
      level: "NORMAL",
      delaySeconds: 0,
    });
    await desk.staff.setCounterStatus({
      counterId: counterIds[0],
      status: "OFFLINE",
      reason: "Power cut",
    });
    await desk.staff.setCounterStatus({
      counterId: counterIds[0],
      status: "OPEN",
    });
    const called = await desk.staff.callNext({ counterId: counterIds[0] });
    await desk.staff.serve({ entryIds: [called.called[0].id] });
    await desk.staff.complete({ entryIds: [called.called[0].id] });

    const typesFor = async (userId: number) =>
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, userId))
      ).map(n => n.type);
    const last = await typesFor(people[3].s.id);
    expect(last).toEqual(
      expect.arrayContaining([
        "QUEUE_JOINED",
        "WAIT_INCREASED",
        "WAIT_DECREASED",
        "COUNTER_OFFLINE",
        "COUNTER_RESUMED",
      ])
    );
    expect(await typesFor(people[0].s.id)).toEqual(
      expect.arrayContaining([
        "TOKEN_CALLED",
        "SERVICE_STARTED",
        "SERVICE_COMPLETED",
      ])
    );
    expect(await typesFor(bystander.id)).toEqual(["QUEUE_JOINED"]);
    const [offline] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, people[3].s.id),
          eq(notifications.type, "COUNTER_OFFLINE")
        )
      );
    expect(offline.message).toContain("Power cut");
    // No notification mentions another student's name or email.
    const texts = (await db.select().from(notifications))
      .map(n => `${n.title} ${n.message}`)
      .join(" ");
    for (const p of people) {
      expect(texts).not.toContain(p.s.email);
      expect(texts).not.toContain(p.s.name);
    }
  });
});

describeDb("bulk import hardening", () => {
  beforeEach(resetDatabase);

  it("ignores a role column: imported people are always students", async () => {
    const admin = await createUser("ADMIN");
    const csv =
      "name,email,college_id,role,status\nSneaky Person,sneaky@campus.edu,SN-1,ADMIN,ACTIVE";
    const result = await callerFor(admin).admin.users.commitImport({ csv });
    expect(result.created).toBe(1);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, "sneaky@campus.edu"));
    expect(user).toMatchObject({
      role: "STUDENT",
      status: "PENDING",
      passwordHash: null,
    });
  });

  it("rejects missing required fields, malformed emails and oversized files", async () => {
    const admin = await createUser("ADMIN");
    const preview = await callerFor(admin).admin.users.previewImport({
      csv: "name,email,college_id\n,blank@campus.edu,B-1\nNo Email,,B-2\nBad Mail,bad@,B-3\n=CMD(),formula@campus.edu,B-4",
    });
    expect(preview.rows.map(r => r.status)).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "valid",
    ]);
    const huge = [
      "name,email,college_id",
      ...Array.from(
        { length: 5001 },
        (_, i) => `Student ${i},s${i}@campus.edu,H-${i}`
      ),
    ].join("\n");
    await expectAppError(
      callerFor(admin).admin.users.previewImport({ csv: huge }),
      "VALIDATION"
    );
    expect(await db.select().from(users)).toHaveLength(1);
  });
});
