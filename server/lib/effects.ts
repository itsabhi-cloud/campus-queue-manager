import type { QueueEventType, RealtimeEvent } from "../../shared/domain";
import { broker } from "../realtime/broker";

/**
 * Side effects collected during a transaction and released only after it commits, so clients are
 * never told about state that was rolled back.
 */
export class Effects {
  private readonly counterIds = new Set<number>();
  private readonly groupIds = new Set<number>();
  private readonly entryIdsByUser = new Map<number, Set<number>>();
  private readonly userEvents: Array<{ userId: number; event: RealtimeEvent }> =
    [];
  private readonly broadcast: RealtimeEvent[] = [];
  private reason: QueueEventType | "CONFIG" = "CONFIG";

  queueChanged(
    counterIds: number[],
    groupIds: number[],
    reason: QueueEventType | "CONFIG"
  ) {
    counterIds.forEach(id => this.counterIds.add(id));
    groupIds.forEach(id => this.groupIds.add(id));
    this.reason = reason;
  }

  entryChanged(userId: number, entryId: number) {
    const set = this.entryIdsByUser.get(userId) ?? new Set<number>();
    set.add(entryId);
    this.entryIdsByUser.set(userId, set);
  }

  toUser(userId: number, event: RealtimeEvent) {
    this.userEvents.push({ userId, event });
  }

  toAll(event: RealtimeEvent) {
    this.broadcast.push(event);
  }

  get hasEntryChanges() {
    return this.entryIdsByUser.size > 0;
  }

  flush() {
    if (this.counterIds.size || this.groupIds.size) {
      broker.publish(
        { kind: "all" },
        {
          type: "queue.changed",
          counterIds: [...this.counterIds],
          queueGroupIds: [...this.groupIds],
          reason: this.reason,
        }
      );
    }
    this.entryIdsByUser.forEach((ids, userId) => {
      broker.publish(
        { kind: "user", userId },
        { type: "entry.changed", entryIds: [...ids] }
      );
    });
    this.userEvents.forEach(({ userId, event }) =>
      broker.publish({ kind: "user", userId }, event)
    );
    this.broadcast.forEach(event => broker.publish({ kind: "all" }, event));
  }
}
