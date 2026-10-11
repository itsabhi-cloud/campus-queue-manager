import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import superjson from "superjson";
import type { RealtimeEvent } from "../shared/domain";
import { createApp, errorHandler } from "../server/_core/app";
import { TEST_PASSWORD } from "./helpers";

/** A real HTTP server on an ephemeral port, exactly as production wires it (minus static files). */
export async function startServer(): Promise<{ base: string; stop: () => Promise<void> }> {
  const app = createApp();
  app.use(errorHandler);
  const server: Server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    stop: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

export type ApiError = { message: string; appCode?: string; httpStatus?: number };

/** One signed-in browser session: its own cookie, tRPC calls and SSE stream. */
export class Session {
  cookie = "";
  readonly events: RealtimeEvent[] = [];
  private controller: AbortController | null = null;

  constructor(private readonly base: string) {}

  async login(email: string, password = TEST_PASSWORD) {
    const response = await fetch(`${this.base}/api/trpc/auth.login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(superjson.serialize({ email, password })),
    });
    if (!response.ok) throw new Error(`login failed for ${email}: ${response.status}`);
    this.cookie = response.headers.getSetCookie()[0].split(";")[0];
    return this;
  }

  async mutate<T = unknown>(path: string, input?: unknown): Promise<T> {
    const response = await fetch(`${this.base}/api/trpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: this.cookie },
      body: JSON.stringify(superjson.serialize(input)),
    });
    return this.unwrap<T>(response);
  }

  async query<T = unknown>(path: string, input?: unknown): Promise<T> {
    const url = `${this.base}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`;
    return this.unwrap<T>(await fetch(url, { headers: { cookie: this.cookie } }));
  }

  private async unwrap<T>(response: Response): Promise<T> {
    const body = await response.json();
    if (body.error) {
      const error = new Error(body.error.json.message) as Error & ApiError;
      error.appCode = body.error.json.data?.appCode;
      error.httpStatus = response.status;
      throw error;
    }
    return superjson.deserialize(body.result.data) as T;
  }

  /** Opens this session's realtime stream and records every event. */
  async listen() {
    this.controller = new AbortController();
    const response = await fetch(`${this.base}/api/realtime`, { headers: { cookie: this.cookie }, signal: this.controller.signal });
    if (response.status !== 200) throw new Error(`realtime refused: ${response.status}`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find(l => l.startsWith("data: "));
            if (line) this.events.push(JSON.parse(line.slice(6)));
          }
        }
      } catch {
        /* aborted */
      }
    })();
    await this.waitFor(e => e.type === "hello");
    return this;
  }

  async waitFor(predicate: (event: RealtimeEvent) => boolean, timeoutMs = 3000): Promise<RealtimeEvent> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = this.events.find(predicate);
      if (found) return found;
      await new Promise(r => setTimeout(r, 15));
    }
    throw new Error(`timed out; saw: ${this.events.map(e => e.type + ("notificationType" in e ? `:${e.notificationType}` : "")).join(", ")}`);
  }

  notificationTypes() {
    return this.events.flatMap(e => (e.type === "notification.created" ? [e.notificationType] : []));
  }

  close() {
    this.controller?.abort();
  }
}
