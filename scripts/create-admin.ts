/**
 * Bootstraps an administrator in any environment (including production):
 *   pnpm admin:create --email registrar@college.edu --name "Registrar Office"
 * Prints a one-time activation code; the admin sets their own password at /activate.
 */
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { emailSchema, issueAuthCode, nameSchema } from "../server/accounts";
import { closeDatabase, withTransaction } from "../server/db/client";
import { audit } from "../server/lib/audit";

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});

try {
  const email = emailSchema.parse(values.email ?? "");
  const name = nameSchema.parse(values.name ?? "");
  const result = await withTransaction(async tx => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing && existing.role !== "ADMIN")
      throw new Error(`${email} already exists with role ${existing.role}.`);
    const userId =
      existing?.id ??
      (
        await tx
          .insert(users)
          .values({ email, name, role: "ADMIN", status: "PENDING" })
          .$returningId()
      )[0].id;
    const code = await issueAuthCode(
      tx,
      userId,
      existing?.passwordHash ? "RESET" : "ACTIVATION",
      null
    );
    await audit(tx, {
      actorUserId: null,
      action: "user.admin_bootstrapped",
      entityType: "user",
      entityId: userId,
      metadata: { email },
    });
    return code;
  });
  console.log(`\nAdministrator ready: ${email}`);
  console.log(
    `One-time code: ${result.code}  (expires ${result.expiresAt.toISOString()})`
  );
  console.log(
    `Open /activate, enter the email and code, and choose a password.\n`
  );
} catch (error) {
  const message =
    error instanceof ZodError
      ? error.issues[0]?.message
      : error instanceof Error
        ? error.message
        : String(error);
  console.error(`Could not create administrator: ${message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
