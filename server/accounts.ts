/** Authentication and account administration. */
import type { Request, Response } from "express";
import { and, asc, count, eq, gt, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccountStatus, AuthCodePurpose, Role } from "../shared/domain";
import {
  authCodes,
  notificationPreferences,
  staffCounterAssignments,
  staffProfiles,
  studentProfiles,
  userAvatars,
  users,
} from "../drizzle/schema";
import { passwordSchema, hashPassword, verifyPassword } from "./auth/password";
import { createSession, revokeAllSessions, type SessionUser } from "./auth/sessions";
import { digest, newActivationCode, normalizeActivationCode } from "./auth/tokens";
import { fail } from "./_core/errors";
import { limiters } from "./_core/rateLimit";
import { db, isDuplicateKeyError, withTransaction, type Executor, type Tx } from "./db/client";
import { audit } from "./lib/audit";
import { parseCsv } from "./lib/csv";
import { Effects } from "./lib/effects";
import { emailDomainAllowed, getSettings } from "./lib/settings";
import { cancelAllForUser } from "./queue/engine";
import { broker } from "./realtime/broker";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(254));
export const nameSchema = z.string().trim().min(2, "Name is too short.").max(120);
export const collegeIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9/-]{2,39}$/, "College ID may contain letters, digits, '-' and '/' (3–40 characters).");
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number.")
  .nullable()
  .optional();
export const departmentSchema = z.string().trim().min(2).max(120).nullable().optional();

export function publicUser(user: SessionUser) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status };
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export async function login(input: { email: string; password: string }, req: Request, res: Response) {
  const ip = (req.ip ?? "unknown").slice(0, 64);
  const waitMs = limiters.loginByIp.consume(ip);
  if (waitMs > 0) fail("RATE_LIMITED", `Too many sign-in attempts. Try again in ${Math.ceil(waitMs / 60_000)} minute(s).`);

  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now) {
    fail("ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000)} minute(s).`);
  }
  const valid = await verifyPassword(input.password, user?.passwordHash);
  if (!user || !valid) {
    if (user) {
      const failures = user.failedLoginCount + 1;
      const locked = failures >= MAX_FAILED_LOGINS;
      await db
        .update(users)
        .set(locked ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) } : { failedLoginCount: failures })
        .where(eq(users.id, user.id));
      if (locked) await audit(db, { actorUserId: user.id, action: "auth.locked_out", entityType: "user", entityId: user.id, ip });
    }
    fail("INVALID_CREDENTIALS", "Incorrect email or password.");
  }
  if (user.status !== "ACTIVE") {
    fail(
      "ACCOUNT_INACTIVE",
      user.status === "PENDING"
        ? "This account hasn't been activated yet. Use your activation code first."
        : "This account is not active. Please contact the administration office."
    );
  }
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastSignedInAt: now }).where(eq(users.id, user.id));
  await createSession(user.id, req, res);
  limiters.loginByIp.reset(ip);
  return publicUser(user);
}

/** Creates a one-time code (shown to the admin exactly once) and invalidates older unused codes. */
export async function issueAuthCode(tx: Tx, userId: number, purpose: AuthCodePurpose, actorUserId: number | null) {
  const settings = await getSettings();
  await tx.delete(authCodes).where(and(eq(authCodes.userId, userId), isNull(authCodes.usedAt)));
  const code = newActivationCode();
  const expiresAt = new Date(Date.now() + settings.activationCodeDays * 86_400_000);
  await tx.insert(authCodes).values({ userId, codeHash: digest(code), purpose, expiresAt, createdByUserId: actorUserId });
  return { code, expiresAt, purpose };
}

export async function activate(input: { email: string; code: string; password: string }, req: Request, res: Response) {
  const ip = (req.ip ?? "unknown").slice(0, 64);
  const waitMs = limiters.activationByIp.consume(ip);
  if (waitMs > 0) fail("RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil(waitMs / 60_000)} minute(s).`);
  const email = input.email.trim().toLowerCase();
  const codeHash = digest(normalizeActivationCode(input.code));
  const now = new Date();

  const user = await withTransaction(async tx => {
    const [row] = await tx
      .select({ code: authCodes, user: users })
      .from(authCodes)
      .innerJoin(users, eq(users.id, authCodes.userId))
      .where(and(eq(authCodes.codeHash, codeHash), eq(users.email, email), isNull(authCodes.usedAt), gt(authCodes.expiresAt, now)))
      .for("update")
      .limit(1);
    if (!row) fail("INVALID_CODE", "That code is invalid, already used, or expired. Ask the administration office for a new one.");
    if (row.user.status === "SUSPENDED" || row.user.status === "DISABLED") {
      fail("ACCOUNT_INACTIVE", "This account is not active. Please contact the administration office.");
    }
    if (row.user.passwordHash && (await verifyPassword(input.password, row.user.passwordHash))) {
      fail("VALIDATION", "Choose a password you haven't used for this account before.");
    }
    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(input.password),
        passwordUpdatedAt: now,
        status: "ACTIVE",
        failedLoginCount: 0,
        lockedUntil: null,
        lastSignedInAt: now,
      })
      .where(eq(users.id, row.user.id));
    await tx.update(authCodes).set({ usedAt: now }).where(eq(authCodes.id, row.code.id));
    await revokeAllSessions(tx, row.user.id);
    await audit(tx, {
      actorUserId: row.user.id,
      action: row.code.purpose === "ACTIVATION" ? "auth.account_activated" : "auth.password_reset",
      entityType: "user",
      entityId: row.user.id,
      ip,
    });
    return { ...row.user, status: "ACTIVE" as const };
  });
  broker.publish({ kind: "user", userId: user.id }, { type: "session.revoked" });
  await createSession(user.id, req, res);
  return publicUser(user);
}

export async function changePassword(user: SessionUser, sessionId: string, input: { currentPassword: string; newPassword: string }, ip: string) {
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !(await verifyPassword(input.currentPassword, row.passwordHash))) fail("INVALID_CREDENTIALS", "Your current password is incorrect.");
  if (input.currentPassword === input.newPassword) fail("VALIDATION", "Choose a new password that differs from the current one.");
  await withTransaction(async tx => {
    await tx.update(users).set({ passwordHash: await hashPassword(input.newPassword), passwordUpdatedAt: new Date() }).where(eq(users.id, user.id));
    // Sign out every other device.
    await tx.execute(sql`delete from sessions where user_id = ${user.id} and id <> ${sessionId}`);
    await audit(tx, { actorUserId: user.id, action: "auth.password_changed", entityType: "user", entityId: user.id, ip });
  });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) fail("NOT_FOUND", "Account not found.");
  const [student] = await db.select().from(studentProfiles).where(eq(studentProfiles.userId, userId)).limit(1);
  const [staff] = await db.select().from(staffProfiles).where(eq(staffProfiles.userId, userId)).limit(1);
  const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1);
  const [avatar] = await db.select().from(userAvatars).where(eq(userAvatars.userId, userId)).limit(1);
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastSignedInAt: user.lastSignedInAt,
    passwordUpdatedAt: user.passwordUpdatedAt,
    avatarDataUrl: avatar?.dataUrl ?? null,
    student: student ? { collegeId: student.collegeId, department: student.department, phone: student.phone } : null,
    staff: staff ? { employeeId: staff.employeeId, designation: staff.designation, phone: staff.phone } : null,
    preferences: {
      almostNext: prefs?.almostNext ?? true,
      positionChanges: prefs?.positionChanges ?? true,
      waitChanges: prefs?.waitChanges ?? true,
      counterStatus: prefs?.counterStatus ?? true,
      almostNextThreshold: prefs?.almostNextThreshold ?? 2,
    },
  };
}

export const profileUpdateSchema = z.object({
  phone: phoneSchema,
  department: departmentSchema,
  preferences: z
    .object({
      almostNext: z.boolean(),
      positionChanges: z.boolean(),
      waitChanges: z.boolean(),
      counterStatus: z.boolean(),
      almostNextThreshold: z.number().int().min(0).max(10),
    })
    .optional(),
});

/** Students and staff can edit contact details and preferences — never role, email or college ID. */
export async function updateProfile(user: SessionUser, input: z.infer<typeof profileUpdateSchema>) {
  await withTransaction(async tx => {
    if (user.role === "STUDENT") {
      const patch: Partial<typeof studentProfiles.$inferInsert> = {};
      if (input.phone !== undefined) patch.phone = input.phone || null;
      if (input.department !== undefined) patch.department = input.department || null;
      if (Object.keys(patch).length) await tx.update(studentProfiles).set(patch).where(eq(studentProfiles.userId, user.id));
    } else if (input.phone !== undefined) {
      await tx
        .insert(staffProfiles)
        .values({ userId: user.id, phone: input.phone || null })
        .onDuplicateKeyUpdate({ set: { phone: input.phone || null } });
    }
    if (input.preferences) {
      await tx
        .insert(notificationPreferences)
        .values({ userId: user.id, ...input.preferences })
        .onDuplicateKeyUpdate({ set: { ...input.preferences, updatedAt: new Date() } });
    }
  });
  return getProfile(user.id);
}

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export const avatarSchema = z
  .string()
  .max(140_000, "Image is too large. Please choose a smaller photo.")
  .regex(AVATAR_PATTERN, "Upload a PNG, JPEG or WebP image.");

export async function setAvatar(userId: number, dataUrl: string | null) {
  if (dataUrl === null) await db.delete(userAvatars).where(eq(userAvatars.userId, userId));
  else await db.insert(userAvatars).values({ userId, dataUrl }).onDuplicateKeyUpdate({ set: { dataUrl, updatedAt: new Date() } });
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export const userListInput = z.object({
  role: z.enum(["STUDENT", "STAFF", "ADMIN"]).optional(),
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "DISABLED"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
});

export async function listUsers(input: z.infer<typeof userListInput>) {
  const filters = [];
  if (input.role) filters.push(eq(users.role, input.role));
  if (input.status) filters.push(eq(users.status, input.status));
  if (input.q) {
    const pattern = `%${input.q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
    filters.push(or(like(users.name, pattern), like(users.email, pattern), like(studentProfiles.collegeId, pattern), like(staffProfiles.employeeId, pattern)));
  }
  const where = filters.length ? and(...filters) : undefined;
  const base = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
      lastSignedInAt: users.lastSignedInAt,
      createdAt: users.createdAt,
      collegeId: studentProfiles.collegeId,
      department: studentProfiles.department,
      studentPhone: studentProfiles.phone,
      employeeId: staffProfiles.employeeId,
      designation: staffProfiles.designation,
      staffPhone: staffProfiles.phone,
    })
    .from(users)
    .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(where);
  const rows = await base.orderBy(asc(users.name), asc(users.id)).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(where);
  const staffIds = rows.filter(row => row.role !== "STUDENT").map(row => row.id);
  const assignments = staffIds.length
    ? await db.select().from(staffCounterAssignments).where(inArray(staffCounterAssignments.staffUserId, staffIds))
    : [];
  return {
    total,
    page: input.page,
    pageSize: input.pageSize,
    rows: rows.map(row => ({
      ...row,
      phone: row.studentPhone ?? row.staffPhone ?? null,
      counterIds: assignments.filter(a => a.staffUserId === row.id).map(a => a.counterId),
    })),
  };
}

export const createUserInput = z.discriminatedUnion("role", [
  z.object({
    role: z.literal("STUDENT"),
    name: nameSchema,
    email: emailSchema,
    collegeId: collegeIdSchema,
    department: departmentSchema,
    phone: phoneSchema,
  }),
  z.object({
    role: z.enum(["STAFF", "ADMIN"]),
    name: nameSchema,
    email: emailSchema,
    employeeId: z.string().trim().max(40).nullable().optional(),
    designation: z.string().trim().max(120).nullable().optional(),
    phone: phoneSchema,
  }),
]);

/** Staff and students are provisioned by admins; they activate with a one-time code. */
export async function createUser(actor: SessionUser, input: z.infer<typeof createUserInput>, ip: string) {
  const settings = await getSettings();
  if (input.role === "STUDENT" && !emailDomainAllowed(input.email, settings)) {
    fail("VALIDATION", `Student emails must use: ${settings.allowedEmailDomains.join(", ")}.`);
  }
  try {
    return await withTransaction(async tx => {
      const [created] = await tx.insert(users).values({ email: input.email, name: input.name, role: input.role, status: "PENDING" }).$returningId();
      if (input.role === "STUDENT") {
        await tx.insert(studentProfiles).values({ userId: created.id, collegeId: input.collegeId, department: input.department ?? null, phone: input.phone ?? null });
      } else {
        await tx.insert(staffProfiles).values({ userId: created.id, employeeId: input.employeeId || null, designation: input.designation || null, phone: input.phone ?? null });
      }
      const code = await issueAuthCode(tx, created.id, "ACTIVATION", actor.id);
      await audit(tx, {
        actorUserId: actor.id,
        action: input.role === "STUDENT" ? "user.student_created" : "user.staff_created",
        entityType: "user",
        entityId: created.id,
        metadata: { role: input.role, email: input.email },
        ip,
      });
      return { userId: created.id, email: input.email, name: input.name, ...code };
    });
  } catch (error) {
    if (isDuplicateKeyError(error, "users_email_unique")) fail("CONFLICT", "An account with this email already exists.");
    if (isDuplicateKeyError(error, "student_profiles_college_id_unique")) fail("CONFLICT", "A student with this college ID already exists.");
    if (isDuplicateKeyError(error, "staff_profiles_employee_id_unique")) fail("CONFLICT", "A staff member with this employee ID already exists.");
    throw error;
  }
}

export const updateUserInput = z.object({
  userId: z.number().int().positive(),
  name: nameSchema.optional(),
  department: departmentSchema,
  phone: phoneSchema,
  employeeId: z.string().trim().max(40).nullable().optional(),
  designation: z.string().trim().max(120).nullable().optional(),
});

export async function updateUser(actor: SessionUser, input: z.infer<typeof updateUserInput>, ip: string) {
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) fail("NOT_FOUND", "User not found.");
  try {
    await withTransaction(async tx => {
      if (input.name) await tx.update(users).set({ name: input.name }).where(eq(users.id, user.id));
      if (user.role === "STUDENT") {
        const patch: Partial<typeof studentProfiles.$inferInsert> = {};
        if (input.department !== undefined) patch.department = input.department || null;
        if (input.phone !== undefined) patch.phone = input.phone || null;
        if (Object.keys(patch).length) await tx.update(studentProfiles).set(patch).where(eq(studentProfiles.userId, user.id));
      } else {
        const patch: Partial<typeof staffProfiles.$inferInsert> = {};
        if (input.employeeId !== undefined) patch.employeeId = input.employeeId || null;
        if (input.designation !== undefined) patch.designation = input.designation || null;
        if (input.phone !== undefined) patch.phone = input.phone || null;
        await tx.insert(staffProfiles).values({ userId: user.id, ...patch }).onDuplicateKeyUpdate({ set: Object.keys(patch).length ? patch : { userId: user.id } });
      }
      await audit(tx, { actorUserId: actor.id, action: "user.updated", entityType: "user", entityId: user.id, metadata: { fields: Object.keys(input).filter(k => k !== "userId") }, ip });
    });
  } catch (error) {
    if (isDuplicateKeyError(error, "staff_profiles_employee_id_unique")) fail("CONFLICT", "A staff member with this employee ID already exists.");
    throw error;
  }
  return { ok: true as const };
}

async function assertAnotherActiveAdmin(executor: Executor, excludingUserId: number) {
  const [{ admins }] = await executor
    .select({ admins: count() })
    .from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.status, "ACTIVE"), ne(users.id, excludingUserId)));
  if (admins === 0) fail("CONFLICT", "At least one other active administrator must remain.");
}

export async function setUserStatus(actor: SessionUser, input: { userId: number; status: Exclude<AccountStatus, "PENDING">; reason: string }, ip: string) {
  if (input.userId === actor.id) fail("FORBIDDEN", "You can't change the status of your own account.");
  const fx = new Effects();
  const result = await withTransaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for("update").limit(1);
    if (!user) fail("NOT_FOUND", "User not found.");
    if (user.role === "ADMIN" && input.status !== "ACTIVE") await assertAnotherActiveAdmin(tx, user.id);
    // Re-enabling an account that never set a password returns it to PENDING, not ACTIVE.
    const next = input.status === "ACTIVE" && !user.passwordHash ? "PENDING" : input.status;
    await tx.update(users).set({ status: next }).where(eq(users.id, user.id));
    let cancelled = 0;
    if (next === "SUSPENDED" || next === "DISABLED") {
      await revokeAllSessions(tx, user.id);
      cancelled = await cancelAllForUser(tx, fx, user.id, actor.id, `Account ${next.toLowerCase()}`);
      fx.toUser(user.id, { type: "session.revoked" });
    }
    await audit(tx, {
      actorUserId: actor.id,
      action: next === "ACTIVE" || next === "PENDING" ? "user.enabled" : next === "SUSPENDED" ? "user.suspended" : "user.disabled",
      entityType: "user",
      entityId: user.id,
      metadata: { from: user.status, to: next, reason: input.reason, cancelledTokens: cancelled },
      ip,
    });
    return { status: next, cancelledTokens: cancelled };
  });
  fx.flush();
  return result;
}

export async function setUserRole(actor: SessionUser, input: { userId: number; role: Exclude<Role, "STUDENT"> }, ip: string) {
  if (input.userId === actor.id) fail("FORBIDDEN", "You can't change your own role.");
  return withTransaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).for("update").limit(1);
    if (!user) fail("NOT_FOUND", "User not found.");
    if (user.role === "STUDENT") fail("VALIDATION", "Student accounts are tied to a college ID and can't be converted to staff. Create a separate staff account.");
    if (user.role === input.role) return { ok: true as const };
    if (user.role === "ADMIN") await assertAnotherActiveAdmin(tx, user.id);
    await tx.update(users).set({ role: input.role }).where(eq(users.id, user.id));
    await revokeAllSessions(tx, user.id);
    await audit(tx, { actorUserId: actor.id, action: "user.role_changed", entityType: "user", entityId: user.id, metadata: { from: user.role, to: input.role }, ip });
    return { ok: true as const };
  });
}

export async function issueAccessCode(actor: SessionUser, userId: number, ip: string) {
  return withTransaction(async tx => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) fail("NOT_FOUND", "User not found.");
    if (user.status === "SUSPENDED" || user.status === "DISABLED") fail("ACCOUNT_INACTIVE", "Re-enable the account before issuing a code.");
    const purpose: AuthCodePurpose = user.passwordHash ? "RESET" : "ACTIVATION";
    const code = await issueAuthCode(tx, user.id, purpose, actor.id);
    await audit(tx, { actorUserId: actor.id, action: purpose === "RESET" ? "user.reset_code_issued" : "user.activation_code_issued", entityType: "user", entityId: user.id, ip });
    return { email: user.email, name: user.name, ...code };
  });
}

// ---------------------------------------------------------------------------
// Bulk student import
// ---------------------------------------------------------------------------

export const MAX_IMPORT_ROWS = 5000;
const HEADER_ALIASES: Record<string, "name" | "email" | "collegeId" | "department" | "phone"> = {
  name: "name",
  full_name: "name",
  student_name: "name",
  email: "email",
  email_address: "email",
  institutional_email: "email",
  college_id: "collegeId",
  collegeid: "collegeId",
  student_id: "collegeId",
  roll_number: "collegeId",
  roll_no: "collegeId",
  department: "department",
  dept: "department",
  phone: "phone",
  phone_number: "phone",
  mobile: "phone",
};

const importRowSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  collegeId: collegeIdSchema,
  department: z.string().trim().max(120).optional().transform(v => v || null),
  phone: z
    .string()
    .trim()
    .optional()
    .transform(v => v || null)
    .pipe(z.string().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number.").nullable()),
});

export type ImportRow = {
  line: number;
  status: "valid" | "invalid" | "duplicate_in_file" | "already_exists";
  errors: string[];
  data: { name: string; email: string; collegeId: string; department: string | null; phone: string | null } | null;
  raw: Record<string, string>;
};

export async function previewStudentImport(csvText: string, executor: Executor = db) {
  const settings = await getSettings(executor);
  const table = parseCsv(csvText);
  if (table.length < 2) fail("VALIDATION", "The file needs a header row and at least one student.");
  if (table.length - 1 > MAX_IMPORT_ROWS) fail("VALIDATION", `Import at most ${MAX_IMPORT_ROWS} students per file.`);
  const header = table[0].map(cell => HEADER_ALIASES[cell.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? null);
  const missing = (["name", "email", "collegeId"] as const).filter(col => !header.includes(col));
  if (missing.length) {
    fail("VALIDATION", `Missing required column(s): ${missing.map(m => (m === "collegeId" ? "college_id" : m)).join(", ")}. Expected: name, email, college_id, department, phone.`);
  }
  const rows: ImportRow[] = table.slice(1).map((cells, index) => {
    const raw: Record<string, string> = {};
    header.forEach((key, col) => {
      if (key) raw[key] = (cells[col] ?? "").trim();
    });
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      return { line: index + 2, status: "invalid", errors: parsed.error.issues.map(i => `${i.path.join(".") || "row"}: ${i.message}`), data: null, raw };
    }
    const errors = emailDomainAllowed(parsed.data.email, settings) ? [] : [`email: must use ${settings.allowedEmailDomains.join(", ")}`];
    return { line: index + 2, status: errors.length ? "invalid" : "valid", errors, data: parsed.data, raw };
  });

  const seenEmail = new Map<string, number>();
  const seenCollege = new Map<string, number>();
  rows.forEach(row => {
    if (row.status !== "valid" || !row.data) return;
    const e = seenEmail.get(row.data.email);
    const c = seenCollege.get(row.data.collegeId);
    if (e || c) {
      row.status = "duplicate_in_file";
      row.errors.push(e ? `email duplicates line ${e}` : `college_id duplicates line ${c}`);
    } else {
      seenEmail.set(row.data.email, row.line);
      seenCollege.set(row.data.collegeId, row.line);
    }
  });

  const candidates = rows.filter(row => row.status === "valid" && row.data);
  const emails = candidates.map(row => row.data!.email);
  const collegeIds = candidates.map(row => row.data!.collegeId);
  const existingEmails = new Set<string>();
  const existingColleges = new Set<string>();
  for (let i = 0; i < emails.length; i += 1000) {
    const chunk = emails.slice(i, i + 1000);
    (await executor.select({ email: users.email }).from(users).where(inArray(users.email, chunk))).forEach(r => existingEmails.add(r.email));
  }
  for (let i = 0; i < collegeIds.length; i += 1000) {
    const chunk = collegeIds.slice(i, i + 1000);
    (await executor.select({ collegeId: studentProfiles.collegeId }).from(studentProfiles).where(inArray(studentProfiles.collegeId, chunk))).forEach(r =>
      existingColleges.add(r.collegeId)
    );
  }
  candidates.forEach(row => {
    const errs = [];
    if (existingEmails.has(row.data!.email)) errs.push("an account with this email already exists");
    if (existingColleges.has(row.data!.collegeId)) errs.push("a student with this college ID already exists");
    if (errs.length) {
      row.status = "already_exists";
      row.errors.push(...errs);
    }
  });

  const summary = {
    total: rows.length,
    valid: rows.filter(r => r.status === "valid").length,
    invalid: rows.filter(r => r.status === "invalid").length,
    duplicateInFile: rows.filter(r => r.status === "duplicate_in_file").length,
    alreadyExists: rows.filter(r => r.status === "already_exists").length,
  };
  return { summary, rows };
}

/** Re-validates on the server (the preview is never trusted), then creates all valid rows atomically. */
export async function commitStudentImport(actor: SessionUser, csvText: string, ip: string) {
  const settings = await getSettings();
  return withTransaction(async tx => {
    const preview = await previewStudentImport(csvText, tx);
    const valid = preview.rows.filter(row => row.status === "valid" && row.data);
    if (valid.length === 0) fail("VALIDATION", "No new, valid students were found in this file.");
    const now = Date.now();
    const expiresAt = new Date(now + settings.activationCodeDays * 86_400_000);
    const created: Array<{ name: string; email: string; collegeId: string; code: string }> = [];
    for (let i = 0; i < valid.length; i += 500) {
      const chunk = valid.slice(i, i + 500);
      await tx.insert(users).values(chunk.map(row => ({ email: row.data!.email, name: row.data!.name, role: "STUDENT" as const, status: "PENDING" as const })));
      const inserted = await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(users.email, chunk.map(r => r.data!.email)));
      const idByEmail = new Map(inserted.map(row => [row.email, row.id]));
      await tx.insert(studentProfiles).values(
        chunk.map(row => ({ userId: idByEmail.get(row.data!.email)!, collegeId: row.data!.collegeId, department: row.data!.department, phone: row.data!.phone }))
      );
      const codes = chunk.map(row => ({ row, code: newActivationCode() }));
      await tx.insert(authCodes).values(
        codes.map(({ row, code }) => ({
          userId: idByEmail.get(row.data!.email)!,
          codeHash: digest(code),
          purpose: "ACTIVATION" as const,
          expiresAt,
          createdByUserId: actor.id,
        }))
      );
      codes.forEach(({ row, code }) => created.push({ name: row.data!.name, email: row.data!.email, collegeId: row.data!.collegeId, code }));
    }
    await audit(tx, {
      actorUserId: actor.id,
      action: "user.bulk_import",
      entityType: "user",
      metadata: { created: created.length, skipped: preview.summary.total - created.length, summary: preview.summary },
      ip,
    });
    return { summary: preview.summary, created: created.length, skipped: preview.summary.total - created.length, expiresAt, codes: created };
  });
}

export { passwordSchema };
