import { TRAFFIC_LEVELS, TRAFFIC_MULTIPLIER, type TrafficLevel } from "../../shared/domain";

/**
 * Explainable wait estimation. Estimates are approximations, never appointments.
 *
 *   cyclesAhead   = floor(peopleAhead / serveCapacity)
 *   cycleSeconds  = serviceSeconds × trafficMultiplier(effectiveTraffic)
 *   inProgress    = remaining time of the batch currently at the counter (≥ 15% of a cycle)
 *   estimate      = cyclesAhead × cycleSeconds + inProgress + staffDelaySeconds
 *
 * The camera never adds people to `peopleAhead` (that would double-count token holders who are
 * standing nearby). It can only raise the effective traffic level — see `effectiveTraffic`.
 */

export type EstimateInput = {
  peopleAhead: number;
  serviceSeconds: number;
  serveCapacity: number;
  traffic: TrafficLevel;
  delaySeconds: number;
  /** Seconds the batch currently being called/served has been at the counter; null when idle. */
  inProgressElapsedSeconds: number | null;
};

export type EstimateBreakdown = {
  seconds: number;
  cyclesAhead: number;
  cycleSeconds: number;
  inProgressSeconds: number;
  delaySeconds: number;
  multiplier: number;
};

export const MIN_IN_PROGRESS_SHARE = 0.15;

export function estimateWait(input: EstimateInput): EstimateBreakdown {
  const capacity = Math.max(1, Math.floor(input.serveCapacity));
  const multiplier = TRAFFIC_MULTIPLIER[input.traffic];
  const cycleSeconds = Math.round(Math.max(1, input.serviceSeconds) * multiplier);
  const cyclesAhead = Math.floor(Math.max(0, input.peopleAhead) / capacity);
  const inProgressSeconds =
    input.inProgressElapsedSeconds === null
      ? 0
      : Math.round(Math.max(cycleSeconds * MIN_IN_PROGRESS_SHARE, cycleSeconds - Math.max(0, input.inProgressElapsedSeconds)));
  const delaySeconds = Math.max(0, Math.round(input.delaySeconds));
  return {
    seconds: cyclesAhead * cycleSeconds + inProgressSeconds + delaySeconds,
    cyclesAhead,
    cycleSeconds,
    inProgressSeconds,
    delaySeconds,
    multiplier,
  };
}

/**
 * Blends the configured service time with recently observed service durations. With fewer than
 * `minSamples` observations the configured value is used unchanged. The result is clamped to
 * 0.5×–2× the configured value so one unusual transaction cannot distort every estimate.
 */
export function blendServiceSeconds(configured: number, observedSeconds: number[], minSamples = 5): number {
  const samples = observedSeconds.filter(value => Number.isFinite(value) && value > 0);
  if (samples.length < minSamples) return configured;
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const blended = 0.5 * configured + 0.5 * median;
  return Math.round(Math.min(configured * 2, Math.max(configured * 0.5, blended)));
}

export function trafficFromCount(peopleCount: number, moderateAt: number, heavyAt: number): TrafficLevel {
  if (peopleCount >= heavyAt) return "HEAVY";
  if (peopleCount >= moderateAt) return "MODERATE";
  return "NORMAL";
}

/** Staff-set level, optionally raised (never lowered) by fresh camera congestion. */
export function effectiveTraffic(staffLevel: TrafficLevel, cameraLevel: TrafficLevel | null): TrafficLevel {
  if (!cameraLevel) return staffLevel;
  return TRAFFIC_LEVELS.indexOf(cameraLevel) > TRAFFIC_LEVELS.indexOf(staffLevel) ? cameraLevel : staffLevel;
}

/**
 * Whether a stored estimate should be replaced. Small differences are ignored so every client's
 * countdown keeps running smoothly instead of jumping on each recalculation.
 */
export function shouldRefreshEstimate(storedSeconds: number, storedAt: Date, nextSeconds: number, now: Date): boolean {
  const remaining = Math.max(0, storedSeconds - (now.getTime() - storedAt.getTime()) / 1000);
  return Math.abs(nextSeconds - remaining) >= Math.max(20, nextSeconds * 0.1);
}

/** A change is worth telling the student about only if it is both large and relative. */
export function isMeaningfulWaitChange(beforeSeconds: number, afterSeconds: number): boolean {
  const delta = afterSeconds - beforeSeconds;
  return Math.abs(delta) >= 120 && Math.abs(delta) >= Math.max(beforeSeconds, 60) * 0.2;
}

export function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
