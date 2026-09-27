import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import path from "node:path";

/** Rebuilds the test database schema from the real migrations before the suite runs. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("\n[tests] TEST_DATABASE_URL is not set — database integration tests will be skipped.\n");
    return;
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to run tests against "${name}": the test database name must end in _test.`);
  const connection = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const [tables] = await connection.query<mysql.RowDataPacket[]>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()");
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tables) await connection.query(`DROP TABLE IF EXISTS \`${table.name}\``);
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    await connection.query("SET time_zone = '+00:00'");
    await migrate(drizzle(connection, { casing: "snake_case" }), { migrationsFolder: path.resolve(import.meta.dirname, "../drizzle/migrations") });
  } finally {
    await connection.end();
  }
}
