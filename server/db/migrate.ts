import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { db } from "./client";

// Resolved from the working directory (the project root) so that both `tsx scripts/migrate.ts`
// and the bundled `node dist/migrate.js` find the same folder. Override with MIGRATIONS_DIR.
export const MIGRATIONS_FOLDER = path.resolve(
  process.cwd(),
  process.env.MIGRATIONS_DIR ?? "drizzle/migrations"
);

export async function runMigrations() {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
