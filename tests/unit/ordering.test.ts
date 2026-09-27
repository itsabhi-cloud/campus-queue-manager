import { describe, expect, it } from "vitest";
import { QUEUE_STATUSES } from "../../shared/domain";
import {
  mergeLines,
  orderWaiting,
  positionsOf,
} from "../../server/queue/ordering";
import { canTransition, TRANSITIONS } from "../../server/queue/stateMachine";

const entry = (
  id: number,
  orderKey: number,
  extra: Partial<{ isPriority: boolean; priorityAt: Date; joinedAt: Date }> = {}
) => ({
  id,
  orderKey,
  isPriority: extra.isPriority ?? false,
  priorityAt: extra.priorityAt ?? null,
  joinedAt: extra.joinedAt ?? new Date(2026, 0, 1, 9, 0, orderKey),
});

describe("queue ordering", () => {
  it("orders by order key", () => {
    expect(
      orderWaiting([entry(3, 30), entry(1, 10), entry(2, 20)]).map(e => e.id)
    ).toEqual([1, 2, 3]);
  });
  it("places priority tokens first, earliest priority first", () => {
    const list = [
      entry(1, 10),
      entry(2, 20, { isPriority: true, priorityAt: new Date(2) }),
      entry(3, 30, { isPriority: true, priorityAt: new Date(1) }),
    ];
    expect(orderWaiting(list).map(e => e.id)).toEqual([3, 2, 1]);
    expect(positionsOf(list).get(1)).toBe(3);
  });
});

describe("mergeLines", () => {
  const counterA = [entry(101, 1), entry(102, 2), entry(103, 3)];
  const counterB = [entry(201, 1), entry(202, 2)];
  it("ALTERNATE weaves A101, B101, A102, B102 …", () => {
    expect(mergeLines(counterA, counterB, "ALTERNATE").map(e => e.id)).toEqual([
      101, 201, 102, 202, 103,
    ]);
  });
  it("APPEND keeps the receiving line first", () => {
    expect(mergeLines(counterA, counterB, "APPEND").map(e => e.id)).toEqual([
      101, 102, 103, 201, 202,
    ]);
  });
  it("JOIN_TIME orders by original join time", () => {
    const a = [
      entry(1, 1, { joinedAt: new Date(10) }),
      entry(2, 2, { joinedAt: new Date(40) }),
    ];
    const b = [
      entry(3, 1, { joinedAt: new Date(20) }),
      entry(4, 2, { joinedAt: new Date(30) }),
    ];
    expect(mergeLines(a, b, "JOIN_TIME").map(e => e.id)).toEqual([1, 3, 4, 2]);
  });
  it("never loses or duplicates entries", () => {
    for (const strategy of ["ALTERNATE", "APPEND", "JOIN_TIME"] as const) {
      const ids = mergeLines(counterA, counterB, strategy).map(e => e.id);
      expect(new Set(ids).size).toBe(5);
    }
  });
});

describe("queue state machine", () => {
  it("allows the normal service path", () => {
    expect(canTransition("WAITING", "CALLED")).toBe(true);
    expect(canTransition("CALLED", "SERVING")).toBe(true);
    expect(canTransition("SERVING", "COMPLETED")).toBe(true);
  });
  it("rejects skipping states and leaving terminal states", () => {
    expect(canTransition("WAITING", "SERVING")).toBe(false);
    expect(canTransition("WAITING", "COMPLETED")).toBe(false);
    expect(canTransition("CALLED", "COMPLETED")).toBe(false);
    for (const terminal of ["COMPLETED", "SKIPPED", "CANCELLED"] as const) {
      for (const to of QUEUE_STATUSES)
        expect(canTransition(terminal, to)).toBe(false);
    }
  });
  it("defines every status", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...QUEUE_STATUSES].sort());
  });
});
