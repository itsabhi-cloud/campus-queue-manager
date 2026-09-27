import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, queueEntries, staffCounterAssignments, users } from "../../drizzle/schema";
import { db } from "../../server/db/client";
import { anonymousCaller, callerFor, createQueue, createUser, describeDb, expectAppError, resetDatabase } from "../helpers";

const CSV = [
  "Name,Email,College ID,Department,Phone",
  "Asha Rao,asha@campus.edu,CS-2024-001,Computer Science,+91 98450 11111",
  "Bilal Khan,bilal@campus.edu,CS-2024-002,,",
  "Bad Email,not-an-email,CS-2024-003,,",
  "Dup In File,asha@campus.edu,CS-2024-004,,",
  "Existing,existing@campus.edu,CS-2024-005,,",
  '"Chen, Li",chen@campus.edu,CS-2024-006,"Electronics, VLSI",',
].join("\n");

describeDb("bulk student import", () => {
  beforeEach(resetDatabase);

  it("previews without writing, reporting invalid, duplicate and existing rows", async () => {
    const admin = await createUser("ADMIN");
    await createUser("STUDENT", { email: "existing@campus.edu" });
    const preview = await callerFor(admin).admin.users.previewImport({ csv: CSV });
    expect(preview.summary).toEqual({ total: 6, valid: 3, invalid: 1, duplicateInFile: 1, alreadyExists: 1 });
    expect(preview.rows.find(r => r.line === 4)?.errors.join()).toContain("email");
    expect(preview.rows.find(r => r.line === 7)?.data).toMatchObject({ name: "Chen, Li", department: "Electronics, VLSI", collegeId: "CS-2024-006" });
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("imports valid rows atomically, issues activation codes, and audits the import", async () => {
    const admin = await createUser("ADMIN");
    const result = await callerFor(admin).admin.users.commitImport({ csv: CSV });
    expect(result.created).toBe(4);
    expect(result.codes.map(c => c.email).sort()).toEqual(["asha@campus.edu", "bilal@campus.edu", "chen@campus.edu", "existing@campus.edu"]);
    const imported = await db.select().from(users).where(eq(users.email, "asha@campus.edu"));
    expect(imported[0]).toMatchObject({ role: "STUDENT", status: "PENDING", passwordHash: null });
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "user.bulk_import"));
    expect(log.metadata).toMatchObject({ created: 4 });
    expect(JSON.stringify(log.metadata)).not.toContain(result.codes[0].code);

    const code = result.codes.find(c => c.email === "bilal@campus.edu")!.code;
    const me = await anonymousCaller().caller.auth.activate({ email: "bilal@campus.edu", code, password: "Welcome-to-campus-1" });
    expect(me).toMatchObject({ role: "STUDENT", status: "ACTIVE" });

    // Re-importing the same file creates nothing new.
    await expectAppError(callerFor(admin).admin.users.commitImport({ csv: CSV }), "VALIDATION");
  });

  it("rejects files without the required columns", async () => {
    const admin = await createUser("ADMIN");
    await expectAppError(callerFor(admin).admin.users.previewImport({ csv: "name,phone\nA,1" }), "VALIDATION");
  });
});

describeDb("user administration", () => {
  beforeEach(resetDatabase);

  it("creates staff who cannot self-assign, and admins assign counters", async () => {
    const admin = await createUser("ADMIN");
    const created = await callerFor(admin).admin.users.create({ role: "STAFF", name: "Desk Officer", email: "desk@campus.edu", employeeId: "E-1" });
    await anonymousCaller().caller.auth.activate({ email: "desk@campus.edu", code: created.code, password: "Desk-officer-2026" });
    const [staff] = await db.select().from(users).where(eq(users.id, created.userId));
    const staffUser = { id: staff.id, email: staff.email, name: staff.name, role: staff.role, status: staff.status };
    const { counterIds } = await createQueue({ counters: ["K1", "K2"] });
    await expectAppError(callerFor(staffUser).admin.catalog.setAssignments({ staffUserId: staff.id, counterIds }), "FORBIDDEN");
    await callerFor(admin).admin.catalog.setAssignments({ staffUserId: staff.id, counterIds: [counterIds[1]] });
    expect((await callerFor(staffUser).staff.myCounters()).map(c => c.id)).toEqual([counterIds[1]]);
    expect(await db.select().from(staffCounterAssignments)).toHaveLength(1);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "assignment.changed"));
    expect(log.metadata).toMatchObject({ before: [], after: [counterIds[1]] });
  });

  it("suspending a student cancels their active tokens", async () => {
    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const { groupId } = await createQueue();
    const joined = await callerFor(student).queue.join({ queueGroupId: groupId });
    const result = await callerFor(admin).admin.users.setStatus({ userId: student.id, status: "SUSPENDED", reason: "ID verification" });
    expect(result.cancelledTokens).toBe(1);
    const [entry] = await db.select().from(queueEntries).where(eq(queueEntries.id, joined.entryId));
    expect(entry).toMatchObject({ status: "CANCELLED", closedReason: "Account suspended" });
  });

  it("rejects duplicate emails and college IDs with clear errors", async () => {
    const admin = await createUser("ADMIN");
    await callerFor(admin).admin.users.create({ role: "STUDENT", name: "One", email: "one@campus.edu", collegeId: "DUP-1" });
    await expectAppError(callerFor(admin).admin.users.create({ role: "STUDENT", name: "Two", email: "one@campus.edu", collegeId: "DUP-2" }), "CONFLICT");
    await expectAppError(callerFor(admin).admin.users.create({ role: "STUDENT", name: "Three", email: "three@campus.edu", collegeId: "DUP-1" }), "CONFLICT");
  });

  it("manages the service catalogue and blocks unsafe changes", async () => {
    const admin = await createUser("ADMIN");
    const caller = callerFor(admin);
    const { id: serviceId } = await caller.admin.catalog.upsertService({ slug: "printing", name: "Printing", description: "Print centre", kind: "PRINTING", isActive: true, displayOrder: 0 });
    const { id: groupId } = await caller.admin.catalog.upsertGroup({
      serviceId,
      slug: "xerox",
      name: "Xerox",
      unitLabel: "jobs",
      averageServiceSeconds: 90,
      serveCapacity: 1,
      maxWaiting: 100,
      mergeStrategy: "ALTERNATE",
      cameraAssist: false,
      cameraModerateAt: 6,
      cameraHeavyAt: 12,
      isActive: true,
      displayOrder: 0,
    });
    const { id: counterId } = await caller.admin.catalog.upsertCounter({ queueGroupId: groupId, name: "Xerox 1", tokenPrefix: "x", isActive: true, displayOrder: 0 });
    await expectAppError(caller.admin.catalog.upsertCounter({ queueGroupId: groupId, name: "Xerox 2", tokenPrefix: "X", isActive: true, displayOrder: 1 }), "CONFLICT");
    const student = await createUser("STUDENT");
    await callerFor(student).queue.join({ queueGroupId: groupId });
    await expectAppError(caller.admin.catalog.upsertCounter({ id: counterId, queueGroupId: groupId, name: "Xerox 1", tokenPrefix: "Y", isActive: true, displayOrder: 0 }), "CONFLICT");
    await expectAppError(caller.admin.catalog.upsertCounter({ id: counterId, queueGroupId: groupId, name: "Xerox 1", tokenPrefix: "X", isActive: false, displayOrder: 0 }), "CONFLICT");
    const catalog = await callerFor(student).catalog.list();
    expect(catalog.services[0].groups[0].counters[0]).toMatchObject({ name: "Xerox 1", tokenPrefix: "X", waiting: 1 });
  });
});
