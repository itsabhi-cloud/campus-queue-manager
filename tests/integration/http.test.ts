import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import superjson from "superjson";
import { createApp } from "../../server/_core/app";
import {
  createQueue,
  createUser,
  describeDb,
  resetDatabase,
  TEST_PASSWORD,
} from "../helpers";

let server: Server;
let base: string;

async function trpc(
  path: string,
  input: unknown,
  cookie?: string,
  extraHeaders: Record<string, string> = {}
) {
  const response = await fetch(`${base}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(superjson.serialize(input)),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function login(email: string) {
  const { response } = await trpc("auth.login", {
    email,
    password: TEST_PASSWORD,
  });
  const setCookie = response.headers.getSetCookie()[0];
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  return setCookie.split(";")[0];
}

/** Opens the SSE stream and collects parsed events. */
async function openStream(cookie: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/realtime`, {
    headers: { cookie },
    signal: controller.signal,
  });
  const events: Array<{ type: string; [key: string]: unknown }> = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const data = part.split("\n").find(line => line.startsWith("data: "));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const waitFor = async (
    predicate: (e: (typeof events)[number]) => boolean,
    timeoutMs = 3000
  ) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(
      `Timed out waiting for event; got ${JSON.stringify(events.map(e => e.type))}`
    );
  };
  return { response, events, waitFor, close: () => controller.abort() };
}

describeDb("HTTP API and realtime", () => {
  beforeAll(async () => {
    server = createServer(createApp());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  beforeEach(resetDatabase);

  it("reports health including database connectivity", async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      checks: { database: "up", realtime: { transport: "sse" } },
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses the realtime stream without a session", async () => {
    expect((await fetch(`${base}/api/realtime`)).status).toBe(401);
  });

  it("blocks cross-origin writes", async () => {
    const { response } = await trpc(
      "auth.login",
      { email: "x@y.z", password: "whatever-1" },
      undefined,
      { origin: "https://evil.example" }
    );
    expect(response.status).toBe(403);
  });

  it("returns safe, structured errors", async () => {
    const { response, body } = await trpc("auth.login", {
      email: "nobody@test.edu",
      password: "Wrong-pass-1",
    });
    expect(response.status).toBe(401);
    expect(body.error.json.message).toBe("Incorrect email or password.");
    expect(body.error.json.data.appCode).toBe("INVALID_CREDENTIALS");
    expect(JSON.stringify(body)).not.toMatch(/stack|sql|select /i);
  });

  it("pushes queue changes to everyone and notifications only to their owner", async () => {
    const staff = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const bystander = await createUser("STUDENT");
    const { groupId, counterIds } = await createQueue({ counters: ["H"] });
    const staffCookie = await login(staff.email);
    const studentCookie = await login(student.email);
    const bystanderCookie = await login(bystander.email);

    const staffStream = await openStream(staffCookie);
    const studentStream = await openStream(studentCookie);
    const bystanderStream = await openStream(bystanderCookie);
    await studentStream.waitFor(e => e.type === "hello");
    await bystanderStream.waitFor(e => e.type === "hello");

    const joined = await trpc(
      "queue.join",
      { queueGroupId: groupId },
      studentCookie
    );
    expect(joined.response.status).toBe(200);
    await staffStream.waitFor(
      e =>
        e.type === "queue.changed" &&
        (e.counterIds as number[]).includes(counterIds[0])
    );
    await studentStream.waitFor(
      e =>
        e.type === "notification.created" &&
        e.notificationType === "QUEUE_JOINED"
    );

    await trpc("staff.callNext", { counterId: counterIds[0] }, staffCookie);
    const called = await studentStream.waitFor(
      e =>
        e.type === "notification.created" &&
        e.notificationType === "TOKEN_CALLED"
    );
    expect(called.message).toContain("H001");
    await bystanderStream.waitFor(
      e => e.type === "queue.changed" && e.reason === "CALLED"
    );
    expect(
      bystanderStream.events.some(e => e.type === "notification.created")
    ).toBe(false);
    // Broadcast events carry identifiers only.
    expect(JSON.stringify(bystanderStream.events)).not.toContain(student.email);

    [staffStream, studentStream, bystanderStream].forEach(s => s.close());
  });

  it("ends a stream when the session is revoked", async () => {
    const admin = await createUser("ADMIN");
    const student = await createUser("STUDENT");
    const adminCookie = await login(admin.email);
    const stream = await openStream(await login(student.email));
    await stream.waitFor(e => e.type === "hello");
    await trpc(
      "admin.users.setStatus",
      { userId: student.id, status: "SUSPENDED", reason: "Test suspension" },
      adminCookie
    );
    await stream.waitFor(e => e.type === "session.revoked");
    stream.close();
  });
});
