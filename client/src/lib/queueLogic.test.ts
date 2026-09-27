import { describe, expect, it } from "vitest";
import { getPeopleAhead, getTokenWait, type QueueEntry, type QueueState } from "./demoStore";

const service = {
  id: "admissions",
  name: "Admissions Office",
  description: "Student records",
  prefix: "A",
  averageServiceTime: 3,
  physicalCount: 4,
  status: "OPEN" as const,
  accent: "violet",
};

const entry = (number: number, status: QueueEntry["status"] = "WAITING"): QueueEntry => ({
  id: `a-${number}`,
  serviceId: "admissions",
  tokenNumber: `A${String(number).padStart(3, "0")}`,
  number,
  status,
  joinedAt: Date.now(),
  userLabel: number === 18 ? "Demo student" : "Student",
});

const state: QueueState = {
  services: [service],
  entries: [entry(14, "SERVING"), entry(15), entry(16), entry(17), entry(18)],
  stats: { servedToday: 42, completed: 42, cancelled: 0, skipped: 0, totalServiceMinutes: 126 },
  lastUpdated: Date.now(),
};

describe("QueueSense queue calculations", () => {
  it("counts only lower-numbered waiting tokens ahead of a student", () => {
    expect(getPeopleAhead(state, state.entries[4])).toBe(3);
  });

  it("converts digital position into an explicitly approximate wait", () => {
    expect(getTokenWait(state, state.entries[4])).toBe(9);
  });

  it("keeps completed and cancelled tokens out of the active position calculation", () => {
    const nextState = { ...state, entries: [...state.entries.slice(0, 3), { ...state.entries[3], status: "CANCELLED" as const }, state.entries[4]] };
    expect(getPeopleAhead(nextState, nextState.entries[4])).toBe(2);
    expect(getTokenWait(nextState, nextState.entries[4])).toBe(6);
  });
});
