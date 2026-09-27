# Deployment

## Requirements

- Node.js 20+ and MySQL 8.0.16+.
- **HTTPS** in production: secure cookies and browser camera access both require it
  (`localhost` is exempt for testing).
- A reverse proxy/load balancer that allows long-lived responses for `/api/realtime` (SSE) and
  doesn't buffer them.

## Steps

```bash
pnpm install --frozen-lockfile
pnpm build                          # dist/public (client) + dist/index.js (server)
DATABASE_URL=… pnpm db:migrate      # run on every release before starting the new version
pnpm admin:create --email … --name "…"   # first deployment only
NODE_ENV=production APP_ORIGIN=https://queue.example.edu AUTH_SECRET=… DATABASE_URL=… \
  TRUST_PROXY=1 node dist/index.js
```

Run it under a process manager (systemd, pm2, a container platform) with restart-on-failure.

## Operations

- `GET /api/health` → `200 {"status":"ok", checks: {database, databaseLatencyMs, realtime}}`, or
  `503` when the database is unreachable. Use it for liveness/readiness probes.
- Logs are JSON lines on stdout/stderr (secrets redacted); ship them to your log store.
- Graceful shutdown on SIGTERM/SIGINT: stops timers, closes SSE streams (clients reconnect and
  resync), finishes in-flight requests, closes the DB pool; forced exit after 10 s.
- The server refuses to start if configuration is invalid or the database is unreachable.
- Single instance is the supported topology. See [realtime.md](realtime.md) for what changes with
  more instances.

## Proxy notes (nginx example)

```nginx
location /api/realtime {
  proxy_pass http://queuesense;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_read_timeout 1h;
}
location / {
  proxy_pass http://queuesense;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## What has and hasn't been verified

See [STATUS.md](STATUS.md). In short: the production build was built and run locally with
`NODE_ENV=production` (headers, CSP, static serving, health, SSE reconnect verified); no real
HTTPS/proxy/cloud deployment was performed.
