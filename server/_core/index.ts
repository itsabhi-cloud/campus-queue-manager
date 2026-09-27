import { createServer } from "node:http";
import { ENV } from "./env";
import { errorHandler, createApp } from "./app";
import { logger } from "./logger";
import { purgeExpiredSessions } from "../auth/sessions";
import { closeDatabase, pingDatabase } from "../db/client";
import { recalculateGroups } from "../queue/engine";
import { closeAllStreams } from "../realtime/sse";
import { serveStatic, setupVite } from "./vite";

async function start() {
  const database = await pingDatabase();
  if (!database.ok) {
    logger.error(
      "Cannot reach the database. Check DATABASE_URL and run `pnpm db:migrate`."
    );
    process.exit(1);
  }

  const app = createApp();
  const server = createServer(app);
  if (ENV.NODE_ENV === "development") await setupVite(app, server);
  else serveStatic(app);
  app.use(errorHandler);

  // Keep estimates honest when service runs long, and clear out expired sessions.
  const recalcTimer = setInterval(() => {
    recalculateGroups(null).catch(error =>
      logger.warn("Periodic recalculation failed", { error })
    );
  }, 60_000);
  const purgeTimer = setInterval(() => {
    purgeExpiredSessions().catch(error =>
      logger.warn("Session purge failed", { error })
    );
  }, 3_600_000);

  server.listen(ENV.PORT, () => {
    logger.info("QueueSense listening", {
      url: `http://localhost:${ENV.PORT}/`,
      env: ENV.NODE_ENV,
    });
  });
  server.on("error", error => {
    logger.error("HTTP server error", { error });
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down", { signal });
    clearInterval(recalcTimer);
    clearInterval(purgeTimer);
    closeAllStreams();
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await closeDatabase().catch(() => undefined);
      logger.info("Shutdown complete");
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch(error => {
  logger.error("Failed to start", { error });
  process.exit(1);
});
