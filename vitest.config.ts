import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  test: {
    environment: "node",
    env: { NODE_ENV: "test" },
    include: [
      "server/**/*.test.ts",
      "client/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    globalSetup: ["tests/globalSetup.ts"],
    // Integration tests share one MySQL test database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
