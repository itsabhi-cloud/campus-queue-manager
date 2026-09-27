import type { Request, Response } from "express";
import type { RealtimeEvent } from "../../shared/domain";
import { readSessionToken, resolveSession } from "../auth/sessions";
import { logger } from "../_core/logger";
import { broker } from "./broker";

const HEARTBEAT_MS = 25_000;
const REVALIDATE_MS = 5 * 60_000;
const open = new Set<Response>();

/**
 * Server-Sent Events stream. Events carry identifiers only (never personal data); clients react by
 * refetching authoritative state. EventSource reconnects automatically, and clients resync on open.
 */
export async function realtimeHandler(req: Request, res: Response) {
  const token = readSessionToken(req);
  const session = await resolveSession(token);
  if (!session) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const send = (event: RealtimeEvent) =>
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: "hello", serverTime: Date.now() });
  open.add(res);

  const close = () => {
    clearInterval(heartbeat);
    clearInterval(revalidate);
    unsubscribe();
    open.delete(res);
  };
  const unsubscribe = broker.subscribe(session.user.id, event => {
    send(event);
    if (event.type === "session.revoked") res.end();
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const revalidate = setInterval(async () => {
    try {
      if (!(await resolveSession(token))) {
        send({ type: "session.revoked" });
        res.end();
      }
    } catch (error) {
      logger.warn("SSE session revalidation failed", { error });
    }
  }, REVALIDATE_MS);
  req.on("close", close);
}

/** Ends every open stream (used during graceful shutdown); clients reconnect to another instance. */
export function closeAllStreams() {
  open.forEach(res => res.end());
  open.clear();
}
