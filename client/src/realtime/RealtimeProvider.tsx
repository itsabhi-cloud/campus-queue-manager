import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { RealtimeEvent } from "@shared/domain";
import { syncServerTime } from "@/lib/clock";
import { trpc } from "@/lib/trpc";

export type ConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";

type RealtimeContextValue = {
  state: ConnectionState;
  lastEventAt: number | null;
  /** Fallback polling interval for key queries while the live connection is down. */
  pollInterval: number | false;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  state: "offline",
  lastEventAt: null,
  pollInterval: 20_000,
});
export const useRealtime = () => useContext(RealtimeContext);

const BACKOFF = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

function showBrowserNotification(title: string, body: string) {
  try {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      document.visibilityState === "hidden"
    ) {
      new Notification(title, { body, tag: title });
    }
  } catch {
    // Browser notifications are optional.
  }
}

/**
 * Subscribes to the server's SSE stream while signed in. Events are invalidation hints: the client
 * always refetches authoritative state, and it resynchronises everything after any reconnect.
 */
export function RealtimeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const [state, setState] = useState<ConnectionState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const pending = useRef(new Set<string>());
  const flushTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setState("offline");
      return;
    }
    let source: EventSource | null = null;
    let attempt = 0;
    let everConnected = false;
    let retryTimer: number | undefined;
    let disposed = false;

    // Coalesce bursts of events into one refetch per query family.
    const invalidate = (...keys: string[]) => {
      keys.forEach(key => pending.current.add(key));
      if (flushTimer.current !== undefined) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = undefined;
        const keysNow = new Set(pending.current);
        pending.current.clear();
        if (keysNow.has("all")) return void utils.invalidate();
        if (keysNow.has("catalog")) void utils.catalog.invalidate();
        if (keysNow.has("mine")) {
          void utils.queue.myActive.invalidate();
          void utils.queue.entry.invalidate();
          void utils.queue.history.invalidate();
        }
        if (keysNow.has("staff")) void utils.staff.board.invalidate();
        if (keysNow.has("staffCounters"))
          void utils.staff.myCounters.invalidate();
        if (keysNow.has("notifications")) void utils.notifications.invalidate();
        if (keysNow.has("admin")) {
          void utils.admin.overview.invalidate();
          void utils.admin.catalog.invalidate();
        }
        if (keysNow.has("camera")) void utils.camera.stations.invalidate();
      }, 200);
    };

    const handle = (event: RealtimeEvent) => {
      setLastEventAt(Date.now());
      switch (event.type) {
        case "hello":
          syncServerTime(event.serverTime);
          // Anything could have changed while we were disconnected.
          if (everConnected) invalidate("all");
          everConnected = true;
          break;
        case "queue.changed":
          invalidate("catalog", "mine", "staff", "admin");
          break;
        case "entry.changed":
          invalidate("mine");
          break;
        case "notification.created":
          invalidate("notifications", "mine");
          // Joining already shows its own confirmation in the page that performed it.
          if (event.notificationType !== "QUEUE_JOINED") {
            toast(event.title, {
              description: event.message,
              duration:
                event.notificationType === "TOKEN_CALLED" ? 20_000 : 7_000,
            });
          }
          showBrowserNotification(event.title, event.message);
          break;
        case "camera.updated":
          invalidate("catalog", "camera", "admin", "staff");
          break;
        case "catalog.changed":
          invalidate("catalog", "staffCounters", "admin", "staff");
          break;
        case "session.revoked":
          source?.close();
          void utils.auth.me.invalidate();
          break;
      }
    };

    const connect = () => {
      if (disposed) return;
      setState(attempt === 0 && !everConnected ? "connecting" : "reconnecting");
      source = new EventSource("/api/realtime", { withCredentials: true });
      source.onopen = () => {
        attempt = 0;
        setState("live");
      };
      source.onmessage = message => {
        try {
          handle(JSON.parse(message.data) as RealtimeEvent);
        } catch {
          // Ignore malformed frames.
        }
      };
      source.onerror = () => {
        // EventSource retries transient errors itself; it only gives up (CLOSED) on e.g. 401.
        if (source?.readyState === EventSource.CLOSED) {
          source.close();
          setState(navigator.onLine ? "reconnecting" : "offline");
          const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
          attempt++;
          void utils.auth.me.invalidate();
          retryTimer = window.setTimeout(connect, delay);
        } else {
          setState("reconnecting");
        }
      };
    };

    const onOnline = () => {
      if (source?.readyState === EventSource.CLOSED) {
        window.clearTimeout(retryTimer);
        attempt = 0;
        connect();
      }
    };
    const onOffline = () => setState("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      source?.close();
    };
  }, [enabled, utils]);

  const pollInterval = state === "live" ? false : 20_000;
  return (
    <RealtimeContext.Provider value={{ state, lastEventAt, pollInterval }}>
      {children}
    </RealtimeContext.Provider>
  );
}
