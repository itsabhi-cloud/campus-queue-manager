import { inArray } from "drizzle-orm";
import type { NotificationType } from "../../shared/domain";
import { notificationPreferences, notifications } from "../../drizzle/schema";
import type { Executor } from "../db/client";
import type { Effects } from "../lib/effects";

export type Preferences = {
  almostNext: boolean;
  positionChanges: boolean;
  waitChanges: boolean;
  counterStatus: boolean;
  almostNextThreshold: number;
};

export const DEFAULT_PREFERENCES: Preferences = {
  almostNext: true,
  positionChanges: true,
  waitChanges: true,
  counterStatus: true,
  almostNextThreshold: 2,
};

/** Informational notifications can be muted; transactional ones (called, cancelled…) cannot. */
const PREFERENCE_FOR: Partial<
  Record<NotificationType, keyof Omit<Preferences, "almostNextThreshold">>
> = {
  ALMOST_NEXT: "almostNext",
  POSITION_CHANGED: "positionChanges",
  PRIORITY_ADJUSTMENT: "positionChanges",
  WAIT_INCREASED: "waitChanges",
  WAIT_DECREASED: "waitChanges",
  COUNTER_PAUSED: "counterStatus",
  COUNTER_RESUMED: "counterStatus",
  COUNTER_OFFLINE: "counterStatus",
};

export async function loadPreferences(
  executor: Executor,
  userIds: number[]
): Promise<Map<number, Preferences>> {
  const map = new Map<number, Preferences>();
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return map;
  const rows = await executor
    .select()
    .from(notificationPreferences)
    .where(inArray(notificationPreferences.userId, unique));
  unique.forEach(id => map.set(id, DEFAULT_PREFERENCES));
  rows.forEach(row =>
    map.set(row.userId, {
      almostNext: row.almostNext,
      positionChanges: row.positionChanges,
      waitChanges: row.waitChanges,
      counterStatus: row.counterStatus,
      almostNextThreshold: row.almostNextThreshold,
    })
  );
  return map;
}

export type NotificationInput = {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  queueEntryId?: number | null;
  tokenNumber?: string | null;
};

/** Creates notifications (respecting preferences) and schedules realtime delivery after commit. */
export async function notify(
  executor: Executor,
  fx: Effects,
  inputs: NotificationInput[],
  prefs?: Map<number, Preferences>
) {
  if (inputs.length === 0) return;
  const preferences =
    prefs ??
    (await loadPreferences(
      executor,
      inputs.map(input => input.userId)
    ));
  for (const input of inputs) {
    const key = PREFERENCE_FOR[input.type];
    const pref = preferences.get(input.userId) ?? DEFAULT_PREFERENCES;
    if (key && !pref[key]) continue;
    const [row] = await executor
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        queueEntryId: input.queueEntryId ?? null,
        tokenNumber: input.tokenNumber ?? null,
      })
      .$returningId();
    fx.toUser(input.userId, {
      type: "notification.created",
      notificationId: row.id,
      title: input.title,
      message: input.message,
      notificationType: input.type,
    });
  }
}
