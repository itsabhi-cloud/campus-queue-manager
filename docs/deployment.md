# Deployment

## What has to run

One long-lived Node.js process serves the web app, the tRPC API and the Server-Sent Events
realtime stream, and runs two timers (estimate refresh every 60 s, session purge hourly). It needs
a MySQL 8.0.16+ database. Realtime fan-out and rate limits are in-process, so deploy **one
instance**.

That rules out serverless/edge function hosting (Vercel/Netlify functions, Lambda): SSE connections
are long-lived and the timers need a persistent process. Suitable targets: any container or VM host
with long-lived HTTP connections and TLS termination, e.g. Railway, Render (web service), Fly.io, a
campus VM with nginx, or Kubernetes with a single replica. Pair it with a managed MySQL 8 database.

## Release steps

```bash
pnpm install --frozen-lockfile
pnpm build                      # dist/public (client) + dist/index.js, dist/migrate.js, dist/create-admin.js
node dist/migrate.js            # once per release, before starting (idempotent)
node dist/create-admin.js --email registrar@college.edu --name "Registrar Office"   # first release only
node dist/index.js              # with NODE_ENV=production and the variables below
```

The bundled `migrate.js` and `create-admin.js` don't need dev dependencies; they read
`drizzle/migrations` from the working directory (override with `MIGRATIONS_DIR`). Run them with the
same production environment as the server: they validate it too, so a local `.env` with
`APP_ORIGIN=http://localhost:…` makes `migrate.js` refuse to run under `NODE_ENV=production`.

### Docker

A multi-stage `Dockerfile` and `.dockerignore` are included. The image runs as the `node` user,
exposes port 3000 and has a `HEALTHCHECK` on `/api/health`. Run migrations as a release command or
one-off job: `docker run --env-file prod.env <image> node dist/migrate.js`.

> Not verified: Docker is not installed on the machine this was built on, so the image has not been
> built. The same commands were verified without Docker (see "Verified locally").

## Production environment

| Variable | Rule |
| --- | --- |
| `NODE_ENV` | `production` (set by `pnpm start`; set it yourself if you run `node dist/index.js`) |
| `APP_ORIGIN` | Your public `https://` origin. The server refuses to start with `http://` or `localhost`. |
| `AUTH_SECRET` | ≥ 32 random characters, stored in the host's secret manager |
| `DATABASE_URL` | Managed MySQL URL; prefer TLS if the provider offers it |
| `TRUST_PROXY` | `1` behind the platform's load balancer |
| `CAMPUS_TIMEZONE` | Campus time zone |

Cookies are `HttpOnly; Secure; SameSite=Lax` in production. There is no CORS configuration because
the browser only ever talks to its own origin.

## Proxy notes (nginx)

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

## Operations

- `GET /api/health` → 200 `{status:"ok", checks:{database, databaseLatencyMs, realtime}}`, 503 when
  the database is unreachable. No secrets are included.
- JSON logs on stdout/stderr with secrets redacted.
- Graceful shutdown on SIGTERM/SIGINT (closes SSE streams, which clients reconnect and resync).

## Verified locally (2026-09-28)

- `pnpm build`, then `node dist/migrate.js` on an empty database: 19 tables, 31 foreign keys,
  11 unique and 6 CHECK constraints, 0 users; a second run is a no-op.
- `NODE_ENV=production`: refuses `APP_ORIGIN=http://localhost:3000` and `http://queue.college.edu`;
  starts with `https://queue.college.edu`; health OK; `Set-Cookie … HttpOnly; Secure; SameSite=Lax`;
  HSTS and CSP headers present; a cross-origin POST returns 403.
- The production build served over `http://localhost:3100` (with `ALLOW_INSECURE_ORIGIN=true`):
  realtime disconnect → "Reconnecting" and "Live updates paused" → resync after restart without a
  page reload.

## Requires external setup

A host, a domain with TLS, a managed MySQL database, and secret storage for `AUTH_SECRET`. No real
deployment has been performed.
