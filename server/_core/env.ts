import "dotenv/config";
import { z } from "zod";

/**
 * Validated runtime configuration. The server refuses to start with an invalid
 * environment instead of failing later with a confusing error.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^mysql:\/\//, "DATABASE_URL must be a mysql:// URL"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_ORIGIN: z.string().url().optional(),
  CAMPUS_TIMEZONE: z.string().default("Asia/Kolkata"),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(168),
  TRUST_PROXY: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Only for running a production build on your own machine over http://localhost. */
  ALLOW_INSECURE_ORIGIN: z.enum(["true", "false"]).default("false"),
});

/**
 * Production must be served from a real HTTPS origin: secure cookies and the CSRF origin check
 * both depend on it. Returns a problem description, or null when the origin is acceptable.
 */
export function productionOriginProblem(
  origin: string | undefined,
  allowInsecure: boolean
): string | null {
  if (!origin) return "APP_ORIGIN is required in production.";
  const url = new URL(origin);
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.hostname.endsWith(".localhost");
  if (allowInsecure) return null;
  if (local)
    return "APP_ORIGIN must be your public domain in production, not localhost.";
  if (url.protocol !== "https:")
    return "APP_ORIGIN must use https:// in production.";
  return null;
}

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const source = { ...process.env };
  // Tests run against the dedicated test database and a fixed secret.
  if (source.NODE_ENV === "test" || source.VITEST) {
    source.NODE_ENV = "test";
    source.DATABASE_URL =
      source.TEST_DATABASE_URL ?? source.DATABASE_URL ?? "mysql://unset/unset";
    source.AUTH_SECRET =
      source.AUTH_SECRET ?? "test-secret-test-secret-test-secret-0000";
  }
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(issue => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\nSee .env.example.`
    );
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const problem = productionOriginProblem(
      env.APP_ORIGIN,
      env.ALLOW_INSECURE_ORIGIN === "true"
    );
    if (problem)
      throw new Error(`Invalid environment configuration:\n  - ${problem}`);
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: env.CAMPUS_TIMEZONE });
  } catch {
    throw new Error(
      `Invalid environment configuration:\n  - CAMPUS_TIMEZONE "${env.CAMPUS_TIMEZONE}" is not an IANA time zone.`
    );
  }
  return env;
}

export const ENV = loadEnv();
export const isProduction = ENV.NODE_ENV === "production";
