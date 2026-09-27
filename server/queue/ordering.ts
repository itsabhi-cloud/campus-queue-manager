import type { MergeStrategy } from "../../shared/domain";

export type Orderable = {
  id: number;
  isPriority: boolean;
  priorityAt: Date | null;
  orderKey: number;
  joinedAt: Date;
};

/** Priority tokens first (earliest priority first), then everyone else by order key. */
export function compareWaiting(a: Orderable, b: Orderable): number {
  if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
  if (a.isPriority && b.isPriority) {
    const diff =
      (a.priorityAt?.getTime() ?? 0) - (b.priorityAt?.getTime() ?? 0);
    if (diff !== 0) return diff;
  }
  return a.orderKey - b.orderKey || a.id - b.id;
}

export function orderWaiting<T extends Orderable>(entries: T[]): T[] {
  return [...entries].sort(compareWaiting);
}

/** 1-based positions keyed by entry id. */
export function positionsOf<T extends Orderable>(
  entries: T[]
): Map<number, number> {
  return new Map(
    orderWaiting(entries).map((entry, index) => [entry.id, index + 1])
  );
}

/**
 * Weaves two waiting lines into one when a counter's queue is merged into another.
 * - ALTERNATE: T1, S1, T2, S2, … (fair to both lines; the receiving line goes first)
 * - JOIN_TIME: strictly by original join time
 * - APPEND:    the receiving line first, then the merged line
 * Priority entries are not part of this ordering; they always sort first.
 */
export function mergeLines<T extends Orderable>(
  target: T[],
  source: T[],
  strategy: MergeStrategy
): T[] {
  const t = orderWaiting(target);
  const s = orderWaiting(source);
  switch (strategy) {
    case "APPEND":
      return [...t, ...s];
    case "JOIN_TIME":
      return [...t, ...s].sort(
        (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || a.id - b.id
      );
    case "ALTERNATE": {
      const out: T[] = [];
      for (let i = 0; i < Math.max(t.length, s.length); i++) {
        if (i < t.length) out.push(t[i]);
        if (i < s.length) out.push(s[i]);
      }
      return out;
    }
  }
}
