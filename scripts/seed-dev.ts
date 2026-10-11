/**
 * DEVELOPMENT SEED — never run against production data.
 *   pnpm db:seed:dev          # seeds an empty database
 *   pnpm db:reset:dev         # wipes all data first, then seeds
 *
 * Development credentials created here (for local testing only):
 *   admin@queuesense.dev            DevAdmin#2026
 *   staff.admin@queuesense.dev      DevStaff#2026   (Administration counters)
 *   staff.print@queuesense.dev      DevStaff#2026   (Printing counters)
 *   staff.cafe@queuesense.dev       DevStaff#2026   (Cafeteria counters)
 *   staff.lift@queuesense.dev       DevStaff#2026   (Lift boarding)
 *   student01..student12@queuesense.dev   DevStudent#2026
 *
 * For a hosted demo database, override the passwords so the public defaults above don't work there:
 *   SEED_ADMIN_PASSWORD=… SEED_STAFF_PASSWORD=… SEED_STUDENT_PASSWORD=… pnpm db:seed:dev
 * Overrides must satisfy the normal password policy.
 */
import { count } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { hashPassword, passwordSchema } from "../server/auth/password";
import { closeDatabase, db } from "../server/db/client";
import { truncateAll } from "../server/db/reset";
import { seedCampus } from "../server/seed/campus";

if (process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to run the development seed with NODE_ENV=production."
  );
  process.exit(1);
}

async function main() {
  const reset = process.argv.includes("--reset");
  // Resolve passwords first so a bad override never wipes the database and then stops.
  const password = (variable: string, fallback: string) => {
    const value = process.env[variable];
    if (!value) return fallback;
    const checked = passwordSchema.safeParse(value);
    if (!checked.success)
      throw new Error(`${variable}: ${checked.error.issues[0].message}`);
    console.log(`Using ${variable} from the environment.`);
    return value;
  };
  const adminHash = await hashPassword(
    password("SEED_ADMIN_PASSWORD", "DevAdmin#2026")
  );
  const staffHash = await hashPassword(
    password("SEED_STAFF_PASSWORD", "DevStaff#2026")
  );
  const studentHash = await hashPassword(
    password("SEED_STUDENT_PASSWORD", "DevStudent#2026")
  );
  if (reset) {
    await truncateAll();
    console.log("Cleared existing data.");
  } else {
    const [{ n }] = await db.select({ n: count() }).from(users);
    if (n > 0) {
      console.error(
        "Database already has users. Use `pnpm db:reset:dev` to wipe and reseed."
      );
      process.exitCode = 1;
      return;
    }
  }

  const { pendingCodes } = await seedCampus({
    emailDomain: "queuesense.dev",
    isDemo: false,
    hashes: { admin: adminHash, staff: staffHash, student: studentHash },
    pendingStudents: true,
  });

  console.log(
    "\nDevelopment data ready. See scripts/seed-dev.ts for local credentials."
  );
  console.log("Pending accounts (activate at /activate):");
  pendingCodes.forEach(line => console.log(`  ${line}`));
  console.log("");
}

try {
  await main();
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
