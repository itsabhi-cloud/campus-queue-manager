import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import compression from "compression";
import { createContext } from "./context";
import { ENV, isProduction } from "./env";
import { logger } from "./logger";
import { pingDatabase } from "../db/client";
import { broker } from "../realtime/broker";
import { realtimeHandler } from "../realtime/sse";
import { appRouter } from "../routers";

const startedAt = Date.now();

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  // The camera is only used by the camera station page on this origin.
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()"
  );
  if (isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=15552000; includeSubDomains"
    );
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        // COCO-SSD downloads its model weights from Google's public model bucket.
        "connect-src 'self' https://storage.googleapis.com https://tfhub.dev https://www.kaggle.com",
        "worker-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ")
    );
  }
  next();
}

/**
 * CSRF defence in depth (sessions are also SameSite=Lax): state-changing API requests must come from
 * our own origin. Browsers always send Origin on cross-site POSTs.
 */
function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS")
    return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser clients (curl, tests) cannot carry a victim's cookie cross-site
  const allowed = new Set<string>();
  if (ENV.APP_ORIGIN) allowed.add(new URL(ENV.APP_ORIGIN).origin);
  if (!isProduction && req.headers.host) {
    allowed.add(`http://${req.headers.host}`);
    allowed.add(`https://${req.headers.host}`);
  }
  if (allowed.has(origin)) return next();
  logger.warn("Blocked cross-origin write", { origin, path: req.path });
  res.status(403).json({ error: "Cross-origin request blocked." });
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  if (ENV.TRUST_PROXY)
    app.set(
      "trust proxy",
      Number.isNaN(Number(ENV.TRUST_PROXY))
        ? ENV.TRUST_PROXY
        : Number(ENV.TRUST_PROXY)
    );
  app.use(securityHeaders);
  // gzip/brotli for HTML, JS, CSS and JSON. Never the SSE stream: a compressor buffers output until
  // it has enough to emit, which would hold realtime events back.
  app.use(
    compression({
      filter: (req, res) =>
        req.path !== "/api/realtime" &&
        !String(res.getHeader("Content-Type") ?? "").startsWith(
          "text/event-stream"
        ) &&
        compression.filter(req, res),
    })
  );

  app.get("/api/health", async (_req, res) => {
    const database = await pingDatabase();
    res.status(database.ok ? 200 : 503).json({
      status: database.ok ? "ok" : "degraded",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks: {
        database: database.ok ? "up" : "down",
        databaseLatencyMs: database.latencyMs,
        realtime: { transport: "sse", connections: broker.connectionCount },
      },
    });
  });

  app.get("/api/realtime", (req, res, next) => {
    realtimeHandler(req, res).catch(next);
  });

  app.use("/api", sameOriginWrites);
  app.use("/api/trpc", express.json({ limit: "3mb" }));
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        if (error.code === "INTERNAL_SERVER_ERROR")
          logger.error("tRPC internal error", {
            path,
            error: error.cause ?? error,
          });
      },
    })
  );
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const type = (error as { type?: string }).type;
  // Client mistakes (bad JSON, oversized bodies) are 4xx and are not logged as server errors.
  if (type === "entity.parse.failed") {
    if (!res.headersSent)
      res.status(400).json({ error: "Malformed request body." });
    return;
  }
  if (type === "entity.too.large") {
    if (!res.headersSent) res.status(413).json({ error: "Request too large." });
    return;
  }
  logger.error("Unhandled HTTP error", { error });
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong." });
}
