import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

describe("queue API", () => {
  it("reports the typed backend and persistence contract", async () => {
    const result = await appRouter.createCaller(createContext()).queue.status();
    expect(result.api).toBe("tRPC over /api/trpc");
    expect(["database", "demo-fallback"]).toContain(result.mode);
    expect(result.storage.length).toBeGreaterThan(0);
  });

  it("rejects invalid queue metric input before touching persistence", async () => {
    await expect(
      appRouter.createCaller(createContext()).queue.metric({
        cameraStationId: 0,
        peopleCount: -1,
        estimatedWaitMinutes: -1,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
