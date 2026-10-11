import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../../drizzle/schema";
import { databaseSsl, ENV } from "../_core/env";
import { logger } from "../_core/logger";

function createPool(url: string) {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: ENV.NODE_ENV === "test" ? 20 : 15,
    waitForConnections: true,
    // Everything is stored and exchanged in UTC; the campus time zone is applied only when formatting.
    timezone: "Z",
    dateStrings: false,
    supportBigNumbers: true,
    ssl: databaseSsl(ENV.DB_SSL, ENV.DB_SSL_CA).ssl,
  });
  // TIMESTAMP columns are converted using the *session* time zone, so pin every connection to UTC.
  pool.pool.on("connection", connection => {
    connection.query("SET time_zone = '+00:00'");
  });
  return pool;
}

export const pool = createPool(ENV.DATABASE_URL);
export const db = drizzle(pool, {
  schema,
  mode: "default",
  casing: "snake_case",
});

export type Database = typeof db;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;

const RETRYABLE = new Set(["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]);

function mysqlCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("ER_")) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function isDuplicateKeyError(error: unknown, indexName?: string) {
  if (mysqlCode(error) !== "ER_DUP_ENTRY") return false;
  if (!indexName) return true;
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && message.includes(indexName)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Runs `work` in a transaction and transparently retries on deadlock / lock-wait timeout,
 * which InnoDB can raise under concurrent row locking. `work` must be idempotent up to its commit.
 */
export async function withTransaction<T>(
  work: (tx: Tx) => Promise<T>,
  attempts = 4
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(work, { isolationLevel: "read committed" });
    } catch (error) {
      const code = mysqlCode(error);
      if (code && RETRYABLE.has(code) && attempt < attempts) {
        logger.warn("Retrying transaction after lock conflict", {
          code,
          attempt,
        });
        await new Promise(resolve =>
          setTimeout(resolve, 15 * attempt + Math.random() * 25)
        );
        continue;
      }
      throw error;
    }
  }
}

export async function pingDatabase(): Promise<{
  ok: boolean;
  latencyMs: number;
}> {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    logger.error("Database ping failed", { error });
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}

export async function closeDatabase() {
  await pool.end();
}
