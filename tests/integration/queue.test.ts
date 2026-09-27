import { beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  counters,
  notifications,
  queueEntries,
  queueEvents,
} from "../../drizzle/schema";
import { db } from "../../server/db/client";
import {
  saveSettings,
  DEFAULT_SETTINGS,
  invalidateSettingsCache,
} from "../../server/lib/settings";
import {
  assign,
  callerFor,
  createQueue,
  createUser,
  describeDb,
  expectAppError,
  resetDatabase,
} from "../helpers";

describeDb("joining a queue", () => {
  beforeEach(resetDatabase);

  it("issues a token with a server-computed position and estimate", async () => {
    const [a, b] = [await createUser("STUDENT"), await createUser("STUDENT")];
    const { groupId } = await createQueue({
      counters: ["A"],
      averageServiceSeconds: 120,
    });
    const first = await callerFor(a).queue.join({ queueGroupId: groupId });
    const second = await callerFor(b).queue.join({ queueGroupId: groupId });
    expect(first).toMatchObject({
      tokenNumber: "A001",
      position: 1,
      peopleAhead: 0,
    });
    expect(second).toMatchObject({
      tokenNumber: "A002",
      position: 2,
      peopleAhead: 1,
      estimatedWaitSeconds: 120,
    });
    const mine = await callerFor(b).queue.myActive();
    expect(mine.entries[0]).toMatchObject({
      tokenNumber: "A002",
      position: 2,
      peopleAhead: 1,
      status: "WAITING",
    });
    const events = await db
      .select()
      .from(queueEvents)
      .where(eq(queueEvents.type, "JOINED"));
    expect(events).toHaveLength(2);
    const [joined] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, b.id),
          eq(notifications.type, "QUEUE_JOINED")
        )
      );
    expect(joined.message).toContain("1 person ahead of you");
  });

  it("gives every concurrent joiner a unique token and a consistent position", async () => {
    const students = await Promise.all(
      Array.from({ length: 25 }, () => createUser("STUDENT"))
    );
    const { groupId, counterIds } = await createQueue({ counters: ["C"] });
    const results = await Promise.all(
      students.map(s => callerFor(s).queue.join({ queueGroupId: groupId }))
    );
    const tokens = results.map(r => r.tokenNumber);
    expect(new Set(tokens).size).toBe(25);
    expect([...tokens].sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `C${String(i + 1).padStart(3, "0")}`)
    );
    const rows = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.counterId, counterIds[0]));
    const byOrder = [...rows].sort((x, y) => x.orderKey - y.orderKey);
    // Token order and queue order agree, and the order keys are gap-free.
    expect(byOrder.map(r => r.sequenceNumber)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1)
    );
    const [counter] = await db
      .select()
      .from(counters)
      .where(eq(counters.id, counterIds[0]));
    expect(counter.nextSequence).toBe(26);
  });

  it("lets a student hold only one active token per queue, even when racing", async () => {
    const student = await createUser("STUDENT");
    const { groupId } = await createQueue();
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        callerFor(student).queue.join({ queueGroupId: groupId })
      )
    );
    expect(attempts.filter(a => a.status === "fulfilled")).toHaveLength(1);
    attempts
      .filter((a): a is PromiseRejectedResult => a.status === "rejected")
      .forEach(a =>
        expect((a.reason as { appCode?: string }).appCode).toBe(
          "DUPLICATE_ACTIVE_TOKEN"
        )
      );
    const rows = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.userId, student.id));
    expect(rows).toHaveLength(1);
  });

  it("allows a new token after the previous one is finished", async () => {
    const student = await createUser("STUDENT");
    const { groupId } = await createQueue();
    const first = await callerFor(student).queue.join({
      queueGroupId: groupId,
    });
    await callerFor(student).queue.cancel({ entryId: first.entryId });
    const second = await callerFor(student).queue.join({
      queueGroupId: groupId,
    });
    expect(second.tokenNumber).not.toBe(first.tokenNumber);
  });

  it("enforces the per-student active token limit", async () => {
    const admin = await createUser("ADMIN");
    await saveSettings(
      db,
      { ...DEFAULT_SETTINGS, maxActiveTokensPerStudent: 2 },
      admin.id
    );
    invalidateSettingsCache();
    const student = await createUser("STUDENT");
    const queues = [
      await createQueue(),
      await createQueue(),
      await createQueue(),
    ];
    await callerFor(student).queue.join({ queueGroupId: queues[0].groupId });
    await callerFor(student).queue.join({ queueGroupId: queues[1].groupId });
    await expectAppError(
      callerFor(student).queue.join({ queueGroupId: queues[2].groupId }),
      "TOO_MANY_ACTIVE_TOKENS"
    );
  });

  it("refuses joins when the counter is paused, offline or full", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({ maxWaiting: 1 });
    await callerFor(await createUser("STUDENT")).queue.join({
      queueGroupId: groupId,
    });
    await expectAppError(
      callerFor(await createUser("STUDENT")).queue.join({
        queueGroupId: groupId,
      }),
      "QUEUE_FULL"
    );
    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[0],
      status: "PAUSED",
      reason: "Tea break",
    });
    await expectAppError(
      callerFor(await createUser("STUDENT")).queue.join({
        queueGroupId: groupId,
        counterId: counterIds[0],
      }),
      "COUNTER_UNAVAILABLE"
    );
    await expectAppError(
      callerFor(await createUser("STUDENT")).queue.join({
        queueGroupId: groupId,
      }),
      "COUNTER_UNAVAILABLE"
    );
  });

  it("assigns 'any counter' joins to the shortest line", async () => {
    const { groupId, counterIds } = await createQueue({
      counters: ["SA", "SB"],
    });
    await callerFor(await createUser("STUDENT")).queue.join({
      queueGroupId: groupId,
      counterId: counterIds[0],
    });
    const auto = await callerFor(await createUser("STUDENT")).queue.join({
      queueGroupId: groupId,
    });
    expect(auto.counterId).toBe(counterIds[1]);
  });
});

describeDb("serving tokens", () => {
  beforeEach(resetDatabase);

  it("follows WAITING → CALLED → SERVING → COMPLETED and notifies the student", async () => {
    const staff = await createUser("STAFF");
    const student = await createUser("STUDENT");
    const { groupId, counterIds } = await createQueue({ counters: ["S"] });
    await assign(staff, counterIds[0]);
    const joined = await callerFor(student).queue.join({
      queueGroupId: groupId,
    });
    const desk = callerFor(staff);

    await expectAppError(
      desk.staff.serve({ entryIds: [joined.entryId] }),
      "INVALID_TRANSITION"
    );
    const called = await desk.staff.callNext({ counterId: counterIds[0] });
    expect(called.called[0].tokenNumber).toBe("S001");
    await expectAppError(
      desk.staff.complete({ entryIds: [joined.entryId] }),
      "INVALID_TRANSITION"
    );
    await desk.staff.serve({ entryIds: [joined.entryId] });
    await desk.staff.complete({ entryIds: [joined.entryId] });
    await expectAppError(
      desk.staff.cancel({ entryIds: [joined.entryId], reason: "Too late" }),
      "INVALID_TRANSITION"
    );

    const types = (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, student.id))
    ).map(n => n.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "QUEUE_JOINED",
        "TOKEN_CALLED",
        "SERVICE_STARTED",
        "SERVICE_COMPLETED",
      ])
    );
    const history = await callerFor(student).queue.history({});
    expect(history.items[0]).toMatchObject({
      tokenNumber: "S001",
      status: "COMPLETED",
    });
  });

  it("calls one token at a time for single-capacity counters, batches for lifts", async () => {
    const admin = await createUser("ADMIN");
    const desk = await createQueue({ counters: ["D"] });
    const lift = await createQueue({ counters: ["L"], serveCapacity: 3 });
    for (let i = 0; i < 4; i++) {
      const s = await createUser("STUDENT");
      await callerFor(s).queue.join({ queueGroupId: desk.groupId });
      await callerFor(s).queue.join({ queueGroupId: lift.groupId });
    }
    await callerFor(admin).staff.callNext({ counterId: desk.counterIds[0] });
    await expectAppError(
      callerFor(admin).staff.callNext({ counterId: desk.counterIds[0] }),
      "INVALID_TRANSITION"
    );
    const batch = await callerFor(admin).staff.callNext({
      counterId: lift.counterIds[0],
    });
    expect(batch.called.map(c => c.tokenNumber)).toEqual([
      "L001",
      "L002",
      "L003",
    ]);
  });

  it("requires a reason to cancel and records it", async () => {
    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const { groupId } = await createQueue();
    const joined = await callerFor(student).queue.join({
      queueGroupId: groupId,
    });
    await expect(
      callerFor(admin).staff.cancel({ entryIds: [joined.entryId], reason: "" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await callerFor(admin).staff.cancel({
      entryIds: [joined.entryId],
      reason: "Duplicate request",
    });
    const [row] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, joined.entryId));
    expect(row).toMatchObject({
      status: "CANCELLED",
      closedReason: "Duplicate request",
    });
  });
});

describeDb("object-level authorization", () => {
  beforeEach(resetDatabase);

  it("stops staff from operating counters they are not assigned to", async () => {
    const staffA = await createUser("STAFF");
    const staffB = await createUser("STAFF");
    const qa = await createQueue({ counters: ["OA"] });
    const qb = await createQueue({ counters: ["OB"] });
    await assign(staffA, qa.counterIds[0]);
    await assign(staffB, qb.counterIds[0]);
    const student = await createUser("STUDENT");
    const joined = await callerFor(student).queue.join({
      queueGroupId: qb.groupId,
    });
    const a = callerFor(staffA);
    await expectAppError(
      a.staff.board({ counterId: qb.counterIds[0] }),
      "FORBIDDEN"
    );
    await expectAppError(
      a.staff.callNext({ counterId: qb.counterIds[0] }),
      "FORBIDDEN"
    );
    await expectAppError(
      a.staff.setPriority({
        entryId: joined.entryId,
        enabled: true,
        reason: "Medical",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      a.staff.setCounterStatus({
        counterId: qb.counterIds[0],
        status: "OFFLINE",
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      a.staff.setTraffic({
        queueGroupId: qb.groupId,
        level: "HEAVY",
        delaySeconds: 0,
      }),
      "FORBIDDEN"
    );
    await expectAppError(
      a.staff.cancel({ entryIds: [joined.entryId], reason: "Not mine" }),
      "FORBIDDEN"
    );
    expect((await a.staff.myCounters()).map(c => c.id)).toEqual([
      qa.counterIds[0],
    ]);
    // Admins may operate every counter.
    const admin = await createUser("ADMIN");
    await expect(
      callerFor(admin).staff.callNext({ counterId: qb.counterIds[0] })
    ).resolves.toBeTruthy();
  });

  it("stops a student from touching another student's token", async () => {
    const owner = await createUser("STUDENT");
    const intruder = await createUser("STUDENT");
    const { groupId } = await createQueue();
    const joined = await callerFor(owner).queue.join({ queueGroupId: groupId });
    await expectAppError(
      callerFor(intruder).queue.cancel({ entryId: joined.entryId }),
      "NOT_FOUND"
    );
    await expectAppError(
      callerFor(intruder).queue.entry({ entryId: joined.entryId }),
      "NOT_FOUND"
    );
    const [row] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, joined.entryId));
    expect(row.status).toBe("WAITING");
  });

  it("does not expose other students' identities in queue views", async () => {
    const a = await createUser("STUDENT");
    const b = await createUser("STUDENT");
    const { groupId } = await createQueue();
    await callerFor(a).queue.join({ queueGroupId: groupId });
    await callerFor(b).queue.join({ queueGroupId: groupId });
    const catalog = JSON.stringify(await callerFor(b).catalog.list());
    const mine = JSON.stringify(await callerFor(b).queue.myActive());
    for (const text of [catalog, mine]) {
      expect(text).not.toContain(a.email);
      expect(text).not.toContain(a.name);
    }
  });
});
