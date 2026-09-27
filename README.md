# QueueSense

**Don't stand in line. Know your turn.**

QueueSense is a realtime queue platform for busy campus services. Students take a digital token,
leave the physical line, watch their live position and an estimated wait, and get notified when
their turn approaches. Staff run counters from a console; administrators configure services,
people and policy.

It covers four campus services — **Administration, Printing, Cafeteria and Elevator/Lift** — with
one configurable queue engine (no per-service code paths).

> Honest scope: wait times are **estimates**, not appointments. Cafeteria support manages the
> *line*, not food orders or payment. Elevator support estimates lift traffic and runs a *virtual
> boarding queue*; it does not control lift hardware. Camera stations count people locally and send
> only a number; they never identify anyone or link people to tokens.

## Features

| Area | What's implemented |
| --- | --- |
| Accounts | Email + password sign-in, scrypt hashes, server-side sessions (HTTP-only, SameSite=Lax cookies), one-time activation/reset codes, lockout and rate limits, account status (pending/active/suspended/disabled) |
| Roles | `STUDENT`, `STAFF`, `ADMIN`, enforced on the server; staff only operate counters an admin assigned to them |
| Catalogue | Service → Queue group → Counter, fully admin-configurable (service time, batch size, queue limit, merge strategy, camera assist, token prefixes) |
| Queue engine | Row-locked transactions, concurrency-safe daily token numbers (e.g. `F001`), DB-enforced "one active token per queue per student", strict state machine |
| Student | Active tokens with live position, people ahead, now serving, countdown, traffic and camera signal; join by counter or "shortest line"; cancel; history; notifications; profile |
| Staff | Call next (or next batch for lifts), start serving, complete, skip no-show, cancel with reason, pause/resume, mark offline, merge queues, adjust traffic/delay, priority with reason |
| Admin | Live analytics, live queues, people management, CSV bulk import with preview and error report, catalogue editor, staff assignments, camera stations, audit log, settings |
| Realtime | Server-Sent Events; clients refetch authoritative state on each event and fully resync after reconnecting |
| Notifications | Joined, almost-next, called, serving, completed, skipped, cancelled, merged, priority, position change, wait increased/decreased, counter paused/offline/resumed — with per-student preferences |
| Computer vision | TensorFlow.js + COCO-SSD in the browser, person-only, ROI filter, median smoothing, aggregate-only reporting, stale detection |

## Architecture at a glance

```
React 19 + Vite ──tRPC (HTTP)──▶ Express + tRPC routers ──▶ Queue engine ──▶ MySQL 8 (Drizzle)
      ▲                                   │                    (transactions,
      └──────── SSE /api/realtime ◀── in-process broker ◀──── post-commit effects)
```

More: [docs/architecture.md](docs/architecture.md) · [docs/database.md](docs/database.md) ·
[docs/queue-engine.md](docs/queue-engine.md) · [docs/realtime.md](docs/realtime.md) ·
[docs/security.md](docs/security.md) · [docs/computer-vision.md](docs/computer-vision.md) ·
[docs/deployment.md](docs/deployment.md) · [docs/STATUS.md](docs/STATUS.md) (what is verified) ·
[docs/AUDIT.md](docs/AUDIT.md) (starting-point audit)

## Technology

TypeScript everywhere · React 19, Vite 7, wouter, TanStack Query, tRPC 11, Radix Dialog, Recharts,
sonner · Express 4 · Drizzle ORM + mysql2 · MySQL 8.0.16+ (CHECK constraints, generated columns) ·
zod 4 · TensorFlow.js + COCO-SSD · Vitest.

## Getting started

Prerequisites: Node.js 20+ (tested on 24), pnpm 10 (`npx pnpm@10.4.1` works), MySQL 8.0.16+.

```bash
pnpm install
cp .env.example .env          # then fill in DATABASE_URL, TEST_DATABASE_URL, AUTH_SECRET
```

Create the databases (names are examples; the test database name **must end in `_test`**):

```sql
CREATE DATABASE queuesense CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE queuesense_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Apply migrations and choose how to populate the database:

```bash
pnpm db:migrate
pnpm db:seed:dev              # development only: demo catalogue, staff and students
# or, for a real deployment:
pnpm admin:create --email registrar@college.edu --name "Registrar Office"
```

`admin:create` prints a one-time code; the admin opens `/activate` to set a password, then adds
services, counters, staff and imports students from the UI.

Run it:

```bash
pnpm dev                      # http://localhost:3000 (API + Vite dev server on one port)
```

### Development accounts (seed only)

`pnpm db:seed:dev` creates local test accounts documented at the top of
[`scripts/seed-dev.ts`](scripts/seed-dev.ts) (an admin, four staff — one per service — and twelve
students, plus two pending students whose activation codes are printed by the seed). The seed
refuses to run with `NODE_ENV=production`; production never depends on demo accounts.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | `mysql://user:pass@host:3306/db` (URL-encode special characters) |
| `AUTH_SECRET` | yes | ≥ 32 random characters; HMAC key for session tokens and activation codes |
| `APP_ORIGIN` | production | Public origin, used for the CSRF origin check |
| `CAMPUS_TIMEZONE` | no (`Asia/Kolkata`) | IANA zone for daily token numbering and hourly analytics |
| `PORT` | no (`3000`) | HTTP port |
| `SESSION_TTL_HOURS` | no (`168`) | Session lifetime |
| `TRUST_PROXY` | behind a proxy | Express `trust proxy` value so client IPs (rate limits) are correct |
| `LOG_LEVEL` | no (`info`) | `debug` · `info` · `warn` · `error` |
| `TEST_DATABASE_URL` | tests | Database wiped and rebuilt by `pnpm test` |

The server validates these at startup and exits with a clear message if they're wrong.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server with Vite HMR |
| `pnpm check` | TypeScript type check (client, server, tests, scripts) |
| `pnpm test` | Unit + integration tests (integration tests need `TEST_DATABASE_URL`) |
| `pnpm build` | Production client bundle + bundled server in `dist/` |
| `pnpm start` | Run the production build |
| `pnpm db:generate` | Generate a migration after changing `drizzle/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm db:seed:dev` / `pnpm db:reset:dev` | Seed (or wipe and reseed) development data |
| `pnpm admin:create` | Create/bootstrap an administrator in any environment |
| `pnpm format` | Prettier |

## Roles

- **Student** — browse services, join (one active token per queue, configurable overall limit),
  cancel own tokens, see history, notifications and profile. Cannot change email, college ID or role.
- **Staff** — operate only assigned counters: call/serve/complete/skip/cancel, pause/resume/offline,
  merge within a queue group, traffic, priority (reason required). Cannot self-register or self-assign.
- **Admin** — everything staff can do on every counter, plus people, catalogue, assignments,
  imports, analytics, audit log and settings. The last active admin can't be removed.

## Queue model (short version)

`WAITING → CALLED → SERVING → COMPLETED`, with `SKIPPED` / `CANCELLED` exits. Tokens are
`<counter prefix><daily sequence>` allocated under a row lock. Order is *priority first, then
join order*. Estimates = `people ahead ÷ batch size × service time × traffic multiplier + remaining
time of the current service + staff delay`. Details and assumptions: [docs/queue-engine.md](docs/queue-engine.md).

## Testing

`pnpm test` runs 87 tests: pure logic (state machine, ordering/merge strategies, estimation,
passwords, tokens, CSV, rate limiting, camera ROI/smoothing) and integration tests against a real
MySQL database (auth, RBAC, object-level authorization, 25 concurrent joins, duplicate-join races,
priority, merges, traffic, notifications, imports, SSE delivery over HTTP, security headers).
