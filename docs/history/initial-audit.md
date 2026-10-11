# QueueSense — Implementation Audit (Phase 0)

Date: 2026-09-27. Scope: the repository as received (git baseline commit `56c89ec`).

## What the repository contained

| Area | Finding |
| --- | --- |
| Tooling | React 19 + Vite 7 + TypeScript, Express 4, tRPC 11, Drizzle ORM (MySQL), Vitest, Tailwind 4. Generated from a Manus web-app template. |
| Frontend | Five routes (`/`, `/student`, `/staff`, `/camera`, `/admin`). A polished custom CSS design language (`index.css`, ~48 KB, violet/teal palette, DM Sans / Space Grotesk / DM Mono). ~50 shadcn/ui components that were **not themed** (no shadcn CSS tokens) and not used by the product pages. |
| Queue logic | `client/src/lib/demoStore.ts` — the whole queue lived in `localStorage`, synchronised between tabs with `BroadcastChannel`. Token numbers, positions, pause state, stats and wait times were computed in the browser. |
| Backend | `server/routers.ts` exposed 4 **public** procedures: `queue.status`, `queue.join`, `queue.event`, `queue.metric`. `join` computed `max(sequence)+1` without a transaction or lock. `event` let any caller write any event for any entry with any `actorUserId`. |
| Auth | Manus OAuth (`server/_core/sdk.ts`, `oauth.ts`) — depends on an external Manus service and `OWNER_OPEN_ID`; roles `user`/`admin` only; session cookie valid for one year with `SameSite=None`. |
| Database | 7 tables (`users`, `services`, `counters`, `queueEntries`, `queueEvents`, `cameraStations`, `queueMetrics`). No queue groups, staff assignments, notifications, audit log, sessions or profiles. |
| Camera | `CameraStation.tsx`: getUserMedia + COCO-SSD loaded from a CDN `<script>` on **every page**, person-class filter, centre-point ROI filter, 8-frame median smoothing. The count was written into the localStorage demo store; a random-jitter simulation was the default mode. |
| Tests | 3 tests: a logout cookie test, a status/validation test, and demo-store position maths. |
| Docs | README, `TECHNICAL_DESIGN.md`, `CODE_EXPLANATION.md` describing the prototype, a Supabase schema that was never wired up. |

## Classification

**A. Production-quality / worth keeping**
- The visual language and CSS tokens, the landing-page narrative, the shell layout.
- The camera pipeline idea: person-only filter, confidence threshold, ROI centre-point test, median smoothing, privacy messaging.
- Stack choice (tRPC + Drizzle + MySQL + React Query) and the Vite/Express dev integration.
- Queue state vocabulary `WAITING → CALLED → SERVING → COMPLETED` with `SKIPPED`/`CANCELLED` exits.

**B. Prototype/demo-only**
- `demoStore.ts` (browser-authoritative queue), seeded fake entries, hard-coded stats, "Reset demo data", "Good morning, Sam", "Riya Kapoor", fake throughput bars, fake "99.9% realtime health".
- The camera "demo simulation" with random jitter.

**C. Incomplete**
- No staff scope, no priority, no merge, no traffic, no notifications, no profile, no admin CRUD, no import, no audit log, no realtime server.

**D. Insecure**
- All queue procedures public; client-supplied `userId`/`actorUserId` trusted.
- Token generation race (`max+1` outside a transaction).
- `SameSite=None` one-year session cookie; admin decided by an env var OpenID.
- Manus debug collector wrote browser console/network logs to disk in development.

**E. Duplicated**
- Queue maths duplicated between the demo store and dashboards; two unused layouts (`DashboardLayout`, `QueueSenseShell`).

**F. Reusable**
- CSS, `QueueSenseShell` presentational pieces (`StatusBadge`, `MetricCard`, `TokenNumber`, `Callout`), camera detection/ROI code, tRPC/React Query wiring, Vite server integration.

**G. Must be redesigned**
- Authentication (Manus OAuth → local password auth with DB-backed sessions), RBAC, schema, queue engine, realtime, all dashboards' data sources.

## Minimum change set to reach the target architecture

1. Remove Manus-only modules (OAuth SDK, LLM/image/voice/maps proxies, S3 storage proxy, debug collector, unused shadcn scaffold). They are recoverable from the baseline commit.
2. New relational schema (Service → Queue Group → Counter → Queue Entry) with sessions, profiles, assignments, notifications, audit logs, settings, camera metrics; one fresh migration (the old migration held no production data).
3. Local authentication: scrypt password hashes, random session tokens stored as HMAC digests, HTTP-only `SameSite=Lax` cookies, activation codes for admin-provisioned accounts, login throttling and lockout.
4. Central RBAC middleware (`studentProcedure`, `staffProcedure`, `adminProcedure`) plus object-level checks (counter assignment, entry ownership).
5. A server-side queue engine: row-locked transactions per counter, DB-enforced uniqueness, a pure state-transition table, explainable wait estimates, priority, merge strategies.
6. Server-Sent Events realtime channel that pushes *invalidation* events; clients refetch authoritative state (and resync on reconnect).
7. Rebuild the student/staff/admin/camera screens on real APIs, keeping the existing visual language.
8. Tests against a real MySQL test database; documentation that describes the real implementation.

Decisions made from this audit are recorded in `docs/architecture.md`.
