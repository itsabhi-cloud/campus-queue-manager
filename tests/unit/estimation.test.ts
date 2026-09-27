import { describe, expect, it } from "vitest";
import {
  blendServiceSeconds,
  effectiveTraffic,
  estimateWait,
  isMeaningfulWaitChange,
  shouldRefreshEstimate,
  trafficFromCount,
} from "../../server/queue/estimation";

const base = { serviceSeconds: 120, serveCapacity: 1, traffic: "NORMAL" as const, delaySeconds: 0, inProgressElapsedSeconds: null };

describe("estimateWait", () => {
  it("is zero for the first person when the counter is idle", () => {
    expect(estimateWait({ ...base, peopleAhead: 0 }).seconds).toBe(0);
  });

  it("multiplies people ahead by service time", () => {
    expect(estimateWait({ ...base, peopleAhead: 3 }).seconds).toBe(360);
  });

  it("adds the remaining time of the token currently being served, never below 15% of a cycle", () => {
    expect(estimateWait({ ...base, peopleAhead: 1, inProgressElapsedSeconds: 30 }).seconds).toBe(120 + 90);
    expect(estimateWait({ ...base, peopleAhead: 0, inProgressElapsedSeconds: 600 }).inProgressSeconds).toBe(18);
  });

  it("applies traffic multipliers and a one-off staff delay", () => {
    const heavy = estimateWait({ ...base, peopleAhead: 2, traffic: "HEAVY", delaySeconds: 300 });
    expect(heavy.cycleSeconds).toBe(180);
    expect(heavy.seconds).toBe(2 * 180 + 300);
    expect(estimateWait({ ...base, peopleAhead: 4, traffic: "MODERATE" }).seconds).toBe(600);
  });

  it("serves batches for multi-capacity queues such as lifts", () => {
    const lift = { ...base, serviceSeconds: 90, serveCapacity: 8 };
    expect(estimateWait({ ...lift, peopleAhead: 7 }).seconds).toBe(0);
    expect(estimateWait({ ...lift, peopleAhead: 8 }).seconds).toBe(90);
    expect(estimateWait({ ...lift, peopleAhead: 17 }).seconds).toBe(180);
  });
});

describe("blendServiceSeconds", () => {
  it("keeps the configured value until enough observations exist", () => {
    expect(blendServiceSeconds(120, [60, 60, 60])).toBe(120);
  });
  it("blends with the median of recent observations", () => {
    expect(blendServiceSeconds(120, [60, 60, 60, 60, 60, 600])).toBe(90);
  });
  it("clamps to 0.5x–2x of the configured value", () => {
    expect(blendServiceSeconds(100, [1000, 1000, 1000, 1000, 1000])).toBe(200);
    expect(blendServiceSeconds(100, [1, 1, 1, 1, 1])).toBe(51);
  });
});

describe("camera traffic", () => {
  it("maps people counts to levels", () => {
    expect(trafficFromCount(2, 6, 12)).toBe("NORMAL");
    expect(trafficFromCount(6, 6, 12)).toBe("MODERATE");
    expect(trafficFromCount(15, 6, 12)).toBe("HEAVY");
  });
  it("can only raise, never lower, the staff-set level", () => {
    expect(effectiveTraffic("NORMAL", "HEAVY")).toBe("HEAVY");
    expect(effectiveTraffic("HEAVY", "NORMAL")).toBe("HEAVY");
    expect(effectiveTraffic("MODERATE", null)).toBe("MODERATE");
  });
});

describe("estimate stability", () => {
  const at = new Date("2026-01-01T10:00:00Z");
  it("does not rewrite an estimate that still matches the running countdown", () => {
    const later = new Date(at.getTime() + 120_000);
    expect(shouldRefreshEstimate(360, at, 240, later)).toBe(false);
  });
  it("rewrites an estimate that has drifted", () => {
    expect(shouldRefreshEstimate(360, at, 660, at)).toBe(true);
  });
  it("only calls large, relative changes meaningful", () => {
    expect(isMeaningfulWaitChange(360, 660)).toBe(true);
    expect(isMeaningfulWaitChange(360, 420)).toBe(false);
    expect(isMeaningfulWaitChange(3600, 3780)).toBe(false);
  });
});
