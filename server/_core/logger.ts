import { ENV } from "./env";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Keys whose values must never reach the logs. */
const REDACT = /pass(word)?|secret|token|cookie|authorization|code|dataurl/i;

function scrub(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: ENV.NODE_ENV === "production" ? undefined : value.stack,
    };
  }
  if (!value || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map(item => scrub(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACT.test(key) ? "[redacted]" : scrub(item, depth + 1);
  }
  return out;
}

function write(
  level: Level,
  message: string,
  fields?: Record<string, unknown>
) {
  if (order[level] < order[ENV.LOG_LEVEL]) return;
  if (ENV.NODE_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(scrub(fields) as object),
  });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

/** Structured JSON logger. Sensitive keys are redacted automatically. */
export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    write("error", msg, fields),
};
