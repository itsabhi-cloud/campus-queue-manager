# Final test matrix

Status key: **Pass** (tested and correct) · **Partial** (part tested, rest noted) · **Not tested** ·
**External** (needs setup outside this repo). "Auto" means covered by `pnpm test` (114 tests against
MySQL); "Manual" means checked in the browser or with HTTP requests on 2026-09-28.

| Feature | Expected result | Actual result | Status | Notes |
| --- | --- | --- | --- | --- |
| **Authentication** | | | | |
| Sign in | Valid credentials create a session; HTTP-only cookie | Session row stored as HMAC digest; cookie `HttpOnly; SameSite=Lax` (+`Secure` in production) | Pass | Auto + manual (production headers inspected) |
| Invalid credentials | Same message for unknown email and wrong password | Identical "Incorrect email or password." | Pass | Auto |
| Lockout and throttling | 5 failures lock the account; 50 failures per IP block; successes not counted | As expected; 60 successful sign-ins from one IP pass | Pass | Auto |
| Pending / suspended / disabled | Cannot sign in; existing sessions end | Refused; sessions deleted; SSE receives `session.revoked` | Pass | Auto |
| Session expiry | Expired cookie is treated as signed out | `me` → null; API → `SESSION_EXPIRED`; login page shows "session expired" note | Pass | Auto + manual |
| Logout | Server-side session deleted | Old cookie no longer resolves; "You're signed out" notice | Pass | Auto + manual |
| Activation and reset codes | One-time, hashed, expiring | Single use enforced; code not stored in plain text or audit metadata | Pass | Auto |
| Role cannot be changed by the client | Extra fields ignored | `role`, `email`, `collegeId` in profile update ignored | Pass | Auto |
| **RBAC** | | | | |
| Student vs staff/admin APIs | FORBIDDEN on all 26 privileged procedures | All rejected; no state changed | Pass | Auto (matrix) |
| Staff vs admin APIs | FORBIDDEN on all 15 admin procedures | All rejected | Pass | Auto |
| Anonymous | UNAUTHENTICATED everywhere | As expected | Pass | Auto |
| Staff object scope | Only assigned counters (board, call, priority, status, traffic, merge either side, camera) | FORBIDDEN outside scope | Pass | Auto + manual API |
| Student object scope | Other students' tokens return NOT_FOUND | As expected; no existence leak | Pass | Auto |
| **Student queue** | | | | |
| Join | Token issued; server position and estimate | e.g. `RB003`, position 3, 840 s | Pass | Auto + demo script |
| Duplicate join | One active token per queue group, even when racing | 6 parallel joins → 1 token | Pass | Auto (DB unique index) |
| Concurrent joins | Unique, gap-free tokens | 25 parallel → C001–C025; 20 mixed "any counter" → no duplicates, gap-free per counter | Pass | Auto |
| Cancel | Own WAITING/CALLED only; not while serving | As expected | Pass | Auto |
| Active token limit / queue full / paused counter | Clear errors | TOO_MANY_ACTIVE_TOKENS, QUEUE_FULL, COUNTER_UNAVAILABLE | Pass | Auto |
| History | Finished tokens listed | As expected | Pass | Auto + manual |
| **Staff queue** | | | | |
| Transitions | WAITING→CALLED→SERVING→COMPLETED; skips/cancels | Correct; invalid transitions rejected | Pass | Auto + manual UI |
| Simultaneous "call next" | Only one succeeds on a single desk | 1 of 2 succeeded; one CALLED token | Pass | Auto |
| Cancel vs call race | Consistent final state | One terminal event at most | Pass | Auto |
| Lift batches | Call up to capacity | 3 called with capacity 3 | Pass | Auto |
| **Priority** | Reason required; reorder; notifications; audit | Reason enforced (router + engine); positions recomputed; PRIORITY_ASSIGNED / PRIORITY_ADJUSTMENT; event + audit | Pass | Auto + demo (3 → 1) |
| **Merge** | No deletions; alternate order; notifications; audit; restorable | A1,B1,A2,B2 order; provenance kept; QUEUE_MERGED/POSITION_CHANGED; audit `queue.merged`; reopen keeps tokens, new joins use B | Pass | Auto + manual browser banner |
| **Traffic** | Recalculate; explain | 360 s → 840 s with HEAVY +300 s; exact message "…from 6 to 14 minutes due to heavier traffic (Lunch rush)." | Pass | Auto + manual cue |
| **Countdown** | Derived from `estimated_wait_seconds` + `updated_at` + server clock | Same value across clients; periodic refresh re-anchors stale estimates | Pass | Auto + manual |
| **Notifications** | Right recipient, message, read state, persistence, realtime | Bystanders receive only their own; no names/emails of others; read/unread per user; delivered over SSE | Pass | Auto + manual |
| Preferences | Informational alerts can be muted | Muted types not created; transactional always sent | Pass | Auto |
| Browser notifications | Shown when tab hidden and permission granted | Denied state handled ("Browser alerts blocked"); gating logic unit-tested (granted+hidden shows, foreground/denied/missing API do not, constructor errors caught) | Partial | Real OS notification with permission granted not observed (pane reports `denied`) |
| Email | Not in scope | Not implemented | External | Post-MVP |
| **Realtime** | Updates without refresh; resync after reconnect | Student updated live for call, traffic, priority, merge; during outage "Reconnecting" + "Live updates paused"; after restart the missed DB change appeared with no reload | Pass | Manual on production build + auto SSE tests |
| **Camera** | Aggregate only; stale fallback; honest failure states | Stored columns are counts/levels/time only; stale → ignored; access limited to group staff | Pass | Auto |
| Camera permission denied | Clear message; queues keep working | "Camera permission was denied…" | Pass | Manual (browser blocks capture) |
| Camera recovery | A new report after staleness makes the signal count again | Fresh again, level MODERATE, traffic raised | Pass | Auto (operations: "goes stale and recovers") |
| Camera error messages | Each getUserMedia failure explained | Denied / not found / overconstrained / in use / insecure context / unknown all mapped | Pass | Auto (detection.test.ts) + manual (denied) |
| Model load and inference in Node | COCO-SSD loads and runs | Loaded (~3 s, CPU backend); 0 people on blank and noise frames | Pass | `pnpm verify:model` (not an accuracy test) |
| Demo flow over HTTP + SSE | Every step with separate sessions | Passes in the test suite and via `pnpm demo:smoke` | Pass | Auto (demo-flow.test.ts) + script |
| Live detection with a webcam | People counted in ROI, reported every 5 s | Not run | Not tested | Requires physical camera test |
| Model availability under CSP | Weights reachable | `model.json` fetched with 200 from the production page | Partial | Full model load follows camera permission |
| **Admin** | Overview, people, catalogue, assignments, audit, settings | Working; attention list and recent operations from real data | Pass | Auto + manual |
| **Bulk import** | Preview, validation, duplicates, atomic commit, codes | Invalid/duplicate/existing rows flagged; >5000 rows rejected; `role` column ignored (always STUDENT, PENDING); re-import creates nothing | Pass | Auto + manual UI |
| **Security** | No leakage; CSRF; headers | Generic 500 text; malformed JSON → 400; cross-origin POST → 403; CSP/HSTS in production; production refuses http/localhost origin | Pass | Auto + manual |
| **Accessibility** | WCAG 2.1 AA automated checks | axe-core on 21 screens/dialogs: 0 violations after fixes; keyboard sign-in; drawer focus trap | Pass | Screen-reader session not performed |
| **Responsive** | No horizontal scroll; readable at phone widths | 360/390/768/1024/1280/1440 checked; admin tables stack with labels | Pass | Manual |
| **Build** | Types, tests, production bundle | `tsc` clean; 114/114; build OK | Pass | |
| **Database** | Clean migration; constraints; no demo data | 19 tables, 31 FK, 11 unique, 6 CHECK, 0 users; idempotent | Pass | Manual on scratch DB |
| **Deployment** | Production boot on https origin | Boots; health OK; guards work | Partial | Hosting, TLS and managed DB are external; Docker image not built |
| **Three-role acceptance (UI)** | Student, staff and admin use the real UI at the same time | Every step passed; 2 bugs and 5 UX issues found and fixed (final-verification-report §28–30) | Pass | Manual, three concurrent sessions |
| **Demo flow (12 steps)** | Join → call → traffic → priority → merge → camera → admin | All steps pass; student received QUEUE_JOINED, WAIT_INCREASED, PRIORITY_ADJUSTMENT, QUEUE_MERGED over SSE | Pass | Script against dev server |
