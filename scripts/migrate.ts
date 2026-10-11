/** Applies pending SQL migrations from drizzle/migrations to DATABASE_URL. */
import { closeDatabase } from "../server/db/client";
import { runMigrations } from "../server/db/migrate";

try {
  await runMigrations();
  console.log("Migrations applied.");
} catch (error) {
  // Drizzle wraps driver errors as "Failed query: …"; the cause says why (TLS, auth, network).
  const cause = error instanceof Error ? error.cause : undefined;
  console.error(
    "Migration failed:",
    cause instanceof Error
      ? cause.message
      : error instanceof Error
        ? error.message
        : error
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
