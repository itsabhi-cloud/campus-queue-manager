import { sql } from "drizzle-orm";
import { db } from "./client";

const TABLES = [
  "camera_metrics",
  "camera_stations",
  "notifications",
  "queue_events",
  "queue_entries",
  "staff_counter_assignments",
  "counters",
  "queue_groups",
  "services",
  "audit_logs",
  "system_settings",
  "auth_codes",
  "sessions",
  "notification_preferences",
  "user_avatars",
  "staff_profiles",
  "student_profiles",
  "users",
];

/** Deletes all application data (schema and migration history stay). Development/test only. */
export async function truncateAll() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to truncate data in production.");
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  try {
    for (const table of TABLES)
      await db.execute(sql.raw(`TRUNCATE TABLE \`${table}\``));
  } finally {
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  }
}
