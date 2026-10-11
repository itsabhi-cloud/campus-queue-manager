import "dotenv/config";
import { z } from "zod";
import { passwordSchema } from "../auth/password";

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
  /**
   * Proxy hops in front of the app (usually 1), or Express's IP/subnet names ("loopback", "10.0.0.0/8").
   * Never "true": trusting every hop lets clients forge X-Forwarded-For and dodge per-IP limits.
   */
  TRUST_PROXY: z
    .string()
    .trim()
    .refine(
      value => !/^(true|false|yes|no)$/i.test(value),
      'TRUST_PROXY must be a hop count such as 1, or IP/subnet names; not "true".'
    )
    .optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Only for running a production build on your own machine over http://localhost. */
  ALLOW_INSECURE_ORIGIN: z.enum(["true", "false"]).default("false"),
  /**
   * Public demo instance: one-click sign-in to seeded demo accounts, a nightly reset, and demo
   * accounts blocked from password changes and destructive admin actions. Use a dedicated database.
   */
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  /** Campus-time hour (0–23) after which the demo data is reset once per day. */
  DEMO_RESET_HOUR: z.coerce.number().int().min(0).max(23).default(4),
  /**
   * Shared password for the three demo accounts, so the team can also sign in with email and
   * password. Unset (or empty): each reset gives them a random password nobody knows.
   */
  DEMO_PASSWORD: z.preprocess(
    value => (value === "" ? undefined : value),
    passwordSchema.optional()
  ),
  /** Connect to MySQL over TLS (managed providers such as Aiven require it). */
  DB_SSL: z.enum(["true", "false"]).default("false"),
  /** PEM certificate of the provider's CA. Literal "\n" sequences are accepted for one-line values. */
  DB_SSL_CA: z.string().optional(),
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

/**
 * Production must not run with a secret copied from .env.example, the test setup or the CI workflow: anyone who has
 * read the repository would know it. Returns a problem description, or null when acceptable.
 */
export function productionSecretProblem(secret: string): string | null {
  const known = /replace-with|change-me|test-secret|ci-only/i.test(secret);
  if (known || new Set(secret).size < 8)
    return "AUTH_SECRET looks like a placeholder. Generate one with: openssl rand -hex 32";
  return null;
}

export type DatabaseSsl = {
  ca?: string;
  rejectUnauthorized: true;
  verifyIdentity: true;
};

/**
 * TLS options for the MySQL pool. The server certificate is always verified, including that it was
 * issued for the DATABASE_URL host (mysql2 skips that check unless `verifyIdentity` is set). The
 * chain is checked against `DB_SSL_CA` when given (providers with their own CA, such as Aiven),
 * otherwise against Node's built-in public CAs.
 * Returns a problem description instead of options when the combination is invalid.
 */
export function databaseSsl(
  enabled: string | undefined,
  caInput: string | undefined
): { ssl: DatabaseSsl | undefined; problem: string | null } {
  const ca = caInput?.trim().replace(/\\n/g, "\n") || undefined;
  if (enabled !== "true")
    return {
      ssl: undefined,
      problem: ca ? "DB_SSL_CA is set but DB_SSL is not true." : null,
    };
  if (ca && !ca.includes("-----BEGIN CERTIFICATE-----"))
    return {
      ssl: undefined,
      problem:
        "DB_SSL_CA must be the PEM text of the CA certificate (-----BEGIN CERTIFICATE----- …).",
    };
  return {
    ssl: { ca, rejectUnauthorized: true, verifyIdentity: true },
    problem: null,
  };
}

/**
 * mysql2 ignores libmysql-style TLS parameters in the URL (with only a warning) and then connects
 * *without* TLS. Providers such as Aiven append `?ssl-mode=REQUIRED`, so refuse it and point to
 * DB_SSL instead.
 */
export function databaseUrlProblem(url: string): string | null {
  const params = new URL(url).searchParams;
  const tlsParam = ["ssl-mode", "sslmode", "ssl"].find(name =>
    params.has(name)
  );
  return tlsParam
    ? `Remove "?${tlsParam}=…" from DATABASE_URL (the MySQL driver ignores it); set DB_SSL=true and DB_SSL_CA instead.`
    : null;
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
  const sslProblem =
    databaseUrlProblem(env.DATABASE_URL) ??
    databaseSsl(env.DB_SSL, env.DB_SSL_CA).problem;
  if (sslProblem)
    throw new Error(`Invalid environment configuration:\n  - ${sslProblem}`);
  if (env.NODE_ENV === "production") {
    const problem = productionOriginProblem(
      env.APP_ORIGIN,
      env.ALLOW_INSECURE_ORIGIN === "true"
    );
    const secretProblem = productionSecretProblem(env.AUTH_SECRET);
    if (problem || secretProblem)
      throw new Error(
        `Invalid environment configuration:\n${[problem, secretProblem]
          .filter(Boolean)
          .map(p => `  - ${p}`)
          .join("\n")}`
      );
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
