# Architecture

## Principle: the backend is the source of truth

The browser never decides queue state. It sends *intentions* ("join this queue", "call next at
counter 7") and renders whatever the server returns. Every state change is authenticated,
authorised, validated, executed in a database transaction, recorded as an event (and in the audit
log when it's an administrative action), and only then announced to clients.

```
┌────────────── Browser (React SPA) ──────────────┐        ┌──────────────── Node.js ────────────────┐
│ pages/ (student, staff, admin, camera)          │  tRPC  │ Express                                  │
│ TanStack Query cache  ◀── invalidate ──┐        │ ─────▶ │  ├ security headers, CSRF origin check   │
│ RealtimeProvider (EventSource)  ◀──────┼── SSE ─┼─────── │  ├ /api/trpc  → routers (RBAC middleware) │
│ lib/clock (server-synced countdowns)   │        │        │  │     └ queue engine / accounts / admin  │
└────────────────────────────────────────┘        │        │  ├ /api/realtime → SSE ← broker          │
                                                            │  └ /api/health                           │
                                                            └───────────────┬──────────────────────────┘
                                                                            │ Drizzle (mysql2 pool, UTC)
                                                                        MySQL 8
```

## Repository layout

```
client/src/
  App.tsx                 routes + role guards (UX only; the server re-checks everything)
  realtime/               SSE provider: connection state, backoff, invalidation, resync
  lib/                    tRPC client, server-synced clock, formatting, errors, camera helpers
  components/             AppShell, UI primitives, dialogs, token/service cards
  pages/                  Landing, auth, student/, staff/ (console + camera), admin/
server/
  _core/                  env validation, logger, Express app, tRPC init + RBAC, errors, rate limits
  auth/                   password hashing, tokens, sessions
  db/                     connection pool, transactions with deadlock retry, migrations, reset (dev)
  queue/                  engine (all mutations), views (read models), estimation, ordering,
                          state machine, access control, notifications, message copy
  realtime/               broker (pub/sub) and SSE handler
  routers/                tRPC routers: auth, student (catalog/queue/notifications/profile), staff, admin
  accounts.ts             sign-in, activation, profiles, user admin, CSV import
  catalogAdmin.ts         services / queue groups / counters / assignments / camera stations
  camera.ts, analytics.ts
shared/                   domain enums, realtime event types, error codes (used by both sides)
drizzle/                  schema.ts and SQL migrations
scripts/                  migrate, seed-dev (development only), create-admin
tests/                    unit/ and integration/ (real MySQL), globalSetup rebuilds the test DB
```

## Request lifecycle (example: staff calls the next token)

1. `staff.callNext({ counterId })` → `staffProcedure` requires role STAFF or ADMIN.
2. `assertCounterAccess` checks the staff member is assigned to that counter (object-level authz).
3. The engine opens a transaction, `SELECT … FOR UPDATE` on the counter row, checks the counter is
   open and not already at capacity, picks the next waiting token(s) in priority/order.
4. Guarded update `WHERE id = ? AND status = 'WAITING'` (fails on concurrent change), a
   `queue_events` row, a `TOKEN_CALLED` notification, and recalculation of everyone's estimate.
5. Commit. Only now are collected effects published: `queue.changed` (ids only) to everyone,
   `notification.created` + `entry.changed` to the affected student.
6. Clients invalidate the relevant queries and refetch authoritative data.

## Key decisions

| Decision | Why |
| --- | --- |
| Local password auth instead of the template's Manus OAuth | The original auth depended on an external proprietary service. Students are provisioned by admins (bulk CSV) and activate with one-time codes, which works without an email provider. |
| SSE instead of WebSockets | One-way server→client is all that's needed (writes go through tRPC). SSE works over plain HTTP, through most proxies, reuses the session cookie, and reconnects automatically. |
| Invalidation events, not state diffs | Events carry only ids, so no personal data is broadcast and clients can't drift: they always refetch the truth. |
| Row lock per counter | Serialises every change to one line (joins, calls, priority, merges) with minimal contention across counters. |
| Stored estimate + timestamp | Every client derives the same countdown from `(estimatedWaitSeconds, estimateUpdatedAt)` and the server clock offset. |
| DB-enforced invariants | Unique indexes (one active token per student per queue group via a generated column; token sequence per counter per day), foreign keys and CHECK constraints back up application logic. |
| Service `kind` is cosmetic | Icons and wording only. Behaviour (batch size, service time, merge strategy, camera assist) is queue-group configuration, so the same engine runs desks, print counters, cafeterias and lifts. |

## Scaling notes

- The realtime broker and rate limiters are in-process. Running more than one API instance
  requires a shared pub/sub (e.g. Redis) behind `server/realtime/broker.ts` and a shared rate-limit
  store. With a single instance (typical for one campus) nothing else is needed.
- The periodic estimate refresh (every 60 s) touches only counters with waiting tokens.
- Read models compute positions per counter in memory from the active entries of that counter,
  which is small (bounded by the queue limit).
