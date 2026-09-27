import { EventEmitter } from "node:events";
import type { RealtimeEvent } from "../../shared/domain";

export type Audience = { kind: "all" } | { kind: "user"; userId: number };

type Listener = (event: RealtimeEvent) => void;

/**
 * In-process pub/sub. Every API instance holds its own SSE connections, so a horizontally scaled
 * deployment must replace this with a shared bus (e.g. Redis pub/sub) behind the same interface.
 */
class RealtimeBroker {
  private readonly emitter = new EventEmitter();
  private connections = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(audience: Audience, event: RealtimeEvent) {
    this.emitter.emit(
      audience.kind === "all" ? "all" : `user:${audience.userId}`,
      event
    );
  }

  subscribe(userId: number, listener: Listener): () => void {
    this.connections += 1;
    this.emitter.on("all", listener);
    this.emitter.on(`user:${userId}`, listener);
    return () => {
      this.connections -= 1;
      this.emitter.off("all", listener);
      this.emitter.off(`user:${userId}`, listener);
    };
  }

  get connectionCount() {
    return this.connections;
  }
}

export const broker = new RealtimeBroker();
