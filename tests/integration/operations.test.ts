import { beforeEach, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  auditLogs,
  cameraMetrics,
  cameraStations,
  counters,
  notifications,
  queueEntries,
  queueEvents,
} from "../../drizzle/schema";
import { db } from "../../server/db/client";
import {
  assign,
  callerFor,
  createQueue,
  createUser,
  describeDb,
  expectAppError,
  resetDatabase,
} from "../helpers";

async function fill(groupId: number, count: number, counterId?: number) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const student = await createUser("STUDENT");
    out.push({
      student,
      ...(await callerFor(student).queue.join({
        queueGroupId: groupId,
        counterId,
      })),
    });
  }
  return out;
}

const positions = async (
  counterId: number,
  caller: ReturnType<typeof callerFor>
) => (await caller.staff.board({ counterId })).waiting.map(w => w.tokenNumber);

describeDb("priority", () => {
  beforeEach(resetDatabase);

  it("moves a token to the front, records who/why, and tells everyone affected", async () => {
    const staff = await createUser("STAFF");
    const { groupId, counterIds } = await createQueue({ counters: ["P"] });
    await assign(staff, counterIds[0]);
    const people = await fill(groupId, 4);
    const desk = callerFor(staff);
    await expect(
      desk.staff.setPriority({
        entryId: people[3].entryId,
        enabled: true,
        reason: "  ",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const result = await desk.staff.setPriority({
      entryId: people[3].entryId,
      enabled: true,
      reason: "Medical appointment",
    });
    expect(result).toMatchObject({ previousPosition: 4, newPosition: 1 });
    expect(await positions(counterIds[0], desk)).toEqual([
      "P004",
      "P001",
      "P002",
      "P003",
    ]);

    const note = async (userId: number) =>
      db.select().from(notifications).where(eq(notifications.userId, userId));
    expect((await note(people[3].student.id)).map(n => n.type)).toContain(
      "PRIORITY_ASSIGNED"
    );
    for (const p of people.slice(0, 3)) {
      const adjust = (await note(p.student.id)).find(
        n => n.type === "PRIORITY_ADJUSTMENT"
      );
      expect(adjust?.message).toMatch(/priority adjustment.*now position \d/);
    }
    const [event] = await db
      .select()
      .from(queueEvents)
      .where(eq(queueEvents.type, "PRIORITY_ASSIGNED"));
    expect(event).toMatchObject({
      actorUserId: staff.id,
      queueEntryId: people[3].entryId,
    });
    expect(event.metadata).toMatchObject({
      reason: "Medical appointment",
      previousPosition: 4,
      newPosition: 1,
    });
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "queue.priority_assigned"));
    expect(log.actorUserId).toBe(staff.id);

    // The student sees the authoritative new position.
    const mine = await callerFor(people[0].student).queue.myActive();
    expect(mine.entries[0].position).toBe(2);

    await desk.staff.setPriority({
      entryId: people[3].entryId,
      enabled: false,
      reason: "Resolved",
    });
    expect(await positions(counterIds[0], desk)).toEqual([
      "P001",
      "P002",
      "P003",
      "P004",
    ]);
  });

  it("keeps positions consistent when several tokens have priority", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({ counters: ["Z"] });
    const people = await fill(groupId, 5);
    await callerFor(admin).staff.setPriority({
      entryId: people[4].entryId,
      enabled: true,
      reason: "Accessibility",
    });
    await callerFor(admin).staff.setPriority({
      entryId: people[2].entryId,
      enabled: true,
      reason: "Exam in 10 min",
    });
    const board = await callerFor(admin).staff.board({
      counterId: counterIds[0],
    });
    expect(board.waiting.map(w => [w.tokenNumber, w.position])).toEqual([
      ["Z005", 1],
      ["Z003", 2],
      ["Z001", 3],
      ["Z002", 4],
      ["Z004", 5],
    ]);
  });
});

describeDb("merging queues", () => {
  beforeEach(resetDatabase);

  it("merges an unavailable counter by alternating, without losing a single entry", async () => {
    const staff = await createUser("STAFF");
    const { groupId, counterIds } = await createQueue({ counters: ["A", "B"] });
    await assign(staff, counterIds[1]);
    await fill(groupId, 3, counterIds[0]);
    const fromB = await fill(groupId, 2, counterIds[1]);
    const desk = callerFor(staff);

    const result = await desk.staff.setCounterStatus({
      counterId: counterIds[1],
      status: "OFFLINE",
      reason: "Printer jam",
      mergeIntoCounterId: counterIds[0],
    });
    expect(result.moved).toBe(2);
    const admin = await createUser("ADMIN");
    expect(await positions(counterIds[0], callerFor(admin))).toEqual([
      "A001",
      "B001",
      "A002",
      "B002",
      "A003",
    ]);

    const all = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.queueGroupId, groupId));
    expect(all).toHaveLength(5);
    expect(
      all.every(e => e.status === "WAITING" && e.counterId === counterIds[0])
    ).toBe(true);
    // Provenance is preserved.
    expect(
      all
        .filter(e => e.originalCounterId === counterIds[1])
        .map(e => e.tokenNumber)
        .sort()
    ).toEqual(["B001", "B002"]);
    const [b] = await db
      .select()
      .from(counters)
      .where(eq(counters.id, counterIds[1]));
    expect(b).toMatchObject({
      status: "OFFLINE",
      mergedIntoCounterId: counterIds[0],
    });
    expect(
      await db.select().from(queueEvents).where(eq(queueEvents.type, "MERGED"))
    ).toHaveLength(2);

    const merged = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, fromB[0].student.id),
          eq(notifications.type, "QUEUE_MERGED")
        )
      );
    expect(merged[0].message).toContain("Printer jam");
    expect(merged[0].message).toContain("position 2");
    const mine = await callerFor(fromB[1].student).queue.myActive();
    expect(mine.entries[0]).toMatchObject({
      position: 4,
      movedFrom: "Counter B",
      counter: { name: "Counter A" },
    });

    // New joins go to the counter that is still open.
    const late = await callerFor(await createUser("STUDENT")).queue.join({
      queueGroupId: groupId,
    });
    expect(late.counterId).toBe(counterIds[0]);
  });

  it("re-queues called tokens and refuses to merge while someone is being served", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({ counters: ["M", "N"] });
    await fill(groupId, 1, counterIds[0]);
    const onN = await fill(groupId, 2, counterIds[1]);
    const desk = callerFor(admin);
    await desk.staff.callNext({ counterId: counterIds[1] });
    await desk.staff.serve({ entryIds: [onN[0].entryId] });
    await expectAppError(
      desk.staff.merge({
        sourceCounterId: counterIds[1],
        targetCounterId: counterIds[0],
        reason: "Closing",
      }),
      "INVALID_TRANSITION"
    );
    await desk.staff.complete({ entryIds: [onN[0].entryId] });
    await desk.staff.callNext({ counterId: counterIds[1] });
    await desk.staff.merge({
      sourceCounterId: counterIds[1],
      targetCounterId: counterIds[0],
      reason: "Closing",
      strategy: "APPEND",
    });
    expect(await positions(counterIds[0], desk)).toEqual(["M001", "N002"]);
  });

  it("refuses merges across queue groups", async () => {
    const admin = await createUser("ADMIN");
    const q1 = await createQueue({ counters: ["X1"] });
    const q2 = await createQueue({ counters: ["X2"] });
    await expectAppError(
      callerFor(admin).staff.merge({
        sourceCounterId: q1.counterIds[0],
        targetCounterId: q2.counterIds[0],
        reason: "Nope",
      }),
      "VALIDATION"
    );
  });
});

describeDb("traffic and counter status", () => {
  beforeEach(resetDatabase);

  it("recalculates estimates on heavy traffic and explains the change", async () => {
    const staff = await createUser("STAFF");
    const { groupId, counterIds } = await createQueue({
      counters: ["W"],
      averageServiceSeconds: 120,
    });
    await assign(staff, counterIds[0]);
    const people = await fill(groupId, 4);
    const before = (await callerFor(people[3].student).queue.myActive())
      .entries[0].estimatedWaitSeconds;
    expect(before).toBe(360);
    await callerFor(staff).staff.setTraffic({
      queueGroupId: groupId,
      level: "HEAVY",
      delaySeconds: 300,
      reason: "Lunch rush",
    });
    const after = (await callerFor(people[3].student).queue.myActive())
      .entries[0];
    expect(after.estimatedWaitSeconds).toBe(3 * 180 + 300);
    expect(after.traffic).toMatchObject({
      staffLevel: "HEAVY",
      effectiveLevel: "HEAVY",
      delaySeconds: 300,
      reason: "Lunch rush",
    });
    const [note] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, people[3].student.id),
          eq(notifications.type, "WAIT_INCREASED")
        )
      );
    expect(note.message).toBe(
      "Estimated wait increased from 6 to 14 minutes due to heavier traffic (Lunch rush)."
    );
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "queue.traffic_updated"));
    expect(log.metadata).toMatchObject({
      to: { level: "HEAVY", delaySeconds: 300 },
    });
  });

  it("pauses and resumes a counter, keeping places and telling waiting students", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({ counters: ["R"] });
    const [person] = await fill(groupId, 1);
    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[0],
      status: "PAUSED",
      reason: "Shift change",
    });
    await expectAppError(
      callerFor(admin).staff.callNext({ counterId: counterIds[0] }),
      "COUNTER_UNAVAILABLE"
    );
    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[0],
      status: "OPEN",
    });
    const types = (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, person.student.id))
    ).map(n => n.type);
    expect(types).toEqual(
      expect.arrayContaining(["COUNTER_PAUSED", "COUNTER_RESUMED"])
    );
    expect(
      (await callerFor(person.student).queue.myActive()).entries[0].status
    ).toBe("WAITING");
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(inArray(auditLogs.action, ["counter.paused", "counter.resumed"]))
    ).toHaveLength(2);
  });

  it("sends the one-time 'almost your turn' alert as the line moves", async () => {
    const admin = await createUser("ADMIN");
    const { groupId, counterIds } = await createQueue({ counters: ["N"] });
    const people = await fill(groupId, 5);
    const almost = async (i: number) =>
      (
        await db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, people[i].student.id),
              eq(notifications.type, "ALMOST_NEXT")
            )
          )
      ).length;
    expect(await almost(4)).toBe(0);
    for (let i = 0; i < 2; i++) {
      const called = await callerFor(admin).staff.callNext({
        counterId: counterIds[0],
      });
      await callerFor(admin).staff.serve({ entryIds: [called.called[0].id] });
      await callerFor(admin).staff.complete({
        entryIds: [called.called[0].id],
      });
    }
    expect(await almost(4)).toBe(1);
    await callerFor(admin).staff.callNext({ counterId: counterIds[0] });
    expect(await almost(4)).toBe(1);
  });
});

describeDb("camera signal", () => {
  beforeEach(resetDatabase);

  it("stores aggregates only, raises traffic for camera-assisted queues, and goes stale", async () => {
    const staff = await createUser("STAFF");
    const { groupId, counterIds } = await createQueue({
      counters: ["V"],
      cameraAssist: true,
    });
    await assign(staff, counterIds[0]);
    const [station] = await db
      .insert(cameraStations)
      .values({
        name: "Lobby",
        queueGroupId: groupId,
        roi: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      })
      .$returningId();
    const student = await createUser("STUDENT");
    await callerFor(student).queue.join({ queueGroupId: groupId });

    const outsider = await createUser("STAFF");
    await expectAppError(
      callerFor(outsider).camera.report({
        stationId: station.id,
        peopleCount: 3,
        rawDetections: 4,
      }),
      "FORBIDDEN"
    );

    const result = await callerFor(staff).camera.report({
      stationId: station.id,
      peopleCount: 14,
      rawDetections: 15,
    });
    expect(result.trafficLevel).toBe("HEAVY");
    const metrics = await db.select().from(cameraMetrics);
    expect(Object.keys(metrics[0]).sort()).toEqual([
      "cameraStationId",
      "capturedAt",
      "id",
      "peopleCount",
      "rawDetections",
      "trafficLevel",
    ]);

    let catalog = await callerFor(student).catalog.list();
    let group = catalog.services[0].groups[0];
    expect(group.camera).toMatchObject({
      peopleCount: 14,
      fresh: true,
      level: "HEAVY",
    });
    expect(group.traffic.effectiveLevel).toBe("HEAVY");
    // Camera people are never added to the digital queue length.
    expect(group.waiting).toBe(1);

    await db
      .update(cameraStations)
      .set({ lastReportedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(cameraStations.id, station.id));
    catalog = await callerFor(student).catalog.list();
    group = catalog.services[0].groups[0];
    expect(group.camera?.fresh).toBe(false);
    expect(group.traffic.effectiveLevel).toBe("NORMAL");
  });
});
