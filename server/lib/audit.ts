import { auditLogs } from "../../drizzle/schema";
import type { Executor } from "../db/client";

export type AuditInput = {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/** Records who did what to which entity. Never pass passwords, codes or session tokens in metadata. */
export async function audit(executor: Executor, input: AuditInput) {
  await executor.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId == null ? null : String(input.entityId),
    metadata: input.metadata ?? {},
    ipAddress: input.ip ?? null,
  });
}
