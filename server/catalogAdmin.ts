/** Admin management of services, queue groups, counters and staff assignments. */
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { MERGE_STRATEGIES, SERVICE_KINDS } from "../shared/domain";
import {
  cameraStations,
  counters,
  queueEntries,
  queueGroups,
  services,
  staffCounterAssignments,
  users,
} from "../drizzle/schema";
import type { SessionUser } from "./auth/sessions";
import { fail } from "./_core/errors";
import { db, isDuplicateKeyError, withTransaction } from "./db/client";
import { audit } from "./lib/audit";
import { broker } from "./realtime/broker";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, digits and hyphens."
  )
  .max(60);

export const serviceInput = z.object({
  id: z.number().int().positive().optional(),
  slug: slugSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(1000),
  kind: z.enum(SERVICE_KINDS),
  notice: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean(),
  displayOrder: z.number().int().min(0).max(999),
});

export const groupInput = z
  .object({
    id: z.number().int().positive().optional(),
    serviceId: z.number().int().positive(),
    slug: slugSchema,
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable().optional(),
    unitLabel: z.string().trim().min(2).max(24),
    averageServiceSeconds: z.number().int().min(10).max(7200),
    serveCapacity: z.number().int().min(1).max(50),
    maxWaiting: z.number().int().min(1).max(5000),
    mergeStrategy: z.enum(MERGE_STRATEGIES),
    cameraAssist: z.boolean(),
    cameraModerateAt: z.number().int().min(1).max(500),
    cameraHeavyAt: z.number().int().min(1).max(500),
    isActive: z.boolean(),
    displayOrder: z.number().int().min(0).max(999),
  })
  .refine(v => v.cameraHeavyAt > v.cameraModerateAt, {
    message: "Heavy threshold must be above the moderate threshold.",
    path: ["cameraHeavyAt"],
  });

export const counterInput = z.object({
  id: z.number().int().positive().optional(),
  queueGroupId: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  tokenPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z][A-Z0-9]{0,3}$/,
      "Prefix: 1–4 characters, starting with a letter."
    ),
  isActive: z.boolean(),
  displayOrder: z.number().int().min(0).max(999),
});

function changed() {
  broker.publish({ kind: "all" }, { type: "catalog.changed" });
}

async function activeCount(where: ReturnType<typeof eq>) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(queueEntries)
    .where(
      and(where, inArray(queueEntries.status, ["WAITING", "CALLED", "SERVING"]))
    );
  return n;
}

export async function adminCatalog() {
  const serviceRows = await db
    .select()
    .from(services)
    .orderBy(asc(services.displayOrder), asc(services.id));
  const groupRows = await db
    .select()
    .from(queueGroups)
    .orderBy(asc(queueGroups.displayOrder), asc(queueGroups.id));
  const counterRows = await db
    .select()
    .from(counters)
    .orderBy(asc(counters.displayOrder), asc(counters.id));
  const assignments = await db
    .select({
      counterId: staffCounterAssignments.counterId,
      staffUserId: users.id,
      name: users.name,
      status: users.status,
    })
    .from(staffCounterAssignments)
    .innerJoin(users, eq(users.id, staffCounterAssignments.staffUserId));
  const active = await db
    .select({ counterId: queueEntries.counterId, n: count() })
    .from(queueEntries)
    .where(inArray(queueEntries.status, ["WAITING", "CALLED", "SERVING"]))
    .groupBy(queueEntries.counterId);
  return serviceRows.map(service => ({
    ...service,
    groups: groupRows
      .filter(group => group.serviceId === service.id)
      .map(group => ({
        ...group,
        counters: counterRows
          .filter(counter => counter.queueGroupId === group.id)
          .map(counter => ({
            ...counter,
            activeEntries: active.find(a => a.counterId === counter.id)?.n ?? 0,
            staff: assignments
              .filter(a => a.counterId === counter.id)
              .map(a => ({
                id: a.staffUserId,
                name: a.name,
                status: a.status,
              })),
          })),
      })),
  }));
}

export async function upsertService(
  actor: SessionUser,
  input: z.infer<typeof serviceInput>,
  ip: string
) {
  try {
    const id = await withTransaction(async tx => {
      const values = {
        slug: input.slug,
        name: input.name,
        description: input.description,
        kind: input.kind,
        notice: input.notice || null,
        isActive: input.isActive,
        displayOrder: input.displayOrder,
      };
      let id = input.id;
      if (id) await tx.update(services).set(values).where(eq(services.id, id));
      else id = (await tx.insert(services).values(values).$returningId())[0].id;
      await audit(tx, {
        actorUserId: actor.id,
        action: input.id ? "service.updated" : "service.created",
        entityType: "service",
        entityId: id,
        metadata: values,
        ip,
      });
      return id;
    });
    changed();
    return { id };
  } catch (error) {
    if (isDuplicateKeyError(error, "services_slug_unique"))
      fail("CONFLICT", "Another service already uses this slug.");
    throw error;
  }
}

export async function upsertGroup(
  actor: SessionUser,
  input: z.infer<typeof groupInput>,
  ip: string
) {
  const [service] = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.id, input.serviceId))
    .limit(1);
  if (!service) fail("NOT_FOUND", "Service not found.");
  if (input.id) {
    const [existing] = await db
      .select()
      .from(queueGroups)
      .where(eq(queueGroups.id, input.id))
      .limit(1);
    if (!existing) fail("NOT_FOUND", "Queue group not found.");
    if (existing.serviceId !== input.serviceId)
      fail("VALIDATION", "A queue group can't be moved to another service.");
    if (
      existing.isActive &&
      !input.isActive &&
      (await activeCount(eq(queueEntries.queueGroupId, input.id))) > 0
    ) {
      fail(
        "CONFLICT",
        "This queue still has active tokens. Serve or cancel them before deactivating it."
      );
    }
  }
  try {
    const { id: _id, ...values } = input;
    const id = await withTransaction(async tx => {
      let id = input.id;
      const row = { ...values, description: values.description || null };
      if (id)
        await tx.update(queueGroups).set(row).where(eq(queueGroups.id, id));
      else id = (await tx.insert(queueGroups).values(row).$returningId())[0].id;
      await audit(tx, {
        actorUserId: actor.id,
        action: input.id ? "queue_group.updated" : "queue_group.created",
        entityType: "queue_group",
        entityId: id,
        metadata: row,
        ip,
      });
      return id;
    });
    changed();
    void _id;
    return { id };
  } catch (error) {
    if (isDuplicateKeyError(error, "queue_groups_service_slug_unique"))
      fail("CONFLICT", "This service already has a queue with that slug.");
    throw error;
  }
}

export async function upsertCounter(
  actor: SessionUser,
  input: z.infer<typeof counterInput>,
  ip: string
) {
  const [group] = await db
    .select({ id: queueGroups.id })
    .from(queueGroups)
    .where(eq(queueGroups.id, input.queueGroupId))
    .limit(1);
  if (!group) fail("NOT_FOUND", "Queue group not found.");
  if (input.id) {
    const [existing] = await db
      .select()
      .from(counters)
      .where(eq(counters.id, input.id))
      .limit(1);
    if (!existing) fail("NOT_FOUND", "Counter not found.");
    if (existing.queueGroupId !== input.queueGroupId)
      fail(
        "VALIDATION",
        "A counter can't be moved to another queue group; create a new counter instead."
      );
    const busy = await activeCount(eq(queueEntries.counterId, input.id));
    if (busy > 0 && existing.tokenPrefix !== input.tokenPrefix)
      fail(
        "CONFLICT",
        "The token prefix can't change while this counter has active tokens."
      );
    if (busy > 0 && existing.isActive && !input.isActive)
      fail(
        "CONFLICT",
        "This counter still has active tokens. Merge or serve them before deactivating it."
      );
  }
  try {
    const id = await withTransaction(async tx => {
      const values = {
        queueGroupId: input.queueGroupId,
        name: input.name,
        tokenPrefix: input.tokenPrefix,
        isActive: input.isActive,
        displayOrder: input.displayOrder,
      };
      let id = input.id;
      if (id) await tx.update(counters).set(values).where(eq(counters.id, id));
      else
        id = (
          await tx
            .insert(counters)
            .values({ ...values, status: "OPEN", statusUpdatedAt: new Date() })
            .$returningId()
        )[0].id;
      await audit(tx, {
        actorUserId: actor.id,
        action: input.id ? "counter.updated" : "counter.created",
        entityType: "counter",
        entityId: id,
        metadata: values,
        ip,
      });
      return id;
    });
    changed();
    return { id };
  } catch (error) {
    if (isDuplicateKeyError(error, "counters_token_prefix_unique"))
      fail("CONFLICT", "Another counter already uses this token prefix.");
    throw error;
  }
}

export async function setStaffAssignments(
  actor: SessionUser,
  input: { staffUserId: number; counterIds: number[] },
  ip: string
) {
  const [staff] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.staffUserId))
    .limit(1);
  if (!staff || staff.role !== "STAFF")
    fail(
      "VALIDATION",
      "Assignments are for staff accounts. Administrators can already operate every counter."
    );
  const counterIds = [...new Set(input.counterIds)];
  if (counterIds.length) {
    const found = await db
      .select({ id: counters.id })
      .from(counters)
      .where(inArray(counters.id, counterIds));
    if (found.length !== counterIds.length)
      fail("NOT_FOUND", "One or more counters no longer exist.");
  }
  await withTransaction(async tx => {
    const before = await tx
      .select({ counterId: staffCounterAssignments.counterId })
      .from(staffCounterAssignments)
      .where(eq(staffCounterAssignments.staffUserId, staff.id));
    await tx
      .delete(staffCounterAssignments)
      .where(eq(staffCounterAssignments.staffUserId, staff.id));
    if (counterIds.length) {
      await tx.insert(staffCounterAssignments).values(
        counterIds.map(counterId => ({
          staffUserId: staff.id,
          counterId,
          assignedByUserId: actor.id,
        }))
      );
    }
    await audit(tx, {
      actorUserId: actor.id,
      action: "assignment.changed",
      entityType: "user",
      entityId: staff.id,
      metadata: {
        before: before.map(b => b.counterId).sort((a, b) => a - b),
        after: counterIds.sort((a, b) => a - b),
      },
      ip,
    });
  });
  changed();
  return { ok: true as const };
}

export const stationInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(2).max(120),
  queueGroupId: z.number().int().positive(),
  roi: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0.05).max(1),
      height: z.number().min(0.05).max(1),
    })
    .refine(
      r => r.x + r.width <= 1.0001 && r.y + r.height <= 1.0001,
      "The region must stay inside the frame."
    ),
  confidenceThreshold: z.number().int().min(30).max(95),
  isActive: z.boolean(),
});

export async function upsertStation(
  actor: SessionUser,
  input: z.infer<typeof stationInput>,
  ip: string
) {
  const id = await withTransaction(async tx => {
    const { id: existingId, ...values } = input;
    let id = existingId;
    if (id)
      await tx
        .update(cameraStations)
        .set(values)
        .where(eq(cameraStations.id, id));
    else
      id = (await tx.insert(cameraStations).values(values).$returningId())[0]
        .id;
    await audit(tx, {
      actorUserId: actor.id,
      action: existingId ? "camera_station.updated" : "camera_station.created",
      entityType: "camera_station",
      entityId: id,
      metadata: values,
      ip,
    });
    return id;
  });
  changed();
  return { id };
}
