import { createHmac, randomBytes, randomInt } from "node:crypto";
import { ENV } from "../_core/env";

/** HMAC-SHA256 with the server secret: a stolen database alone cannot be used to forge or replay tokens. */
export function digest(value: string): string {
  return createHmac("sha256", ENV.AUTH_SECRET).update(value).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// Crockford base32 without I, L, O, U — easy to read aloud or type from a printout.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 12 random base32 characters (60 bits) formatted as XXXX-XXXX-XXXX. */
export function newActivationCode(): string {
  let raw = "";
  for (let i = 0; i < 12; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

export function normalizeActivationCode(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return cleaned.length === 12
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}-${cleaned.slice(8)}`
    : cleaned;
}
