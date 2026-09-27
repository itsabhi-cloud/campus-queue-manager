import { describe, expect, it } from "vitest";
import {
  hashPassword,
  passwordSchema,
  verifyPassword,
} from "../../server/auth/password";
import {
  digest,
  newActivationCode,
  normalizeActivationCode,
  newSessionToken,
} from "../../server/auth/tokens";
import { csvCell, parseCsv, toCsv } from "../../server/lib/csv";
import { RateLimiter } from "../../server/_core/rateLimit";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("Library-card-1234");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Library-card-1234", hash)).toBe(true);
    expect(await verifyPassword("library-card-1234", hash)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("Same-password-1")).not.toBe(
      await hashPassword("Same-password-1")
    );
  });
  it("enforces the password policy", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false);
    expect(passwordSchema.safeParse("letters-and-9").success).toBe(true);
  });
});

describe("tokens", () => {
  it("creates unguessable session tokens and stores only a digest", () => {
    const token = newSessionToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(digest(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(digest(token)).not.toContain(token);
  });
  it("normalises activation codes typed by humans", () => {
    const code = newActivationCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeActivationCode(code.toLowerCase().replace(/-/g, " "))).toBe(
      code
    );
    expect(normalizeActivationCode("abcd-efgh-ij0o")).toBe("ABCD-EFGH-1J00");
  });
});

describe("csv", () => {
  it("parses quotes, escaped quotes, CRLF and BOM", () => {
    expect(
      parseCsv('﻿name,email\r\n"Rao, Anu","a@x.edu"\r\n"Say ""hi""",b@x.edu\n')
    ).toEqual([
      ["name", "email"],
      ["Rao, Anu", "a@x.edu"],
      ['Say "hi"', "b@x.edu"],
    ]);
  });
  it("neutralises spreadsheet formulas on export", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCsv(["a"], [["x,y"]])).toBe('a\r\n"x,y"');
  });
});

describe("rate limiter", () => {
  it("blocks after the limit within a window and recovers after it", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.consume("k", 0)).toBe(0);
    expect(limiter.consume("k", 10)).toBe(0);
    expect(limiter.consume("k", 20)).toBeGreaterThan(0);
    expect(limiter.consume("k", 1001)).toBe(0);
  });
});

describe("rate limiter inspection", () => {
  it("reports a block without recording an attempt", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.blockedFor("ip", 0)).toBe(0);
    limiter.consume("ip", 0);
    limiter.consume("ip", 1);
    expect(limiter.blockedFor("ip", 2)).toBeGreaterThan(0);
    expect(limiter.blockedFor("other", 2)).toBe(0);
  });
});
