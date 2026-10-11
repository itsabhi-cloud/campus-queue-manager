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
import { scrubForLog } from "../../server/_core/logger";
import {
  databaseSsl,
  productionOriginProblem,
  productionSecretProblem,
} from "../../server/_core/env";

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

describe("production origin", () => {
  it("requires a public https origin unless explicitly running locally", () => {
    expect(productionOriginProblem(undefined, false)).toMatch(/required/);
    expect(productionOriginProblem("http://localhost:3000", false)).toMatch(
      /not localhost/
    );
    expect(productionOriginProblem("http://queue.college.edu", false)).toMatch(
      /https/
    );
    expect(
      productionOriginProblem("https://queue.college.edu", false)
    ).toBeNull();
    expect(productionOriginProblem("http://localhost:3000", true)).toBeNull();
  });
});

describe("production secret", () => {
  it("rejects placeholder secrets from the example and test configuration", () => {
    expect(
      productionSecretProblem("replace-with-at-least-32-random-characters")
    ).toMatch(/placeholder/);
    expect(
      productionSecretProblem("test-secret-test-secret-test-secret-0000")
    ).toMatch(/placeholder/);
    expect(productionSecretProblem("a".repeat(40))).toMatch(/placeholder/);
    expect(
      productionSecretProblem(
        "ci-only-secret-not-used-anywhere-else-0123456789"
      )
    ).toMatch(/placeholder/);
    expect(
      productionSecretProblem(
        "9f2c1e7ab04d58e3c6a1f09b7d2e4c8a5b3f6e1d0c9a8b7e"
      )
    ).toBeNull();
  });
});

describe("database TLS", () => {
  const pem =
    "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
  it("is off by default", () => {
    expect(databaseSsl(undefined, undefined)).toEqual({
      ssl: undefined,
      problem: null,
    });
  });
  it("verifies against public CAs when no CA is given", () => {
    expect(databaseSsl("true", undefined).ssl).toEqual({
      ca: undefined,
      rejectUnauthorized: true,
      verifyIdentity: true,
    });
  });
  it("accepts a PEM CA, including one written on one line with \\n", () => {
    expect(databaseSsl("true", pem).ssl?.ca).toBe(pem);
    expect(databaseSsl("true", pem.replace(/\n/g, "\\n")).ssl?.ca).toBe(pem);
  });
  it("rejects a CA that is not PEM, or a CA without DB_SSL=true", () => {
    expect(databaseSsl("true", "ca.pem").problem).toMatch(/PEM/);
    expect(databaseSsl("false", pem).problem).toMatch(/DB_SSL is not true/);
  });
});

describe("log scrubbing", () => {
  it("drops bound query values from database errors but keeps the driver cause", () => {
    const driver = Object.assign(
      new Error("Table 'x.no_such_table' doesn't exist"),
      {
        code: "ER_NO_SUCH_TABLE",
      }
    );
    const error = new Error(
      "Failed query: select * from users where password_hash = ?\nparams: scrypt$16384$8$1$salt$hash",
      { cause: driver }
    );
    const logged = JSON.stringify(scrubForLog({ error }));
    expect(logged).not.toContain("scrypt$");
    expect(logged).toContain("params: [redacted]");
    expect(logged).toContain("where password_hash = ?");
    expect(logged).toContain("ER_NO_SUCH_TABLE");
  });
  it("redacts sensitive keys", () => {
    expect(scrubForLog({ password: "x", sessionToken: "y", ok: 1 })).toEqual({
      password: "[redacted]",
      sessionToken: "[redacted]",
      ok: 1,
    });
  });
});
