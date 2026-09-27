import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { notifications, queueEntries } from "../../drizzle/schema";
import { db } from "../../server/db/client";
import { recalculateGroups } from "../../server/queue/engine";
import {
  callerFor,
  createQueue,
  createUser,
  describeDb,
  expectAppError,
  resetDatabase,
} from "../helpers";

describeDb("student account features", () => {
  beforeEach(resetDatabase);

  it("lets students read and clear only their own notifications", async () => {
    const a = await createUser("STUDENT");
    const b = await createUser("STUDENT");
    const { groupId } = await createQueue();
    await callerFor(a).queue.join({ queueGroupId: groupId });
    const mine = await callerFor(a).notifications.list({});
    expect(mine.items).toHaveLength(1);
    expect((await callerFor(a).notifications.unreadCount()).count).toBe(1);
    // Another student's mark-read request is silently scoped to their own rows.
    await callerFor(b).notifications.markRead({ ids: [mine.items[0].id] });
    expect((await callerFor(a).notifications.unreadCount()).count).toBe(1);
    await callerFor(a).notifications.markRead({ ids: [mine.items[0].id] });
    expect((await callerFor(a).notifications.unreadCount()).count).toBe(0);
    expect((await callerFor(b).notifications.list({})).items).toHaveLength(0);
  });

  it("respects notification preferences for informational alerts only", async () => {
    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    await callerFor(student).profile.update({
      preferences: {
        almostNext: true,
        positionChanges: true,
        waitChanges: false,
        counterStatus: false,
        almostNextThreshold: 2,
      },
    });
    const { groupId, counterIds } = await createQueue({ counters: ["PF"] });
    for (let i = 0; i < 3; i++)
      await callerFor(await createUser("STUDENT")).queue.join({
        queueGroupId: groupId,
      });
    await callerFor(student).queue.join({ queueGroupId: groupId });
    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[0],
      status: "PAUSED",
    });
    await callerFor(admin).staff.setTraffic({
      queueGroupId: groupId,
      level: "HEAVY",
      delaySeconds: 600,
    });
    await callerFor(admin).staff.setCounterStatus({
      counterId: counterIds[0],
      status: "OPEN",
    });
    const types = (
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, student.id))
    ).map(n => n.type);
    expect(types).not.toContain("COUNTER_PAUSED");
    expect(types).not.toContain("WAIT_INCREASED");
    expect(types).toContain("QUEUE_JOINED");
  });

  it("validates profile photos and never lets identity fields change", async () => {
    const student = await createUser("STUDENT", { collegeId: "ID-KEEP-1" });
    const caller = callerFor(student);
    await expect(
      caller.profile.setAvatar({
        dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.profile.setAvatar({ dataUrl: "javascript:alert(1)" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.profile.setAvatar({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
    });
    const profile = await caller.profile.update({
      phone: "+91 98450 00000",
      department: "Physics",
    });
    expect(profile).toMatchObject({
      avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      student: {
        collegeId: "ID-KEEP-1",
        phone: "+91 98450 00000",
        department: "Physics",
      },
    });
    await expect(
      caller.profile.update({ phone: "call me maybe" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not let a student cancel a token that is being served", async () => {
    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const { groupId, counterIds } = await createQueue();
    const joined = await callerFor(student).queue.join({
      queueGroupId: groupId,
    });
    await callerFor(admin).staff.callNext({ counterId: counterIds[0] });
    await callerFor(admin).staff.serve({ entryIds: [joined.entryId] });
    await expectAppError(
      callerFor(student).queue.cancel({ entryId: joined.entryId }),
      "INVALID_TRANSITION"
    );
  });

  it("refreshes stale estimates during periodic recalculation", async () => {
    const { groupId } = await createQueue({ averageServiceSeconds: 300 });
    const people = [];
    for (let i = 0; i < 3; i++) {
      const s = await createUser("STUDENT");
      people.push(await callerFor(s).queue.join({ queueGroupId: groupId }));
    }
    // Pretend the stored estimate was computed 10 minutes ago and has fully counted down.
    await db
      .update(queueEntries)
      .set({ estimateUpdatedAt: new Date(Date.now() - 600_000) })
      .where(eq(queueEntries.id, people[2].entryId));
    await recalculateGroups([groupId]);
    const [row] = await db
      .select()
      .from(queueEntries)
      .where(eq(queueEntries.id, people[2].entryId));
    expect(row.estimatedWaitSeconds).toBe(600);
    expect(Date.now() - row.estimateUpdatedAt.getTime()).toBeLessThan(5_000);
  });
});
