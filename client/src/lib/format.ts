import type { CounterStatus, QueueStatus, TrafficLevel } from "@shared/domain";

export function countdownLabel(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function approxMinutes(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return "< 1 min";
  const minutes = Math.round(seconds / 60);
  return minutes >= 90
    ? `~${Math.round(minutes / 6) / 10} h`
    : `~${minutes} min`;
}

export function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function relativeTime(
  date: Date | string | number | null | undefined,
  now = Date.now()
): string {
  if (!date) return "—";
  const diff = (new Date(date).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86_400), "day");
}

export function dateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function timeOnly(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const STATUS_LABEL: Record<QueueStatus, string> = {
  WAITING: "Waiting",
  CALLED: "Called",
  SERVING: "Being served",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
  CANCELLED: "Cancelled",
};

export const COUNTER_LABEL: Record<CounterStatus, string> = {
  OPEN: "Open",
  PAUSED: "Paused",
  OFFLINE: "Offline",
};
export const TRAFFIC_LABEL: Record<TrafficLevel, string> = {
  NORMAL: "Normal",
  MODERATE: "Moderate",
  HEAVY: "Heavy",
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("");
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function unitNoun(unit: string, count: number) {
  if (count === 1) return unit === "people" ? "person" : unit.replace(/s$/, "");
  return unit;
}
