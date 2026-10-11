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
one-off job: `docker run --env-file prod.env <image> node dist/migrate.js`. The image's default
command runs migrations and then starts the server, for hosts without a release step.

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

## Step by step: public demo on Aiven (MySQL) + Render (web service)

The live demo at <https://queuesense-q46g.onrender.com> runs this setup.

This gets a shareable HTTPS demo with one-click sign-in, on free plans. Free plans change; check
the current terms on each site. Facts used below (checked 2026-10-11 in Render's docs): a free
Render web service has 512 MB RAM, **no pre-deploy command and no shell**, spins down after 15
minutes without inbound traffic (about a minute to wake), and gets 750 free instance hours a month
per workspace, enough for one service running all month.

You need accounts on GitHub (with access to the repository), [Aiven](https://aiven.io),
[Render](https://render.com) and, for step 6, [UptimeRobot](https://uptimerobot.com).

### 1. Create the database (Aiven)

1. In the Aiven console: **Create service → MySQL → Free plan**. Pick the region closest to the
   Render region you will use (`render.yaml` says `singapore`; change it there before step 3 if
   you pick something else, because Render can't move a service later).
2. Wait until the service is **Running**. On its **Overview** page, copy the **Service URI** and
   download the **CA certificate** (`ca.pem`).
3. Turn the Service URI into `DATABASE_URL`: keep everything up to the database name and **delete
   `?ssl-mode=REQUIRED`**. The MySQL driver ignores that parameter and would connect without TLS,
   so the server refuses to start with it; TLS comes from `DB_SSL` instead.
   ```
   mysql://avnadmin:<password>@<host>.aivencloud.com:<port>/defaultdb
   ```
   URL-encode special characters in the password (`@` → `%40`, `/` → `%2F`).
4. Optional check from your machine (inline variables take precedence over a local `.env`):
   ```bash
   pnpm build
   NODE_ENV=production APP_ORIGIN=https://example.com AUTH_SECRET="$(openssl rand -hex 32)" \
     DATABASE_URL='<url from 3>' DB_SSL=true DB_SSL_CA="$(cat ca.pem)" node dist/migrate.js
   ```
   `Migrations applied.` means TLS (with certificate and hostname verification) and credentials
   work. Render will also run this on every start.

### 2. Generate the secret

```bash
openssl rand -hex 32
```

Keep it in a password manager. Placeholders and the CI secret are refused in production.
Changing it later signs everyone out.

### 3. Create the web service (Render Blueprint)

1. Render dashboard → **New → Blueprint** → connect the GitHub repository and choose the branch
   that contains `render.yaml`.
2. Render reads `render.yaml`: one Docker web service on the free plan, health check
   `/api/health`, start command `node dist/migrate.js && exec node dist/index.js`. It then asks for
   each environment variable:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | from step 1.3 |
   | `DB_SSL` | `true` |
   | `DB_SSL_CA` | the full contents of `ca.pem`, including the `BEGIN`/`END` lines |
   | `AUTH_SECRET` | from step 2 |
   | `APP_ORIGIN` | `https://<service-name>.onrender.com` (no trailing slash; see 3.4) |
   | `TRUST_PROXY` | `1` (see step 5) |
   | `CAMPUS_TIMEZONE` | e.g. `Asia/Kolkata` |
   | `DEMO_MODE` | `true` |

   `NODE_ENV=production` and `PORT` are already handled (the Dockerfile sets `NODE_ENV`; Render
   sets `PORT` and the server listens on it). `DEMO_RESET_HOUR` (default `4`, campus time) and
   `DEMO_PASSWORD` (see step 4) are optional.
3. Apply. The first build takes several minutes. In the service's **Logs**, a good start shows
   `Migrations applied.`, `QueueSense listening` and `Demo data reset`.
4. Compare the URL Render shows at the top of the service with `APP_ORIGIN`. If Render added a
   suffix (e.g. `queuesense-ab12.onrender.com`), update `APP_ORIGIN` under **Environment**; Render
   redeploys. With the wrong origin the site loads, but every sign-in fails with
   "Cross-origin request blocked."

### 4. Demo data

With `DEMO_MODE=true` nothing has to be run by hand:

- **First start:** an empty database is seeded with the demo campus and three demo accounts
  (student, staff on every counter, admin). Their passwords are random and never shown; visitors
  sign in with the landing page's demo buttons (`auth.demoLogin`).
- **Team password (optional):** set `DEMO_PASSWORD` to give all three demo accounts that password
  instead, so the team can also use the normal sign-in form. The landing page keeps the buttons and
  lists the three demo emails with "password: as provided by the team". The value must meet the
  password policy (10–128 characters, at least one letter and one number), or the server refuses to
  start. It takes effect at the next reset (run one on demand, below); it never appears on the page,
  but anyone you give it to can sign in as the demo admin, so share it like any other credential.
- **Daily:** the demo data is wiped and reseeded once per campus day after `DEMO_RESET_HOUR`.
  If the service was asleep at that hour, the reset happens when it next wakes.
- **On demand,** from your machine (Render's free plan has no shell):
  ```bash
  DEMO_MODE=true DATABASE_URL='<url>' DB_SSL=true DB_SSL_CA="$(cat ca.pem)" \
    AUTH_SECRET='<secret>' pnpm db:seed:demo
  ```
  Open browser tabs are signed out by a reset. The script hashes the `DEMO_PASSWORD` from *its own*
  environment, so with a team password add `DEMO_PASSWORD='<password>'` to that command (and keep
  it set on the server, or the next daily reset goes back to random passwords).

The reset refuses to run if the database holds any account that isn't a demo account, so it
can't wipe a real deployment. For a real (non-demo) deployment instead, leave `DEMO_MODE` unset
and create the first administrator from your machine with the same variables:
`node dist/create-admin.js --email you@example.com --name "Your Name"`, then open `/activate`.

### 5. Check it over HTTPS

Replace `$APP` with your `https://…onrender.com` origin.

```bash
curl -s $APP/api/health                     # {"status":"ok",...,"database":"up",...}
curl -sI $APP/ | grep -iE 'strict-transport|content-security|content-encoding'
curl -s $APP/api/trpc/auth.demo             # {"enabled":true,"roles":["STUDENT","STAFF","ADMIN"],"accounts":[]}
```

Then in a browser: open the site, use a demo button, join a queue as the student in one window,
call it as staff in another (a private window gets its own session), and check that the **Live**
badge stays green and the student's screen updates without reloading.

`TRUST_PROXY=1` must make the server see each visitor's real IP, or per-IP sign-in limits would
lump everyone together. To check: note your public IP (`curl -s https://api.ipify.org`), sign in
once, and look at the newest row of `sessions.ip_address` in the database; it should be your IP.

### 6. Keep it awake (UptimeRobot)

A free Render service sleeps after 15 minutes without traffic. In UptimeRobot add an **HTTP(s)**
monitor for `$APP/api/health` at a 5-minute interval. It keeps the service awake (one service
running all month stays within the 750 free hours) and alerts you if health turns `503`
(database down). Each check also runs `select 1` against the database.

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
- Responses over 1 KB (HTML, JS, CSS, JSON) are compressed with brotli or gzip, whichever the
  browser offers. The SSE stream at `/api/realtime` is never compressed or buffered, so a proxy
  in front doesn't need to (and shouldn't) compress it either.
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

A host, a managed MySQL database and secret storage for `AUTH_SECRET` (Render's environment
settings work). A custom domain is optional; Render's `onrender.com` address has TLS.
