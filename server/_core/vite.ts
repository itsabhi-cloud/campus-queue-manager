import express, { type Express } from "express";
import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { logger } from "./logger";

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    configFile: path.resolve(import.meta.dirname, "../../vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      const template = await fs.promises.readFile(
        path.resolve(import.meta.dirname, "../../client/index.html"),
        "utf-8"
      );
      const page = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath))
    logger.error("Build output missing; run `pnpm build` first.", { distPath });
  app.use(
    express.static(distPath, {
      index: false,
      maxAge: "1h",
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`))
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    })
  );
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
