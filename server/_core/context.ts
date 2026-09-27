import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { readSessionToken, resolveSession, type SessionUser } from "../auth/sessions";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: SessionUser | null;
  sessionId: string | null;
  /** True when a session cookie was sent but no longer resolves (expired, revoked, account inactive). */
  sessionExpired: boolean;
  ip: string;
};

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<TrpcContext> {
  const token = readSessionToken(req);
  const session = await resolveSession(token);
  return {
    req,
    res,
    user: session?.user ?? null,
    sessionId: session?.sessionId ?? null,
    sessionExpired: Boolean(token) && !session,
    ip: (req.ip ?? "unknown").slice(0, 64),
  };
}
