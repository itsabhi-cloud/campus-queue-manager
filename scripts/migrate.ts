/** Applies pending SQL migrations from drizzle/migrations to DATABASE_URL. */
import { closeDatabase } from "../server/db/client";
import { runMigrations } from "../server/db/migrate";

try {
  await runMigrations();
  console.log("Migrations applied.");
} catch (error) {
  console.error(
    "Migration failed:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
