import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type QueueStatus = "WAITING" | "CALLED" | "SERVING" | "COMPLETED" | "SKIPPED" | "CANCELLED";

export type Service = {
  id: string;
  name: string;
  description: string;
  prefix: string;
  averageServiceTime: number;
  physicalCount: number;
  status: "OPEN" | "PAUSED";
  accent: string;
};

export type QueueEntry = {
  id: string;
  serverId?: number;
  serviceId: string;
  tokenNumber: string;
  number: number;
  status: QueueStatus;
  joinedAt: number;
  userLabel: string;
  calledAt?: number;
  servingAt?: number;
  completedAt?: number;
};

export type QueueStats = {
  servedToday: number;
  completed: number;
  cancelled: number;
  skipped: number;
  totalServiceMinutes: number;
};

export type QueueState = {
  services: Service[];
  entries: QueueEntry[];
  stats: QueueStats;
  lastUpdated: number;
};

const STORAGE_KEY = "queuesense-demo-state-v1";
const CHANNEL_NAME = "queuesense-demo-sync-v1";

const seedState: QueueState = {
  services: [
    {
      id: "admissions",
      name: "Admissions Office",
      description: "Enrollment, ID cards, and student records",
      prefix: "A",
      averageServiceTime: 3,
      physicalCount: 4,
      status: "OPEN",
      accent: "violet",
    },
    {
      id: "accounts",
      name: "Accounts Office",
      description: "Fees, payments, and scholarship support",
      prefix: "F",
      averageServiceTime: 4,
      physicalCount: 7,
      status: "OPEN",
      accent: "blue",
    },
    {
      id: "library",
      name: "Library Help Desk",
      description: "Access, renewals, and research assistance",
      prefix: "L",
      averageServiceTime: 3,
      physicalCount: 2,
      status: "OPEN",
      accent: "teal",
    },
    {
      id: "certificates",
      name: "Certificate Counter",
      description: "Bonafide, transcripts, and certificates",
      prefix: "C",
      averageServiceTime: 5,
      physicalCount: 5,
      status: "OPEN",
      accent: "orange",
    },
  ],
  entries: [
    ...[14, 15, 16, 17, 18, 19].map((number, index): QueueEntry => ({
      id: `admissions-${number}`,
      serviceId: "admissions",
      tokenNumber: `A${String(number).padStart(3, "0")}`,
      number,
      status: number === 14 ? "SERVING" : "WAITING",
      joinedAt: Date.now() - (index + 1) * 1000 * 60 * 4,
      userLabel: number === 18 ? "Demo student" : "Waiting student",
      servingAt: number === 14 ? Date.now() - 1000 * 60 * 2 : undefined,
    })),
    ...[8, 9, 10].map((number, index): QueueEntry => ({
      id: `library-${number}`,
      serviceId: "library",
      tokenNumber: `L${String(number).padStart(3, "0")}`,
      number,
      status: index === 0 ? "SERVING" : "WAITING",
      joinedAt: Date.now() - (index + 2) * 1000 * 60 * 3,
      userLabel: "Waiting student",
      servingAt: index === 0 ? Date.now() - 1000 * 60 : undefined,
    })),
    ...[21, 22, 23, 24, 25].map((number): QueueEntry => ({
      id: `accounts-${number}`,
      serviceId: "accounts",
      tokenNumber: `F${String(number).padStart(3, "0")}`,
      number,
      status: "WAITING",
      joinedAt: Date.now() - 1000 * 60 * 10,
      userLabel: "Waiting student",
    })),
  ],
  stats: {
    servedToday: 42,
    completed: 42,
    cancelled: 3,
    skipped: 2,
    totalServiceMinutes: 134,
  },
  lastUpdated: Date.now(),
};

function cloneSeed(): QueueState {
  return JSON.parse(JSON.stringify(seedState)) as QueueState;
}

function readState(): QueueState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as QueueState;
  } catch {
    // Fall back to the deterministic demo state when storage is unavailable.
  }
  return cloneSeed();
}

function writeState(next: QueueState) {
  const stamped = { ...next, lastUpdated: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
    window.dispatchEvent(new CustomEvent("queuesense-state", { detail: stamped }));
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(stamped);
    channel.close();
  } catch {
    // In-memory mode still keeps the current tab usable.
  }
  return stamped;
}

const activeStatuses: QueueStatus[] = ["WAITING", "CALLED", "SERVING"];

export function useQueueStore() {
  const [state, setState] = useState<QueueState>(() => readState());
  const queueEventMutation = trpc.queue.event.useMutation();
  const previousEntriesRef = useRef(state.entries);

  useEffect(() => {
    const previousById = new Map(previousEntriesRef.current.map((entry) => [entry.id, entry]));
    state.entries.forEach((entry) => {
      const previous = previousById.get(entry.id);
      if (entry.serverId && previous && previous.status !== entry.status) {
        const eventType = entry.status === "CALLED" || entry.status === "SERVING" || entry.status === "COMPLETED" || entry.status === "SKIPPED" || entry.status === "CANCELLED"
          ? entry.status
          : undefined;
        if (!eventType) return;
        queueEventMutation.mutate({
          queueEntryId: entry.serverId,
          eventType,
          metadata: { source: "demo-store", previousStatus: previous.status },
        });
      }
    });
    previousEntriesRef.current = state.entries;
  }, [queueEventMutation, state.entries]);

  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (event as CustomEvent<QueueState>).detail;
      if (detail?.lastUpdated > state.lastUpdated) setState(detail);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const next = JSON.parse(event.newValue) as QueueState;
          if (next.lastUpdated > state.lastUpdated) setState(next);
        } catch {
          // Ignore malformed external state.
        }
      }
    };
    let channel: BroadcastChannel | undefined;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        const next = event.data as QueueState;
        if (next?.lastUpdated > state.lastUpdated) setState(next);
      };
    }
    window.addEventListener("queuesense-state", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("queuesense-state", sync);
      window.removeEventListener("storage", onStorage);
      channel?.close();
    };
  }, [state.lastUpdated]);

  const commit = useCallback((updater: (current: QueueState) => QueueState) => {
    setState((current) => writeState(updater(current)));
  }, []);

  const actions = useMemo(() => ({
    joinQueue: (serviceId: string, userLabel = "You") => {
      let created: QueueEntry | undefined;
      commit((current) => {
        const service = current.services.find((item) => item.id === serviceId);
        if (!service || service.status === "PAUSED") return current;
        const existing = current.entries.find(
          (entry) => entry.serviceId === serviceId && entry.userLabel === userLabel && activeStatuses.includes(entry.status),
        );
        if (existing) {
          created = existing;
          return current;
        }
        const highest = Math.max(0, ...current.entries.filter((entry) => entry.serviceId === serviceId).map((entry) => entry.number));
        const number = highest + 1;
        created = {
          id: `${serviceId}-${number}-${Date.now()}`,
          serviceId,
          tokenNumber: `${service.prefix}${String(number).padStart(3, "0")}`,
          number,
          status: "WAITING",
          joinedAt: Date.now(),
          userLabel,
        };
        return { ...current, entries: [...current.entries, created] };
      });
      return created;
    },
    cancelToken: (entryId: string) => commit((current) => {
      const entry = current.entries.find((item) => item.id === entryId);
      if (!entry || !activeStatuses.includes(entry.status)) return current;
      return {
        ...current,
        entries: current.entries.map((item) => item.id === entryId ? { ...item, status: "CANCELLED" } : item),
        stats: { ...current.stats, cancelled: current.stats.cancelled + 1 },
      };
    }),
    callNext: (serviceId: string) => commit((current) => {
      const service = current.services.find((item) => item.id === serviceId);
      if (!service || service.status === "PAUSED") return current;
      const hasCurrent = current.entries.some((entry) => entry.serviceId === serviceId && ["CALLED", "SERVING"].includes(entry.status));
      if (hasCurrent) return current;
      const next = current.entries
        .filter((entry) => entry.serviceId === serviceId && entry.status === "WAITING")
        .sort((a, b) => a.number - b.number)[0];
      if (!next) return current;
      return {
        ...current,
        entries: current.entries.map((item) => item.id === next.id ? { ...item, status: "CALLED", calledAt: Date.now() } : item),
      };
    }),
    startServing: (serviceId: string) => commit((current) => {
      const currentEntry = current.entries.find((entry) => entry.serviceId === serviceId && entry.status === "CALLED");
      if (!currentEntry) return current;
      return {
        ...current,
        entries: current.entries.map((item) => item.id === currentEntry.id ? { ...item, status: "SERVING", servingAt: Date.now() } : item),
      };
    }),
    completeCurrent: (serviceId: string) => commit((current) => {
      const currentEntry = current.entries.find((entry) => entry.serviceId === serviceId && ["CALLED", "SERVING"].includes(entry.status));
      if (!currentEntry) return current;
      return {
        ...current,
        entries: current.entries.map((item) => item.id === currentEntry.id ? { ...item, status: "COMPLETED", completedAt: Date.now() } : item),
        stats: {
          ...current.stats,
          servedToday: current.stats.servedToday + 1,
          completed: current.stats.completed + 1,
          totalServiceMinutes: current.stats.totalServiceMinutes + (current.services.find((service) => service.id === serviceId)?.averageServiceTime ?? 3),
        },
      };
    }),
    skipCurrent: (serviceId: string) => commit((current) => {
      const currentEntry = current.entries.find((entry) => entry.serviceId === serviceId && ["CALLED", "SERVING"].includes(entry.status));
      if (!currentEntry) return current;
      return {
        ...current,
        entries: current.entries.map((item) => item.id === currentEntry.id ? { ...item, status: "SKIPPED" } : item),
        stats: { ...current.stats, skipped: current.stats.skipped + 1 },
      };
    }),
    togglePause: (serviceId: string) => commit((current) => ({
      ...current,
      services: current.services.map((service) => service.id === serviceId ? { ...service, status: service.status === "OPEN" ? "PAUSED" : "OPEN" } : service),
    })),
    setPhysicalCount: (serviceId: string, count: number) => commit((current) => ({
      ...current,
      services: current.services.map((service) => service.id === serviceId ? { ...service, physicalCount: Math.max(0, Math.round(count)) } : service),
    })),
    resetDemo: () => setState(writeState(cloneSeed())),
  }), [commit]);

  const derived = useMemo(() => {
    const serviceById = new Map(state.services.map((service) => [service.id, service]));
    const forService = (serviceId: string) => state.entries
      .filter((entry) => entry.serviceId === serviceId)
      .sort((a, b) => a.number - b.number);
    const currentToken = (serviceId: string) => {
      const entries = forService(serviceId);
      return entries.find((entry) => entry.status === "SERVING") ?? entries.find((entry) => entry.status === "CALLED") ?? [...entries].reverse().find((entry) => entry.status === "COMPLETED");
    };
    const waitingEntries = (serviceId: string) => forService(serviceId).filter((entry) => entry.status === "WAITING");
    const serviceSummary = (serviceId: string) => {
      const service = serviceById.get(serviceId);
      if (!service) return undefined;
      const waiting = waitingEntries(serviceId);
      return {
        service,
        entries: forService(serviceId),
        waiting,
        current: currentToken(serviceId),
        activeCount: waiting.length,
        estimatedWait: service.physicalCount * service.averageServiceTime,
      };
    };
    return { serviceById, forService, currentToken, waitingEntries, serviceSummary };
  }, [state]);

  return { state, actions, derived };
}

export function getPeopleAhead(state: QueueState, entry: QueueEntry) {
  return state.entries.filter((item) => item.serviceId === entry.serviceId && item.status === "WAITING" && item.number < entry.number).length;
}

export function getTokenWait(state: QueueState, entry: QueueEntry) {
  const service = state.services.find((item) => item.id === entry.serviceId);
  return getPeopleAhead(state, entry) * (service?.averageServiceTime ?? 3);
}

export function getStats(state: QueueState) {
  return {
    ...state.stats,
    averageServiceTime: state.stats.servedToday ? (state.stats.totalServiceMinutes / state.stats.servedToday).toFixed(1) : "0.0",
    currentlyWaiting: state.entries.filter((entry) => entry.status === "WAITING").length,
  };
}
