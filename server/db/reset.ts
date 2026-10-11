import { pool } from "./client";

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

/**
 * Empties every application table (schema and migration history stay). FOREIGN_KEY_CHECKS is a
 * session setting, so everything runs on one dedicated connection rather than through the pool.
 * Callers are responsible for making sure this database may be wiped.
 */
export async function truncateTables() {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES)
      await connection.query(`TRUNCATE TABLE \`${table}\``);
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
    connection.release();
  }
}

/** Deletes all application data. Development/test only. */
export async function truncateAll() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to truncate data in production.");
  await truncateTables();
}
