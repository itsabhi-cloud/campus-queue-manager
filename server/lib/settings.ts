
import { z } from "zod";
import { systemSettings } from "../../drizzle/schema";
import { db, type Executor } from "../db/client";

export const settingsSchema = z.object({
  /** Maximum simultaneously active tokens a student may hold across all queues. */
  maxActiveTokensPerStudent: z.number().int().min(1).max(10),
  /** Camera reports older than this are treated as stale and ignored by estimates. */
  cameraStaleSeconds: z.number().int().min(15).max(900),
  /** Optional list of institutional email domains accepted for new accounts (empty = any). */
  allowedEmailDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain")).max(20),
  /** Days an activation code stays valid. */
  activationCodeDays: z.number().int().min(1).max(60),
});
export type SystemSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: SystemSettings = {
  maxActiveTokensPerStudent: 3,
  cameraStaleSeconds: 60,
  allowedEmailDomains: [],
  activationCodeDays: 14,
};

let cache: { value: SystemSettings; at: number } | null = null;
const CACHE_MS = 10_000;

export async function getSettings(executor: Executor = db): Promise<SystemSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS && executor === db) return cache.value;
  const rows = await executor.select().from(systemSettings);
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  rows.forEach(row => {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  });
  const parsed = settingsSchema.safeParse(merged);
  const value = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  if (executor === db) cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(executor: Executor, next: SystemSettings, actorUserId: number) {
  for (const [key, value] of Object.entries(next)) {
    await executor
      .insert(systemSettings)
      .values({ key, value, updatedByUserId: actorUserId })
      .onDuplicateKeyUpdate({ set: { value, updatedByUserId: actorUserId, updatedAt: new Date() } });
  }
  cache = null;
}

export function invalidateSettingsCache() {
  cache = null;
}

export function emailDomainAllowed(email: string, settings: SystemSettings) {
  if (settings.allowedEmailDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return settings.allowedEmailDomains.some(allowed => domain === allowed.toLowerCase());
}

