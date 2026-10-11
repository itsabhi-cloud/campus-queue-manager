# QueueSense

**Don't stand in line. Know your turn.**

**Live demo: [queuesense-q46g.onrender.com](https://queuesense-q46g.onrender.com)**. The **Try as Student / Staff / Admin** buttons on
the landing page sign you in to a demo account with sample data, no sign-up needed. The free
instance sleeps when idle, so the first load can take up to a minute.

QueueSense is a realtime queue platform for busy campus services. Students take a digital token,
leave the physical line, watch their live position and an estimated wait, and get notified when
their turn approaches. Staff run counters from a console; administrators configure services,
people and policy.

## What it looks like

The design takes its cues from printed queue tickets and "now serving" boards. A student's token is
the one bold element on the screen: the number, how many people are ahead and an estimated wait,
readable at a glance. Signal yellow is reserved for "it's your turn". Students get a phone-first
layout with a bottom tab bar; staff and admins get a desktop console. Every update arrives live
over Server-Sent Events, without a refresh.

<p align="center">
  <img src="docs/images/demo.gif" width="900" alt="Staff press Call next and adjust traffic; the student's ticket updates live and finally turns yellow when they are called">
</p>

<table>
  <tr>
    <td width="33%"><img src="docs/images/student-home.png" alt="Student home on a phone showing an active cafeteria ticket with nobody ahead"><br><sub>Student home: your active tokens</sub></td>
    <td width="33%"><img src="docs/images/student-ticket.png" alt="Token detail on a phone showing position, people ahead and estimated wait"><br><sub>Token: position, people ahead, estimate and what changed</sub></td>
    <td width="33%"><img src="docs/images/student-called.png" alt="Called ticket in signal yellow telling the student which counter to go to"><br><sub>Called: yellow means go</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/images/staff-console.png" alt="Staff counter console with the waiting list and call, serve and skip controls"><br><sub>Staff counter console</sub></td>
    <td><img src="docs/images/notifications.png" alt="Student notifications explaining a traffic delay and a priority change"><br><sub>Notifications explain every change</sub></td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/images/admin-overview.png" alt="Admin overview with live stats, needs-attention list, system health and charts"><br><sub>Admin overview</sub></td>
    <td><img src="docs/images/camera-station.png" alt="Camera station showing an aggregate head count and traffic level"><br><sub>Camera station: counts people, never identifies them</sub></td>
  </tr>
</table>

<p align="center"><img src="docs/images/landing.png" width="900" alt="QueueSense landing page: Don't stand in line. Know your turn."></p>

How these were captured: [docs/images/README.md](docs/images/README.md).

## For reviewers: where to look

| Area | What to look at |
| --- | --- |
| Stack | React 19 + TypeScript (Vite) · Express + tRPC · MySQL 8 + Drizzle ORM · Server-Sent Events · TensorFlow.js |
| Queue engine | [`server/queue/engine.ts`](server/queue/engine.ts): transactions with row locks, guarded state transitions, priority, merge strategies, wait estimates ([docs](docs/queue-engine.md)) |
| Data integrity | One active token per student per queue enforced by a generated column + unique index ([`drizzle/schema.ts`](drizzle/schema.ts), [docs](docs/database.md)) |
| Security | Server-side sessions (HMAC-stored tokens, HttpOnly cookies), RBAC plus object-level checks, CSRF origin check, production config guards ([docs](docs/security.md)) |
| Realtime | Post-commit, identifier-only SSE events; clients refetch and resync after reconnecting ([docs](docs/realtime.md)) |
| Tests | Unit and integration tests against a real MySQL database, including concurrency races and the full demo flow over HTTP + SSE ([`tests/`](tests)); CI runs them on every push |
| Evidence | [Final verification report](docs/history/verification-report.md): what was verified, how, and what still needs a real environment |

## Problem

Students lose time standing in physical lines at fee counters, print centres, cafeterias and lift
lobbies, often without knowing whether the wait is five minutes or forty. Leaving the line means
losing your place.

## Objectives

- Let students hold a place digitally and leave the physical line.
- Show a live, authoritative position and an explainable wait estimate.
- Tell students when their turn approaches, and when anything changes (calls, delays, merges).
- Give staff a fast console for calling, serving, priority, pauses and merging counters.
- Give administrators central control of services, people, analytics and an audit trail.
- Estimate physical congestion with privacy-preserving computer vision, without identifying anyone.

## Solution

A student takes a digital token on their phone and walks away. The server holds their place,
computes their position and an explainable wait estimate, and pushes every change live: when the
line moves, when traffic slows it down, when a counter fails and its line is merged into another,
and when it is their turn. Staff run each counter from a console; administrators manage services,
people and policy centrally. Optional camera stations measure crowding near a counter without
identifying anyone.

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

## Demo script

A timed 5-minute walkthrough (student, staff and admin side by side, with setup steps) is in
[docs/demo-script.md](docs/demo-script.md). Development logins are listed at the top of
`scripts/seed-dev.ts`; `pnpm demo:smoke` runs the same flow automatically as a pre-flight check.

## Architecture at a glance

```mermaid
flowchart LR
  subgraph browser["Browser"]
    ui["React 19 app<br/>student · staff · admin"]
    cam["Camera station page<br/>TensorFlow.js + COCO-SSD<br/>(runs on the device)"]
  end

  subgraph node["One Node.js process (Express)"]
    trpc["tRPC routers<br/>zod input · role checks · rate limits"]
    engine["Queue engine<br/>row-locked MySQL transactions"]
    effects["Post-commit effects"]
    broker["In-process broker"]
    sse["SSE stream<br/>GET /api/realtime"]
    timers["Timers<br/>estimates every 60 s · session purge hourly<br/>demo reset daily (DEMO_MODE)"]
  end

  db[("MySQL 8<br/>Drizzle ORM")]
  model[("Google model bucket<br/>COCO-SSD weights")]

  ui -- "tRPC over HTTPS<br/>HttpOnly session cookie" --> trpc
  cam -- "head count only<br/>camera.report" --> trpc
  cam -. "downloads weights" .-> model
  trpc --> engine --> db
  engine -- "after commit" --> effects --> broker --> sse
  sse -- "event ids; the browser refetches" --> ui
  timers --> engine
```

The server is the source of truth: browsers send intents over tRPC and are told *that* something
changed over SSE, then refetch. Camera frames never leave the device; only counts are sent.

More: [docs/architecture.md](docs/architecture.md) · [docs/database.md](docs/database.md) ·
[docs/queue-engine.md](docs/queue-engine.md) · [docs/realtime.md](docs/realtime.md) ·
[docs/security.md](docs/security.md) · [docs/computer-vision.md](docs/computer-vision.md) ·
[docs/deployment.md](docs/deployment.md) · [docs/design-system.md](docs/design-system.md) · [docs/testing.md](docs/testing.md) · [docs/project-report.md](docs/project-report.md) (project report) · [docs/demo-script.md](docs/demo-script.md) ·
[docs/history/initial-audit.md](docs/history/initial-audit.md) (starting-point audit)

## Technology

TypeScript everywhere · React 19, Vite 7, wouter, TanStack Query, tRPC 11, Radix Dialog, Recharts,
sonner, plain CSS design tokens (Atkinson Hyperlegible + Barlow Condensed) · Express 4 · Drizzle ORM + mysql2 · MySQL 8.0.16+ (CHECK constraints, generated columns) ·
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
| `APP_ORIGIN` | production | Public `https://` origin (production refuses `http://` or localhost); used for the CSRF origin check |
| `CAMPUS_TIMEZONE` | no (`Asia/Kolkata`) | IANA zone for daily token numbering and hourly analytics |
| `PORT` | no (`3000`) | HTTP port |
| `SESSION_TTL_HOURS` | no (`168`) | Session lifetime |
| `TRUST_PROXY` | behind a proxy | Express `trust proxy` value so client IPs (rate limits) are correct |
| `LOG_LEVEL` | no (`info`) | `debug` · `info` · `warn` · `error` |
| `TEST_DATABASE_URL` | tests | Database wiped and rebuilt by `pnpm test` (name must end in `_test`) |
| `ALLOW_INSECURE_ORIGIN` | no | `true` only to run a production build locally over `http://localhost` |

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
| `pnpm admin:create` | Create/bootstrap an administrator (development, via tsx) |
| `node dist/migrate.js` / `node dist/create-admin.js` | The same two tasks from the production build (no dev dependencies) |
| `pnpm demo:smoke` | Runs the demo flow against a running, freshly seeded dev server (development only) |
| `pnpm verify:model` | Loads the camera model in Node and runs inference once (needs network access to the model host) |
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

`pnpm test` runs 115 tests in 14 files: pure logic (state machine, ordering/merge strategies,
estimation, passwords, tokens, CSV, rate limiting, camera ROI/smoothing and error messages, browser
notification gating) and integration tests against a real MySQL database (auth, password reset,
RBAC, object-level authorization, 25 concurrent joins, duplicate-join races, priority, merges,
traffic, notifications, imports, SSE delivery over HTTP, security headers, and the full demo flow
over HTTP and SSE with separate student, staff and admin sessions).

`pnpm verify:model` loads the COCO-SSD model used by the camera station in Node and runs inference
on synthetic frames (a load-and-run check; it does not measure detection accuracy). Evidence for
every area is in [docs/history/verification-report.md](docs/history/verification-report.md).

## Deployment

One long-lived Node process (API + SSE + static client) and a MySQL 8 database. Use a container/VM
host with long-lived HTTP connections (not serverless functions), one instance, HTTPS in front.
A `Dockerfile` is included. Steps, platform guidance and what was verified locally:
[docs/deployment.md](docs/deployment.md).

## Notifications

- **In-app**: persisted notification center plus live toasts over SSE (implemented and verified).
- **Browser notifications**: optional, via the Notification API when the tab is in the background and
  the user allowed it (implemented; only the "blocked" path has been tested).
- **Email/SMS**: not implemented. Activation and password-reset codes are issued by administrators.

## Limitations

- Wait times are heuristic estimates (see docs/queue-engine.md), not appointments.
- Single API instance: realtime fan-out and rate limits are in memory.
- No email delivery, self-service password reset, or administrator MFA.
- Live webcam detection has not been tested on a physical camera in this environment.
- No dark mode; no native mobile app (the web app is responsive and works on phones).
- Automated accessibility checks pass (axe-core); a full screen-reader session has not been done.

See [docs/testing.md](docs/testing.md) for exactly what was verified.

## Team & contributions

Two-person project. Each line points to commits on `main` (`git log --format='%h %an %s'`).

| Person | Area | Commits |
| --- | --- | --- |
| **Abhi Shiktha** ([@itsabhi-cloud](https://github.com/itsabhi-cloud)) | **Prototype**: the first version of the application | `c59fa47` |
| | **Frontend polish**: 404 page and page transitions, admin overview fixes, brand assets (favicons, manifest, Open Graph image), demo-mode panel on the landing page, layout-shift fix, accessible-name fix, lazily loaded signed-in shell | `1942353` `36c942c` `42c89c2` `50994ca` `095dd68` `ea8d75b` `33de0fc` |
| | **Mobile**: 360 px pass with touch targets | `efd3d77` |
| | **Lighthouse**: audit of five pages on mobile and desktop, recorded in `docs/testing.md` | `0363837` |
| | **Screenshots**: README screenshot grid and demo GIF | `371f223` `9318135` |
| | **Report**: project report in the SRMIST chapter format | `222ff51` |
| | **Demo script**: five-minute demo script | `d857eee` |
| **Puneet Sreevatsal Jagadam** ([@puneetsreevatsalj](https://github.com/puneetsreevatsalj)) | **Rebuild**: v2 full-stack rebuild, including the role-based frontend on real APIs and the design system | `764590d` `1df7d0f` `228783f` `c56b01c` |
| | **Backend**: auth and RBAC, schema, queue engine, realtime SSE, admin APIs, NAT-safe sign-in throttling; later database TLS, response compression and demo mode | `764590d` `a431598` `8ccefd6` `875b969` `9bbccff` |
| | **Quality**: tests, readiness and acceptance passes, ESLint and CI, security review fixes | `d58b2cd` `e1eb1f7` `aefeae3` `b790a69` `5eb6c17` `a267236` `5c52e8c` `110410f` |
| | **Deployment**: Dockerfile, `render.yaml`, Aiven + Render deployment guide | `aefeae3` `7f8f437` `c67710f` |

Commits authored as "QueueSense" and "Puneet SJ" use Puneet's email address.
