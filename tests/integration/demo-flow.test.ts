/**
 * The full demonstration sequence as an automated end-to-end test: real HTTP, real session cookies,
 * one realtime stream per user, and a fresh database. Each step asserts both the API state and the
 * realtime events the affected browser would receive.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { auditLogs, queueEntries, queueEvents } from "../../drizzle/schema";
import { db } from "../../server/db/client";
import { assign, createQueue, createUser, describeDb, resetDatabase } from "../helpers";
import { Session, startServer } from "../httpHelpers";

type Joined = { entryId: number; tokenNumber: string; counterId: number; position: number; peopleAhead: number; estimatedWaitSeconds: number };
type Mine = { entries: Array<{ id: number; tokenNumber: string; status: string; position: number; peopleAhead: number; estimatedWaitSeconds: number; isPriority: boolean; movedFrom: string | null; counter: { name: string; status: string }; traffic: { effectiveLevel: string; reason: string | null } }> };
type Board = { waiting: Array<{ id: number; tokenNumber: string; position: number }>; inProgress: Array<{ id: number; tokenNumber: string; status: string; holderName: string }> };

let server: Awaited<ReturnType<typeof startServer>>;
const sessions: Session[] = [];

describeDb("demonstration flow over HTTP and realtime", () => {
  beforeAll(async () => {
    await resetDatabase();
    server = await startServer();
  });
  afterAll(async () => {
    sessions.forEach(s => s.close());
    await server?.stop();
  });

  it("runs the full student / staff / admin sequence", async () => {
    // Fixtures: an administration desk, and report printing with counters A and B.
    const admin = await createUser("ADMIN");
    const deskStaff = await createUser("STAFF");
    const printStaff = await createUser("STAFF");
    const [ada, ben, cal, dia] = [await createUser("STUDENT"), await createUser("STUDENT"), await createUser("STUDENT"), await createUser("STUDENT")];
    const desk = await createQueue({ counters: ["AD"], averageServiceSeconds: 120 });
    const print = await createQueue({ counters: ["RA", "RB"], averageServiceSeconds: 300 });
    await assign(deskStaff, desk.counterIds[0]);
    await assign(printStaff, print.counterIds[0]);
    await assign(printStaff, print.counterIds[1]);

    // Step 1: users sign in, each in their own "browser" with its own realtime stream.
    const student = await new Session(server.base).login(ada.email);
    const other = await new Session(server.base).login(ben.email);
    const staffA = await new Session(server.base).login(deskStaff.email);
    const staffP = await new Session(server.base).login(printStaff.email);
    const adminS = await new Session(server.base).login(admin.email);
    sessions.push(student, other, staffA, staffP, adminS);
    await Promise.all(sessions.map(s => s.listen()));

    // Step 2: campus services come from the backend.
    const catalog = await student.query<{ services: Array<{ groups: Array<{ id: number }> }> }>("catalog.list");
    expect(catalog.services.flatMap(s => s.groups.map(g => g.id))).toEqual(expect.arrayContaining([desk.groupId, print.groupId]));

    // Steps 3–5: join behind another student; token, people ahead and estimate are server-computed.
    await other.mutate<Joined>("queue.join", { queueGroupId: desk.groupId });
    const joined = await student.mutate<Joined>("queue.join", { queueGroupId: desk.groupId });
    expect(joined).toMatchObject({ tokenNumber: "AD002", position: 2, peopleAhead: 1, estimatedWaitSeconds: 120 });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "QUEUE_JOINED");

    // Step 6: staff sees both tokens (and no student identities in the waiting line).
    await staffA.waitFor(e => e.type === "queue.changed" && e.counterIds.includes(desk.counterIds[0]));
    const board = await staffA.query<Board>("staff.board", { counterId: desk.counterIds[0] });
    expect(board.waiting.map(w => w.tokenNumber)).toEqual(["AD001", "AD002"]);
    expect(JSON.stringify(board.waiting)).not.toContain(ada.email);

    // Steps 7–8: staff calls next; the student's position updates live.
    const before = student.events.length;
    await staffA.mutate("staff.callNext", { counterId: desk.counterIds[0] });
    await other.waitFor(e => e.type === "notification.created" && e.notificationType === "TOKEN_CALLED");
    await student.waitFor(e => e.type === "queue.changed" && student.events.indexOf(e) >= before);
    let mine = await student.query<Mine>("queue.myActive");
    expect(mine.entries[0]).toMatchObject({ tokenNumber: "AD002", position: 1, peopleAhead: 0 });
    // Joined already within the "almost next" threshold, so no redundant alert follows "you're in".
    expect(student.notificationTypes()).not.toContain("ALMOST_NEXT");

    // Steps 9–12: finish the first student, call ours, serve and complete.
    const firstCalled = (await staffA.query<Board>("staff.board", { counterId: desk.counterIds[0] })).inProgress[0];
    await staffA.mutate("staff.serve", { entryIds: [firstCalled.id] });
    await staffA.mutate("staff.complete", { entryIds: [firstCalled.id] });
    await staffA.mutate("staff.callNext", { counterId: desk.counterIds[0] });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "TOKEN_CALLED");
    expect((await student.query<Mine>("queue.myActive")).entries[0].status).toBe("CALLED");
    await staffA.mutate("staff.serve", { entryIds: [joined.entryId] });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "SERVICE_STARTED");
    expect((await student.query<Mine>("queue.myActive")).entries[0].status).toBe("SERVING");
    await staffA.mutate("staff.complete", { entryIds: [joined.entryId] });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "SERVICE_COMPLETED");
    expect((await student.query<Mine>("queue.myActive")).entries).toHaveLength(0);
    const history = await student.query<{ items: Array<{ tokenNumber: string; status: string }> }>("queue.history", {});
    expect(history.items[0]).toMatchObject({ tokenNumber: "AD002", status: "COMPLETED" });

    // Step 13: a second queue, printing counter B, with others already waiting there.
    const cSession = await new Session(server.base).login(cal.email);
    const dSession = await new Session(server.base).login(dia.email);
    sessions.push(cSession, dSession);
    await Promise.all([cSession.listen(), dSession.listen()]);
    await cSession.mutate("queue.join", { queueGroupId: print.groupId, counterId: print.counterIds[1] });
    await dSession.mutate("queue.join", { queueGroupId: print.groupId, counterId: print.counterIds[1] });
    const rb = await student.mutate<Joined>("queue.join", { queueGroupId: print.groupId, counterId: print.counterIds[1] });
    expect(rb).toMatchObject({ tokenNumber: "RB003", position: 3, estimatedWaitSeconds: 600 });
    await other.mutate("queue.join", { queueGroupId: print.groupId, counterId: print.counterIds[0] });

    // Steps 14–15: heavy traffic plus a delay changes the estimate, with an explanation.
    await staffP.mutate("staff.setTraffic", { queueGroupId: print.groupId, level: "HEAVY", delaySeconds: 300, reason: "Lunch rush" });
    const waitUp = await student.waitFor(e => e.type === "notification.created" && e.notificationType === "WAIT_INCREASED");
    expect(waitUp.type === "notification.created" && waitUp.message).toBe("Estimated wait increased from 10 to 20 minutes due to heavier traffic (Lunch rush).");
    mine = await student.query<Mine>("queue.myActive");
    expect(mine.entries[0]).toMatchObject({ estimatedWaitSeconds: 2 * 450 + 300, traffic: { effectiveLevel: "HEAVY", reason: "Lunch rush" } });

    // Steps 16–18: priority for our student; the two ahead are told their position changed.
    const priority = await staffP.mutate<{ previousPosition: number; newPosition: number }>("staff.setPriority", { entryId: rb.entryId, enabled: true, reason: "Exam submission in 15 min" });
    expect(priority).toEqual({ tokenNumber: "RB003", previousPosition: 3, newPosition: 1 });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "PRIORITY_ASSIGNED");
    await cSession.waitFor(e => e.type === "notification.created" && e.notificationType === "PRIORITY_ADJUSTMENT");
    await dSession.waitFor(e => e.type === "notification.created" && e.notificationType === "PRIORITY_ADJUSTMENT");
    const rbBoard = await staffP.query<Board>("staff.board", { counterId: print.counterIds[1] });
    expect(rbBoard.waiting.map(w => [w.tokenNumber, w.position])).toEqual([
      ["RB003", 1],
      ["RB001", 2],
      ["RB002", 3],
    ]);

    // Steps 19–21: counter B goes offline and merges into A; nothing is lost; everyone is told.
    const merge = await staffP.mutate<{ moved: number; strategy: string }>("staff.setCounterStatus", { counterId: print.counterIds[1], status: "OFFLINE", reason: "Printer jam", mergeIntoCounterId: print.counterIds[0] });
    expect(merge).toMatchObject({ moved: 3, strategy: "ALTERNATE" });
    for (const s of [student, cSession, dSession]) await s.waitFor(e => e.type === "notification.created" && e.notificationType === "QUEUE_MERGED");
    const merged = await staffP.query<Board>("staff.board", { counterId: print.counterIds[0] });
    expect(merged.waiting.map(w => w.tokenNumber)).toEqual(["RB003", "RA001", "RB001", "RB002"]);
    const rows = await db.select().from(queueEntries).where(eq(queueEntries.queueGroupId, print.groupId));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map(r => r.tokenNumber)).size).toBe(4);
    mine = await student.query<Mine>("queue.myActive");
    expect(mine.entries[0]).toMatchObject({ tokenNumber: "RB003", position: 1, movedFrom: "Counter RB", counter: { name: "Counter RA" } });

    // Steps 22–23: pause/resume counter A and reopen counter B; places are kept.
    await staffP.mutate("staff.setCounterStatus", { counterId: print.counterIds[0], status: "PAUSED", reason: "Paper refill" });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "COUNTER_PAUSED");
    await staffP.mutate("staff.setCounterStatus", { counterId: print.counterIds[0], status: "OPEN" });
    await student.waitFor(e => e.type === "notification.created" && e.notificationType === "COUNTER_RESUMED");
    await staffP.mutate("staff.setCounterStatus", { counterId: print.counterIds[1], status: "OPEN" });
    const reopened = await staffP.query<Board>("staff.board", { counterId: print.counterIds[1] });
    expect(reopened.waiting).toHaveLength(0);
    expect((await staffP.query<Board>("staff.board", { counterId: print.counterIds[0] })).waiting).toHaveLength(4);

    // Staff scope still holds mid-demo: desk staff cannot touch printing.
    await expect(staffA.mutate("staff.callNext", { counterId: print.counterIds[0] })).rejects.toMatchObject({ appCode: "FORBIDDEN", httpStatus: 403 });

    // Step 25: the admin sees the operations in the audit log and metrics that match the database.
    const audit = await adminS.query<{ rows: Array<{ log: { action: string; actorUserId: number } }> }>("admin.audit", { page: 1, pageSize: 30 });
    const actions = audit.rows.map(r => r.log.action);
    expect(actions).toEqual(expect.arrayContaining(["queue.traffic_updated", "queue.priority_assigned", "queue.merged", "counter.paused", "counter.resumed"]));
    expect(audit.rows.find(r => r.log.action === "queue.merged")?.log.actorUserId).toBe(printStaff.id);
    const overview = await adminS.query<{ live: { waiting: number; countersOffline: number }; today: { completed: number; joined: number } }>("admin.overview");
    const all = await db.select().from(queueEntries);
    expect(overview.live.waiting).toBe(all.filter(e => e.status === "WAITING").length);
    expect(overview.today.completed).toBe(all.filter(e => e.status === "COMPLETED").length);
    expect(overview.today.joined).toBe(all.length);
    expect(overview.live.countersOffline).toBe(0);
    await adminS.waitFor(e => e.type === "queue.changed");

    // Isolation: no student received another student's notification.
    const ours = await db.select().from(queueEvents).where(inArray(queueEvents.type, ["PRIORITY_ASSIGNED"]));
    expect(ours).toHaveLength(1);
    expect(other.notificationTypes()).not.toContain("PRIORITY_ASSIGNED");
    expect(staffP.notificationTypes()).toHaveLength(0);
    expect(await db.select().from(auditLogs)).not.toHaveLength(0);
  });
});
