import { useSyncExternalStore } from "react";

/**
 * Server-synchronised clock. Countdowns derive from (estimate, estimateUpdatedAt) using server time,
 * so every client shows the same remaining time regardless of its local clock.
 */
let offsetMs = 0;
export function syncServerTime(serverTime: number | string | Date) {
  const server = new Date(serverTime).getTime();
  if (Number.isFinite(server)) offsetMs = server - Date.now();
}
export const serverNow = () => Date.now() + offsetMs;

// One shared 1-second ticker for every countdown on the page.
const listeners = new Set<() => void>();
let timer: number | undefined;
let tick = 0;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined) {
    timer = window.setInterval(() => {
      tick++;
      listeners.forEach(l => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useTick() {
  return useSyncExternalStore(subscribe, () => tick);
}

export function useRemainingSeconds(
  estimateSeconds: number,
  estimateUpdatedAt: Date | string
) {
  useTick();
  const elapsed = (serverNow() - new Date(estimateUpdatedAt).getTime()) / 1000;
  return Math.max(0, Math.round(estimateSeconds - elapsed));
}
