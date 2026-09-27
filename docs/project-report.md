# QueueSense: project report

Material for an academic submission. Every result below comes from tests or checks recorded in
[final-test-matrix.md](final-test-matrix.md) and [final-readiness-audit.md](final-readiness-audit.md).

## Abstract

QueueSense is a realtime web platform that lets students reserve a place in campus service queues
(administration desks, print centre, cafeteria and lifts) and leave the physical line. The server
issues concurrency-safe tokens, computes each student's position and an explainable wait estimate,
and pushes changes to browsers over Server-Sent Events. Staff operate counters, including priority,
pausing and merging a failed counter's queue into another without losing anyone's place.
Administrators manage services, people and policy with a full audit trail. Optional browser-side
computer vision (TensorFlow.js, COCO-SSD) estimates crowding near a counter while storing only
aggregate counts. The system is implemented in TypeScript (React, Express, tRPC, MySQL) and
verified by 114 automated tests against a real database, an automated accessibility audit, and an
end-to-end demonstration script.

## Problem statement

Campus services concentrate demand at predictable times: fee deadlines, printing before
submissions, lunch, lifts between lectures. Students wait in physical lines with no idea how long
the wait is, and cannot leave without losing their place. Staff have no view of the line beyond what
they can see, and no way to tell waiting students about delays or a counter going down.

## Existing approaches and their gaps

- **Physical lines**: no information, no mobility, unfair when counters change.
- **Paper or kiosk tickets**: free people from standing, but still require watching a display nearby
  and give no estimate.
- **Generic appointment systems**: fixed slots don't fit walk-in services with variable service times.

## Objectives

1. Hold a student's place digitally so they can leave the line.
2. Show an authoritative live position and an explainable, honest wait estimate.
3. Notify students when their turn approaches and when conditions change.
4. Give staff fast, safe operational controls (call, serve, skip, priority, pause, merge).
5. Give administrators central configuration, people management, analytics and auditability.
6. Estimate physical congestion with computer vision without identifying individuals.

## Proposed solution

The backend is the single source of truth. Students request actions; the server validates,
authorises and executes them in database transactions, records events, creates notifications and
then broadcasts identifier-only realtime events so every client refetches the authoritative state.
One configurable queue engine serves four services: behaviour (service time, batch size, merge
strategy, camera assistance) is configuration, not per-service code.

## System architecture

See [architecture.md](architecture.md). In short: React SPA ↔ tRPC over HTTP ↔ Express ↔ queue
engine ↔ MySQL 8 (Drizzle ORM), with an SSE channel (`/api/realtime`) fed by post-commit effects.

## Modules

| Module | Responsibility |
| --- | --- |
| Accounts | Password sign-in, sessions, activation/reset codes, profiles, CSV import |
| RBAC | Role middleware plus object-level checks (staff counter assignments, token ownership) |
| Queue engine | Joining, transitions, priority, traffic, pause/offline, merge, estimates, notifications |
| Realtime | In-process broker and SSE stream; client invalidation, backoff and resync |
| Student app | Services, join flow, token ticket with live position and countdown, history, notifications |
| Staff console | Now-serving board, call/serve/complete/skip/cancel, traffic, priority, merge |
| Admin console | Overview and analytics, people, catalogue, assignments, audit log, settings |
| Camera station | In-browser person detection, ROI, smoothing, aggregate reporting, staleness |

## Database design

18 application tables; see [database.md](database.md). Key invariants are enforced by the database:
one active token per student per queue (a stored generated column plus a unique index), unique token
sequence per counter per day, and CHECK constraints on configuration. A clean migration creates 31
foreign keys, 11 unique constraints and 6 CHECK constraints.

## Technologies

TypeScript, React 19, Vite 7, TanStack Query, tRPC 11, Express 4, Drizzle ORM, MySQL 8, zod,
Server-Sent Events, TensorFlow.js with COCO-SSD, Vitest, axe-core (accessibility audit).

## Security

scrypt password hashing; random session tokens stored as HMAC digests; HTTP-only, SameSite=Lax,
Secure cookies; CSRF origin checks; server-side RBAC with object-level authorisation; input
validation; rate limiting; audit logging; CSP and HSTS in production; production refuses insecure
origins. Details in [security.md](security.md).

## Computer vision

Frames are processed in the browser; only a smoothed people count is sent every 5 seconds. Counts
map to a congestion level that can raise, but never lower, a queue's traffic level, and are never
added to the digital queue (which would double-count token holders standing nearby). Stale data is
ignored. See [computer-vision.md](computer-vision.md).

## Realtime communication

Server-Sent Events carry identifiers only; clients refetch authoritative data, coalesce bursts, and
resynchronise everything after reconnecting. See [realtime.md](realtime.md).

## Testing

- 114 automated tests (unit plus integration against MySQL, including the full demo flow over HTTP and SSE): authentication, a permissions matrix of
  26 privileged operations, state transitions, concurrency (25 simultaneous joins, racing duplicate
  joins, simultaneous staff calls), priority, merge and restore, traffic, notifications and recipient
  isolation, import validation and privilege escalation, SSE delivery, security headers.
- Automated accessibility audit with axe-core (WCAG 2.1 A/AA + best practices) on 21 screens and
  dialogs.
- Manual responsive checks from 360 to 1440 px; manual realtime disconnect/reconnect on the
  production build; a scripted 12-step end-to-end demo (`pnpm demo:smoke`).

## Results

- All 114 automated tests pass; the production build succeeds; type checking is clean.
- Concurrency: 25 simultaneous joins produced tokens C001–C025 with no gaps or duplicates; six
  simultaneous joins by one student produced exactly one token; two simultaneous "call next" clicks
  on one desk called exactly one token.
- Merge: a counter's waiting tokens were woven A1, B1, A2, B2 into the remaining counter with no
  entries lost and provenance kept; reopening the counter left both lines consistent.
- Estimates: heavy traffic plus a 5-minute delay changed a 4-person-line estimate from 360 s to 840 s
  and notified the student with the reason.
- Realtime: after a server outage during which data changed, the open page showed the change after
  reconnecting without a reload.
- Accessibility: 0 axe-core violations across audited screens after fixes.

## Limitations

Estimates are heuristics, not appointments. Single API instance (in-memory realtime and rate
limits). No email delivery, self-service password reset or administrator MFA. Live webcam detection,
browser notifications with permission granted, a screen-reader session and a hosted deployment were
not tested in the development environment.

## Future scope

Email/SMS notifications and self-service password reset; Redis-backed realtime and rate limiting
for multiple instances; SSO with the institution's identity provider; dark mode; historical
forecasting of busy periods; kiosk mode for students without phones; QR check-in at counters.
