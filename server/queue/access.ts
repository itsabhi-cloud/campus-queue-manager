import { and, eq, inArray } from "drizzle-orm";
import { counters, staffCounterAssignments } from "../../drizzle/schema";
import type { SessionUser } from "../auth/sessions";
import { fail } from "../_core/errors";
import type { Executor } from "../db/client";

/** Counter ids the user may operate. `null` means every counter (admins). */
export async function operableCounterIds(executor: Executor, user: SessionUser): Promise<number[] | null> {
  if (user.role === "ADMIN") return null;
  if (user.role !== "STAFF") return [];
  const rows = await executor
    .select({ counterId: staffCounterAssignments.counterId })
    .from(staffCounterAssignments)
    .where(eq(staffCounterAssignments.staffUserId, user.id));
  return rows.map(row => row.counterId);
}

/** Object-level authorization: staff may only act on counters an admin assigned to them. */
export async function assertCounterAccess(executor: Executor, user: SessionUser, counterId: number) {
  if (user.role === "ADMIN") return;
  if (user.role === "STAFF") {
    const [row] = await executor
      .select({ id: staffCounterAssignments.id })
      .from(staffCounterAssignments)
      .where(and(eq(staffCounterAssignments.staffUserId, user.id), eq(staffCounterAssignments.counterId, counterId)))
      .limit(1);
    if (row) return;
  }
  fail("FORBIDDEN", "You are not assigned to this counter.");
}

/** Group-level actions (traffic) require an assignment to at least one counter in the group. */
export async function assertGroupAccess(executor: Executor, user: SessionUser, queueGroupId: number) {
  if (user.role === "ADMIN") return;
  if (user.role === "STAFF") {
    const groupCounters = await executor.select({ id: counters.id }).from(counters).where(eq(counters.queueGroupId, queueGroupId));
    if (groupCounters.length > 0) {
      const [row] = await executor
        .select({ id: staffCounterAssignments.id })
        .from(staffCounterAssignments)
        .where(
          and(
            eq(staffCounterAssignments.staffUserId, user.id),
            inArray(
              staffCounterAssignments.counterId,
              groupCounters.map(counter => counter.id)
            )
          )
        )
        .limit(1);
      if (row) return;
    }
  }
  fail("FORBIDDEN", "You are not assigned to this queue.");
}
