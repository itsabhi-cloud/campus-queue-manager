# Final verification report

Date: 2026-09-28 · Branch `master` · Base commit `ee9865d`. The final commit (see §26) adds this
report and the changes listed in it. Environment: macOS (arm64), Node 24.15.0, MySQL 8.0.45 Community,
in-app Chromium browser pane. Docker is **not installed** on this machine.

Every claim below is labelled:

- **Verified (local)**: a test or check was run in this pass, or in the previous pass with the
  result recorded in [final-readiness-audit.md](final-readiness-audit.md).
- **Pending (external)**: needs hardware, credentials or infrastructure that this machine doesn't have.

"Code exists" is never counted as verification.

## 1. Executive summary

QueueSense is functionally complete for its defined scope: four services, three roles, one
configurable queue engine, realtime updates, notifications, estimates, priority, merge, traffic,
privacy-preserving camera crowding, admin tooling, docs and tests. This is not "100% complete" in an
absolute sense. What remains is verification that needs a real environment:

- live webcam detection
- a native OS notification with permission granted
- a screen-reader session
- building the Docker image
- a hosted deployment with HTTPS and a managed database

**Changes in this pass:**

- **New tests:** 10 more, 101 → 111.
  - Full demo over HTTP and SSE.
  - Password reset and session invalidation.
  - Camera recovery.
  - Camera error mapping.
  - Browser-notification gating.
- **New checks:** a Node model load/inference check (`pnpm verify:model`) and an end-to-end
  production first-admin bootstrap.
- **Accessibility:** two defects the previous audit missed were found by re-running axe and fixed.

## 2. Product scope

| Requirement | Status | Evidence |
| --- | --- | --- |
| Exactly four services: Administration, Printing, Cafeteria, Elevator | Verified (local) | `demo:smoke` step 2 lists exactly these four; demo-flow test uses seeded catalogue |
| No Library service | Verified (local) | Same listing; `grep -rli library server client/src scripts shared drizzle` returns no files |
| No food ordering, no elevator hardware control, no face recognition | Verified (local, by inspection of scope) | Cafeteria/Elevator are queue groups only; camera stores counts only (§13) |
| Year/semester optional | Verified (local) | Profile and import schemas treat them as optional; import tests pass rows without them |

## 3. Architecture verification

- **What:** backend as source of truth; single queue engine; SSE with id-only events and client refetch.
- **How:** the integration tests call the real tRPC routers or real HTTP server against MySQL. The
  demo-flow test observes that SSE events carry ids and that clients refetch authoritative state.
- **Result:** pass. **Evidence:** `tests/integration/demo-flow.test.ts`, `tests/integration/http.test.ts`
  ("pushes queue changes to everyone and notifications only to their owner"). **Status:** Verified (local).

## 4. Authentication verification

| Claim | How | Evidence | Status |
| --- | --- | --- | --- |
| Password sign-in, HttpOnly + SameSite=Lax cookie | Integration | auth.test "signs in with a password and sets an HTTP-only SameSite=Lax session cookie" | Verified |
| `Secure` cookie in production | Booted `dist/index.js` with `NODE_ENV=production`, activated an admin over HTTP, inspected `Set-Cookie` | `qs_session=…; HttpOnly; Secure; SameSite=Lax` (this pass) | Verified |
| Same error for unknown email / wrong password | Integration | "gives the same answer for unknown emails and wrong passwords" | Verified |
| Lockout, IP throttling, shared-IP successes not throttled | Integration | "locks an account…", "throttles an IP…", "does not throttle many successful sign-ins…" | Verified |
| Pending/suspended/disabled refused, sessions ended | Integration | auth + readiness "refuses disabled accounts and ends their sessions" | Verified |
| Session expiry | Integration | readiness "treats an expired session as signed out" | Verified |
| Activation codes: one-time, hashed | Integration + production run | auth "activates an admin-provisioned account…"; production: second use returned `INVALID_CODE` | Verified |
| Password reset (admin-issued code) revokes old sessions; single use; bound to the account | Integration (**new**) | auth "resets a forgotten password…", "rejects a code presented with a different account's email" | Verified |
| Role change / suspension ends sessions | Integration (**new**) | auth "refuses codes for suspended accounts and ends sessions when a role changes" | Verified |
| Password change signs out other devices | Integration | "changes a password and signs out other devices" | Verified |
| Email delivery of reset codes | — | Not implemented by design; admins hand out codes | Post-MVP |

## 5. RBAC verification

- **What:** role middleware, plus object-level checks on counters and groups (staff) and on tokens (students).
- **How:**
  - A permissions matrix over 26 privileged procedures, run as student, staff and anonymous. For each
    rejected call it asserts that nothing changed.
  - Staff-scope tests, including merges in either direction.
  - Over HTTP, desk staff calling the print counter gets 403 FORBIDDEN (demo-flow).
- **Evidence:**
  - readiness "rejects every staff and admin operation for students, and admin operations for staff"
  - readiness "keeps staff to their own counters, including for merges in either direction"
  - queue "stops staff from operating counters they are not assigned to"
  - queue "stops a student from touching another student's token"
  - auth "never lets a role come from the client"
  - readiness "ignores a role column: imported people are always students"
- **Status:** Verified (local).

## 6. Queue engine verification

- **What:** the state machine, ordering, token numbering, per-student limits, and paused/offline/full counters.
- **Evidence:**
  - ordering.test (state machine: "allows the normal service path", "rejects skipping states and leaving terminal states")
  - queue.test "follows WAITING → CALLED → SERVING → COMPLETED and notifies the student"
  - "calls one token at a time for single-capacity counters, batches for lifts"
  - "refuses joins when the counter is paused, offline or full"
  - "enforces the per-student active token limit"
  - "assigns 'any counter' joins to the shortest line"
- **Status:** Verified (local).

## 7. Concurrency verification

| Scenario | Result | Evidence |
| --- | --- | --- |
| 25 simultaneous joins on one counter | Unique, gap-free tokens | queue "gives every concurrent joiner a unique token and a consistent position" |
| One student racing duplicate joins | Exactly one active token (DB unique index on generated column) | queue "lets a student hold only one active token per queue, even when racing" |
| 20 mixed "any counter" joins | No duplicates or lost entries | readiness "spreads simultaneous 'any counter' joins…" |
| Two simultaneous "call next" on one desk | Exactly one succeeds | readiness "lets only one of two simultaneous 'call next' clicks succeed…" |
| Student cancel vs staff call | Consistent final state | readiness "keeps state consistent when a student cancels while staff calls" |

**Status:** Verified (local), on a single MySQL instance. Multi-instance deployment is out of scope (§24).

## 8. Realtime verification

- **Automated:**
  - http.test: SSE refused without a session; queue events go to everyone; notifications only to
    their owner; the stream ends on revocation.
  - demo-flow.test: the whole flow is observed through per-session SSE streams.
- **Manual (previous pass, production build):** the server was stopped and the page showed
  "Reconnecting" and "Live updates paused". A database change was made while it was down. After
  restart, the page showed the change without a reload (full resync on `hello`).
- **Script (this pass):** `pnpm demo:smoke` recorded 19 SSE events and 8 `queue.changed` events for
  the student.
- **Status:**
  - Verified (local).
  - Behind a real reverse proxy: Pending (external). Proxy buffering must be off and idle timeouts
    must be longer than the heartbeat; see [deployment.md](deployment.md).

## 9. Notification verification

- **Recipients and types:**
  - readiness "sends wait-decreased, offline and completed notices only to the affected student"
  - demo-flow asserts that each session's notification types are its own.
- **Preferences:** student.test "respects notification preferences for informational alerts only".
- **"Almost your turn":**
  - operations "sends the one-time 'almost your turn' alert as the line moves"
  - demo-flow asserts it is *not* sent to a student who joins already inside the threshold.
- **Browser (native) notifications:**
  - The gating logic was extracted to `client/src/lib/browserNotify.ts` and unit-tested (4 tests):
    it shows only when permission is granted and the tab is hidden, never throws, and does nothing
    when denied, not yet asked, or unsupported.
  - The denied state in the UI was seen in the browser pane.
  - **A real OS notification with permission granted was not observed.** The pane reports `denied`.
    Pending (external): one real browser with permission allowed.

## 10. Wait-time verification

- **Unit tests** (estimation.test, 13 tests): idle counter, people × service time, in-progress
  remainder floor, traffic multipliers plus delay, lift batches, blending with observed medians,
  clamping, camera mapping, and stability rules.
- **Integration:**
  - operations "recalculates estimates on heavy traffic and explains the change"
  - student "refreshes stale estimates during periodic recalculation"
- **Over HTTP (demo-flow):** AD002 at position 2 has an estimate of 120 s; RB003 at position 3 has
  600 s. After HEAVY traffic the estimate is 1200 s, with the exact message "Estimated wait increased
  from 10 to 20 minutes due to heavier traffic (Lunch rush)."
- **Status:** Verified (local). Estimates are heuristics, not guarantees (§24).

## 11. Priority verification

- **Evidence:**
  - operations "moves a token to the front, records who/why, and tells everyone affected"
  - "keeps positions consistent when several tokens have priority"
  - demo-flow: the result is `{tokenNumber: "RB003", previousPosition: 3, newPosition: 1}`, and the
    others receive PRIORITY_ADJUSTMENT.
  - Script step 8 moved position 3 → 1.
- A reason is required, and this is enforced in both the router and the engine.
- **Status:** Verified (local).

## 12. Merge verification

- **Evidence:**
  - ordering.test (ALTERNATE/APPEND/JOIN_TIME, "never loses or duplicates entries")
  - operations "merges an unavailable counter by alternating, without losing a single entry"
  - operations "re-queues called tokens and refuses to merge while someone is being served"
  - operations "refuses merges across queue groups"
  - readiness "reopens a merged counter without moving tokens back or corrupting either line"
- **demo-flow result:**
  - 3 tokens moved.
  - Final order is RB003, RA001, RB001, RB002, with 4 unique entries and `movedFrom` set to "Counter RB".
  - The audit actor is the print staff member.
  - Reopening B leaves B empty and A with 4.
- **Status:** Verified (local).

## 13. Computer vision verification

| Claim | How | Result | Status |
| --- | --- | --- | --- |
| Server stores aggregates only; camera raises (never lowers) traffic; stale data ignored | Integration | operations "stores aggregates only, raises traffic…, goes stale and recovers" | Verified |
| Stale → fresh recovery after a new report | Integration (**new**) | Fresh again, 7 people → MODERATE, traffic MODERATE | Verified |
| ROI centre test and median smoothing | Unit | detection.test | Verified |
| Every camera failure has an actionable message | Unit (**new**, function extracted from the page) | NotAllowed / NotFound / Overconstrained / NotReadable / insecure context / unknown | Verified |
| Permission-denied UI | Browser pane (blocks capture) | "Camera permission was denied…" | Verified |
| Model weights reachable under production CSP | Production build in browser | `model.json` 200 | Verified |
| Model loads and runs inference | `pnpm verify:model` (**new**) | Loaded in ~3 s on CPU backend; 0 people on blank and noise frames | Verified (load/run only, not accuracy) |
| Live detection of real people with a webcam | — | Not run | **Pending (external): physical camera** |

No face recognition, no identity matching, no frames uploaded: the report payload is
`{stationId, peopleCount, rawDetections}` (see the `report` procedure in `server/routers/staff.ts` and the
aggregate-only assertion in the integration test).

## 14. Admin verification

- **Evidence:**
  - admin.test (7): import preview, atomic import with codes and audit, missing columns, staff
    creation and assignment, suspending a student cancels tokens, duplicate email/ID errors,
    catalogue safety.
  - auth "prevents an admin from removing the last active admin"
  - readiness "rejects missing required fields, malformed emails and oversized files" (>5000 rows)
  - demo-flow: the admin overview metrics equal direct database counts, and the audit contains the
    expected actions.
- **UI:** all seven admin screens were audited with axe in this pass (§17). The overview figures were
  checked against the database: 12 open, 0 paused, 0 offline.
- **Status:** Verified (local).

## 15. Staff verification

- **Evidence:**
  - queue and operations tests (call, serve, complete, skip, cancel with reason, pause/resume, traffic, merge)
  - demo-flow (desk staff sees both tokens; call moves the student to position 1; pause/resume notifications)
  - Staff UI audited with axe as the lift staff member, on both the counter picker and a counter board.
- **Status:** Verified (local).

## 16. Student verification

- **Evidence:**
  - queue tests (join, limits, cancel)
  - student.test (own notifications only, preferences, profile photo validation and immutable
    identity fields, can't cancel while being served, periodic refresh)
  - demo-flow (join, positions, history after completion)
  - The student screens (home, service, token, history, notifications, profile) were audited with axe
    as `student02`, who holds a live token.
- **Status:** Verified (local).

## 17. Accessibility verification

- **How:** axe-core 4.10.3 (tags wcag2a, wcag2aa, wcag21a, wcag21aa, best-practice) was run in the
  browser pane against the dev server, signed in with the seed accounts for each role.
- **Screens audited this pass (19):**
  - Public: `/`, `/login`, `/activate`, 404
  - Student: `/app`, `/app/services/printing`, `/app/tokens/2`, `/app/history`, `/notifications`, `/profile`
  - Staff: `/staff` (counter picker), `/staff/11`, `/camera`
  - Admin: `/admin`, `/admin/queues`, `/admin/users`, `/admin/import`, `/admin/services`,
    `/admin/audit`, `/admin/settings`
- **Found and fixed in this pass** (the previous pass had reported 0, so its coverage was incomplete):

| Issue | Where | Fix |
| --- | --- | --- |
| `heading-order` | `/staff` counter picker (staff with several counters): `h1` → `h3` | Card titles are `h2` (same visual size) |
| `landmark-unique` | `/admin` "Services today" and `/admin/services` "Camera stations": section and table region shared a name | Table regions labelled "… table" |

- **Result after the fixes:** 0 violations on all 19 screens.
- **Previous pass:** dialogs were audited, the keyboard sign-in was tested, and the drawer focus trap
  was checked.
- **Pending:** a full screen-reader session (VoiceOver/NVDA). Automated tools do not replace it.

## 18. Responsive verification

- **Previous pass (manual):** 360, 390, 768, 1280 and 1440 px, including staff and admin at 390 px.
  There was no horizontal page scroll at 360 px.
- **This pass at 1024×768:** `/admin`, `/admin/users`, `/admin/services` and `/staff/1` all had
  `scrollWidth == innerWidth` (1024), so there is no horizontal overflow. Screenshots were reviewed.
- **Status:** Verified (local, Chromium only). Safari/iOS and Firefox were not tested.

## 19. Security verification

| Control | Evidence | Status |
| --- | --- | --- |
| CSRF origin check | http.test "blocks cross-origin writes"; production run: cross-origin POST → **403** | Verified |
| Malformed JSON → 400 (not 500) | http.test; production run → **400** | Verified |
| CSP + HSTS in production | Production run: `Strict-Transport-Security: max-age=15552000; includeSubDomains`, CSP `default-src 'self'…` | Verified |
| Production refuses http/localhost origin | Production run with `APP_ORIGIN=http://localhost:3200` exits with "APP_ORIGIN must be your public domain in production, not localhost."; unit test "requires a public https origin…" | Verified |
| Safe structured errors, no stack leakage | http.test "returns safe, structured errors" | Verified |
| Password hashing, token digests, CSV formula neutralisation, rate limiter | security.test (10) | Verified |
| No other students' identities in queue views | queue "does not expose other students' identities in queue views" | Verified |
| Secrets not committed | `git ls-files .env` empty; `.env` in `.gitignore`; diff reviewed before commit | Verified |
| TLS termination, real proxy headers | — | Pending (external) |

## 20. Database verification

This pass used the scratch database `queuesense_verify`, which was created and then dropped.

- The bundled migrator `node dist/migrate.js` ran twice. Both runs printed "Migrations applied."
  (idempotent).
- The resulting schema has 18 application tables (plus the Drizzle journal), 19 primary keys,
  31 foreign keys, 11 unique constraints and 6 CHECK constraints. There were **0 users**, so no demo
  data leaks into production.

The migrator validates the full production environment. With the local `.env` it refused to run
because `APP_ORIGIN` was localhost. This is expected: production migrations run with the production
environment. This behaviour is documented here and in [deployment.md](deployment.md).

**Status:** Verified (local MySQL 8.0.45). A managed production database is Pending (external).

## 21. Production build verification

- `npm run build` succeeded. It produced the Vite client (`dist/public`), `dist/index.js`,
  `dist/migrate.js` and `dist/create-admin.js`.
- `npx tsc --noEmit` is clean.
- The production server was booted from the bundle with `NODE_ENV=production`:
  - `/api/health` returned 200
  - the startup log reported `origin: https://queue.example.edu`
- **Status:** Verified (local).

## 22. Deployment readiness

**Verified locally:**

- **First-admin bootstrap, end to end on an empty database:**
  1. Ran `node dist/migrate.js`.
  2. Ran `node dist/create-admin.js --email … --name …`. This created the user as `ADMIN PENDING` and
     printed a one-time code.
  3. Booted the server and called `auth.activate` over HTTP. The account became `ACTIVE`, with a
     `Secure` cookie.
  4. Reused the code: rejected with `INVALID_CODE`.
  5. Signed in with the new password: role `ADMIN`.
- Production guards (§19).
- The dev seed refuses to run when `NODE_ENV=production`.

**Configured but not run:**

- The `Dockerfile` (multi-stage, non-root, HEALTHCHECK) and `.dockerignore`. The image has
  **not been built**, because Docker is not installed on this machine.

**Pending (external):**

- a host
- a domain with TLS
- a managed MySQL 8 database
- a reverse proxy configured for SSE

## 23. External environment prerequisites

Exactly what is needed to close the remaining items:

1. **Hosting.**
   - A container or VM host that supports long-lived HTTP connections. Serverless functions will not
     work.
   - Exactly one instance: realtime fan-out and rate limits are in-memory.
2. **Domain + HTTPS.**
   - Set `APP_ORIGIN=https://<your-domain>` (it must match exactly).
   - Terminate TLS at the proxy.
   - Disable response buffering for `/api/realtime`.
   - Set the idle timeout above 30 s (the SSE heartbeat is every 25 s).
3. **MySQL 8.**
   - Create an empty database and a least-privilege user.
   - Set `DATABASE_URL`. URL-encode special characters in the password, for example `@` → `%40`.
4. **Secrets.**
   - `SESSION_SECRET`: at least 32 random bytes, for example `openssl rand -hex 32`.
5. **Release steps.**
   - Run `pnpm build`.
   - Run `node dist/migrate.js` with the production environment.
   - Run `node dist/create-admin.js --email <admin> --name "<name>"`, then activate at `/activate`.
   - Start with `node dist/index.js`.
6. **Docker (optional).**
   - Build with `docker build -t queuesense .`.
   - Migrate with `docker run --env-file prod.env queuesense node dist/migrate.js`.
7. **Physical checks after deployment.**
   - One webcam on the camera station page: HTTPS, permission allowed, people in the ROI.
   - One browser with notification permission allowed and the tab in the background.
   - One screen-reader pass.

No email, SMS, OAuth or third-party API credentials are required. The only outbound dependency is the
browser fetching the COCO-SSD weights from Google's model storage. The production CSP allows this.

## 24. Known limitations

- Estimates are heuristics based on configured and observed service times. They are not appointments.
- Only a single instance is supported. Scaling out would need Redis (or similar) for realtime and
  rate limits.
- Reset codes are handed out by an admin. There is no email delivery or self-service reset, and
  there is no administrator MFA.
- Camera accuracy depends on angle, lighting and occlusion. It is advisory only and can raise but
  never lower traffic.
- No dark mode (decision recorded in [final-readiness-audit.md](final-readiness-audit.md)).
- Browsers tested: Chromium only.

## 25. Final test counts

`npx vitest run`: **13 files, 111 tests, 111 passed, 0 failed, 0 skipped**, against MySQL database
`queuesense_test`.

| File | Tests |
| --- | --- |
| tests/integration/auth.test.ts | 17 (3 new) |
| tests/integration/queue.test.ts | 13 |
| tests/integration/readiness.test.ts | 12 |
| tests/integration/operations.test.ts | 9 (camera test extended with recovery) |
| tests/integration/admin.test.ts | 7 |
| tests/integration/http.test.ts | 7 |
| tests/integration/student.test.ts | 5 |
| tests/integration/demo-flow.test.ts | 1 (new; full flow over HTTP + SSE) |
| tests/unit/estimation.test.ts | 13 |
| tests/unit/security.test.ts | 10 |
| tests/unit/ordering.test.ts | 9 |
| client/src/lib/detection.test.ts | 4 (2 new) |
| client/src/lib/browserNotify.test.ts | 4 (new) |

Other checks run in this pass:

- `pnpm demo:smoke`: all 12 steps passed.
- `pnpm verify:model`: pass.
- axe: 19 screens with 0 violations after the fixes.

## 26. Final git commit

The changes above are committed as one commit on `master`, on top of `ee9865d`. Its hash is reported
by `git log -1 --oneline`. A commit cannot contain its own hash, so it isn't written here.

## 27. Exact commands used for verification

```bash
npx tsc --noEmit
npx vitest run                                   # needs TEST_DATABASE_URL → a *_test database
npm run build
npm run db:reset:dev && npm run demo:smoke       # dev server running on :3000; reseed again afterwards
npm run verify:model                             # network access to the model host

# clean-database + production checks (scratch DB, dropped afterwards)
mysql -e "CREATE DATABASE queuesense_verify"
export DATABASE_URL=mysql://USER:PASS@127.0.0.1:3306/queuesense_verify NODE_ENV=production \
       APP_ORIGIN=https://queue.example.edu SESSION_SECRET=$(openssl rand -hex 32) PORT=3200
node dist/migrate.js && node dist/migrate.js
mysql -e "SELECT constraint_type, COUNT(*) FROM information_schema.table_constraints
          WHERE table_schema='queuesense_verify' GROUP BY constraint_type"
node dist/create-admin.js --email ops@example.edu --name "Ops Admin"
node dist/index.js &
curl -s -o /dev/null -w "%{http_code}\n" localhost:3200/api/health                     # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' \
  -H 'origin: https://queue.example.edu' --data '{bad' localhost:3200/api/trpc/auth.login  # 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'content-type: application/json' \
  -H 'origin: https://evil.example' --data '{}' localhost:3200/api/trpc/auth.login         # 403
curl -sI localhost:3200/ | grep -iE "strict-transport|content-security"
APP_ORIGIN=http://localhost:3200 node dist/index.js                                      # refuses to start
mysql -e "DROP DATABASE queuesense_verify"
```

The accessibility audit was run in the browser on each route:
`(0,eval)(axeSource); await axe.run(document, {runOnly: ["wcag2a","wcag2aa","wcag21a","wcag21aa","best-practice"]})`,
with `axeSource` loaded from `node_modules/axe-core/axe.min.js` through the Vite dev server.

## Final status matrix

| Area | Status | Evidence | External dependency |
| --- | --- | --- | --- |
| Authentication (incl. reset, revocation) | VERIFIED | auth.test (17), readiness account states, production cookie | None |
| RBAC + object-level authorisation | VERIFIED | permissions matrix (26 procedures), scope tests, HTTP 403 in demo-flow | None |
| Queue engine | VERIFIED | queue.test, ordering.test | None |
| Concurrency | VERIFIED | 25 concurrent joins, racing duplicates, simultaneous calls, cancel-vs-call | Multi-instance out of scope |
| Realtime | VERIFIED | SSE tests, demo-flow, manual outage/resync on production build | Proxy configuration in production |
| Notifications (in-app) | VERIFIED | recipient/type/preference tests, demo-flow | None |
| Native browser notifications | CODE VERIFIED / REAL PERMISSION PENDING | browserNotify.test (4), denied state in browser | A browser with permission granted |
| Wait estimates + traffic | VERIFIED | estimation.test (13), operations, exact message in demo-flow | None |
| Priority | VERIFIED | operations, demo-flow (3 → 1) | None |
| Merge + restore | VERIFIED | ordering, operations, readiness, demo-flow | None |
| Computer vision | CODE VERIFIED / PHYSICAL TEST PENDING | camera integration (stale + recovery), detection.test, `verify:model` | Physical webcam over HTTPS |
| Admin | VERIFIED | admin.test, demo-flow metrics = DB counts, axe on 7 screens | None |
| Staff | VERIFIED | queue/operations tests, demo-flow, axe | None |
| Student | VERIFIED | queue/student tests, demo-flow, axe | None |
| Accessibility (automated) | VERIFIED | axe: 19 screens, 0 violations after 2 fixes | Screen-reader session |
| Responsive UI | VERIFIED (Chromium) | 360–1440 px incl. 1024 this pass | Safari/Firefox not tested |
| Security | VERIFIED | http/security tests, production header and origin checks | TLS at host |
| Database | VERIFIED | clean migration ×2 on empty DB, constraint counts, 0 users | Managed MySQL |
| Production build | VERIFIED | `npm run build`, boot from bundle, health 200 | None |
| Admin bootstrap | VERIFIED | migrate → create-admin → activate → sign in on empty DB | None |
| Docker image | NOT RUN | Dockerfile present | Docker on a build machine |
| Deployment | PENDING EXTERNAL | checklist §23 | Hosting + MySQL + HTTPS domain |
