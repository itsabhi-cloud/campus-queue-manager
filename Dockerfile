# QueueSense production image: one Node process serves the API, SSE realtime and the built client.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle/migrations ./drizzle/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health >/dev/null || exit 1
# Runs migrations (idempotent) before the server on every start, for hosts without a release step
# such as Render's free plan; `exec` lets the server receive SIGTERM directly.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
