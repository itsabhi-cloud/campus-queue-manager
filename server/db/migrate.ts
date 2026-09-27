import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { db } from "./client";

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle/migrations");

export async function runMigrations() {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
