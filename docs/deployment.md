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
| `DATABASE_URL` | Managed MySQL URL |
| `DB_SSL` | `true` to connect over TLS (required by managed providers such as Aiven) |
| `DB_SSL_CA` | PEM text of the provider's CA certificate, if it isn't signed by a public CA (Aiven: yes) |
| `TRUST_PROXY` | `1` behind the platform's load balancer |
| `CAMPUS_TIMEZONE` | Campus time zone |

### Database TLS

With `DB_SSL=true` the pool connects over TLS and refuses the connection unless the server
certificate chains to a trusted CA **and** was issued for the host in `DATABASE_URL`. The trusted
CA is `DB_SSL_CA` when set, otherwise Node's built-in public CAs. `DB_SSL_CA` takes the certificate
text itself (not a file path); paste it multi-line, or on one line with `\n` between lines. Setting
`DB_SSL_CA` without `DB_SSL=true`, or a value that isn't PEM, stops the server at startup. The
migration and admin scripts use the same pool, so they need the same two variables.

Cookies are `HttpOnly; Secure; SameSite=Lax` in production. There is no CORS configuration because
the browser only ever talks to its own origin.

## Step by step: a public demo instance

This is one way to get a shareable HTTPS link for a portfolio or assignment. **It has not yet been
carried out**; record the result here once it has. Any host works as long as it runs one
long-lived Node process (SSE needs long-lived connections, so serverless functions won't work) and
provides MySQL 8 (the version this project is tested on). Check each platform's current pricing and
free-tier limits yourself, because they change.

1. **Push the repository to GitHub.** CI (`.github/workflows/ci.yml`) type-checks, runs the full
   test suite against MySQL 8 and builds on every push.
2. **Create the database.** Use a managed MySQL 8 database on the same platform, or a separate
   MySQL 8 provider. Copy its connection URL, and URL-encode special characters in the password
   (`@` → `%40`).
3. **Create the web service from the repository.** Build with the included `Dockerfile`, or use
   `pnpm install --frozen-lockfile && pnpm build` with start command `node dist/index.js`.
4. **Set the environment variables** (see the table above):
   - `DATABASE_URL`: the URL from step 2
   - `AUTH_SECRET`: generate with `openssl rand -hex 32`; placeholders are refused
   - `APP_ORIGIN`: the exact `https://…` address the platform gives the service; localhost and
     http are refused
   - `TRUST_PROXY=1`
   - `NODE_ENV=production` (the Dockerfile already sets it)
5. **Run migrations once per release:** `node dist/migrate.js`, as the platform's pre-deploy or
   release command, or as a one-off shell command.
6. **Create the first administrator:** `node dist/create-admin.js --email you@example.com --name
   "Your Name"`. Open `/activate` on the live site and set a password with the printed code.
7. **Choose how demo data gets in.** Either:
   - **Clean instance:** configure services, counters and staff from the admin pages, then add or
     import students.
   - **Demo data, deliberately:** from your own machine, run the development seed against the
     hosted database with your own passwords:
     ```bash
     DATABASE_URL='<hosted url>' SEED_ADMIN_PASSWORD='<private>' \
       SEED_STAFF_PASSWORD='<shareable>' SEED_STUDENT_PASSWORD='<shareable>' pnpm db:seed:dev
     ```
     The seed refuses `NODE_ENV=production` and refuses a database that already has users, unless
     you add `--reset`, which **deletes everything**. Never share the admin password. Share only the
     student and staff demo logins, and reseed periodically if visitors leave a mess.
8. **Check the live site:** `/api/health` returns `"status":"ok"`, sign-in works, and the
   **Live** badge stays green while staff call a token. If live updates stall, the platform's proxy
   is buffering `/api/realtime`; see the notes below.

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
