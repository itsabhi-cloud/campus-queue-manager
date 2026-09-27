# Queue engine

All queue mutations live in [`server/queue/engine.ts`](../server/queue/engine.ts). Pure logic is
split out so it can be unit-tested: [`stateMachine.ts`](../server/queue/stateMachine.ts),
[`ordering.ts`](../server/queue/ordering.ts), [`estimation.ts`](../server/queue/estimation.ts).

## Hierarchy

```
Service (e.g. Printing)
  └─ Queue group (e.g. Report / Bulk Printing)   ← behaviour is configured here
       └─ Counter (Report Counter A, prefix RA)  ← tokens RA001, RA002…
            └─ Queue entries
```

Seeded example (development): Administration → Accounts & Fees (2 desks), Certificates, Admissions ·
Printing → Xerox, Colour, Report/Bulk (Counters A and B) · Cafeteria → Dine-in, Takeaway ·
Elevator → Lift 1, Lift 2 (batch capacity 8). Admins can change all of this in the UI.

## States

| From | Allowed to | Triggered by |
| --- | --- | --- |
| WAITING | CALLED, SKIPPED, CANCELLED | staff call / skip / cancel; student cancel |
| CALLED | SERVING, SKIPPED, CANCELLED, WAITING* | staff; student cancel; *system only, when a counter is merged away |
| SERVING | COMPLETED, CANCELLED | staff |
| COMPLETED / SKIPPED / CANCELLED | — | terminal |

Clients never send a target status. Every transition is a guarded
`UPDATE … WHERE id = ? AND status = <expected>`; if another request changed the row first, the
caller gets a `CONFLICT` and nothing is written.

## Concurrency

- Every operation runs in a transaction (READ COMMITTED) and locks the counter row with
  `SELECT … FOR UPDATE`. Lock order is always *user row → queue group row → counter rows by
  ascending id*, which avoids deadlock cycles; deadlocks/lock timeouts are retried automatically.
- **Joining** additionally locks the student's `users` row so the "max active tokens" limit can't be
  raced across different queues.
- **Token numbers**: the counter row holds `next_sequence` and `sequence_date`. Under the lock the
  engine resets to 1 on a new campus day (`CAMPUS_TIMEZONE`) and increments. A unique index backs it.
- Tested: 25 simultaneous joins produce `C001…C025` with a gap-free order, and 6 simultaneous joins by
  one student produce exactly one token.

## Ordering and positions

Waiting entries are ordered by **priority first** (earliest priority first), then by `order_key`,
a per-counter monotonic number assigned at join time. Position = index + 1; "people ahead" = index.
Positions are always computed on the server from the current rows.

## Priority

`staff.setPriority({ entryId, enabled, reason })` — reason required (≥ 3 chars), only for WAITING
tokens, staff must be assigned to the counter. The engine snapshots positions before and after, then:
- notifies the prioritised student ("…has been given priority… Please be ready when called."),
- notifies every student whose position changed ("Queue order was updated due to a priority
  adjustment. Your token RA003 is now position 4."),
- records a `PRIORITY_ASSIGNED`/`PRIORITY_REMOVED` event with previous/new position, and an audit log.

## Merging (e.g. a printer jams at Counter B)

`staff.setCounterStatus({ counterId: B, status: "OFFLINE", reason, mergeIntoCounterId: A, strategy? })`
or `staff.merge(...)`. Staff must operate either counter; both must be in the same queue group; the
target must not be offline; nobody may be *being served* at the source (finish them first).

1. Tokens already *called* at B go back to WAITING at the front of B's line.
2. B's waiting line is woven into A's using the strategy (default from the queue group):
   - `ALTERNATE` → A1, B1, A2, B2, … (default; fair to both lines)
   - `JOIN_TIME` → by original join time
   - `APPEND` → A's line, then B's
   Priority tokens keep their precedence. New order keys are assigned from A's allocator.
3. Entries move to A (`counter_id`), keep their token number and `original_counter_id`; nothing is
   deleted. B becomes OFFLINE with `merged_into_counter_id = A`.
4. Moved students get "Counter B is unavailable (Printer jam). Your token B102 now continues at
   Counter A — position 4…"; A's students whose position changed are told too. Events + audit log.

Reopening B (`status: OPEN`) clears the merge marker; merged tokens stay at A and new joins can use B.

## Wait estimation

```
cyclesAhead  = floor(peopleAhead / serveCapacity)
cycleSeconds = serviceSeconds × trafficMultiplier(effectiveTraffic)     NORMAL 1.0 · MODERATE 1.25 · HEAVY 1.5
inProgress   = max(15% of a cycle, cycleSeconds − time the current batch has been at the counter)  (0 if idle)
estimate     = cyclesAhead × cycleSeconds + inProgress + staffDelaySeconds
```

- **serviceSeconds** is the configured average, blended 50/50 with the median of up to 20 service
  durations completed in the last 3 hours once at least 5 exist, clamped to 0.5×–2× the configured
  value (one unusual transaction can't distort everything).
- **serveCapacity** makes the same formula work for lifts (8 riders per trip) and desks (1).
- **Staff delay** is added once (e.g. "+5 min, system outage").
- **Effective traffic** is the staff-set level, optionally *raised* (never lowered) by fresh camera
  congestion for queue groups with camera assist — see below.
- The UI shows the traffic level, the delay and its reason, and an "How is this estimated?"
  explanation. It always labels the number as an estimate.

### Avoiding double counting with the camera

The camera sees people physically near a counter — many of whom *are* token holders. Adding camera
counts to the digital queue length would count them twice. So camera data never changes
`peopleAhead`; it only maps to a congestion level (`count ≥ moderateAt` → MODERATE,
`≥ heavyAt` → HEAVY) that can raise the traffic multiplier. Stale camera data (older than the
configured staleness, default 60 s) is ignored and the estimate falls back to the digital queue and
the staff-set traffic level.

### Consistent countdowns

Each waiting entry stores `estimated_wait_seconds` and `estimate_updated_at`. Clients compute
`remaining = estimate − (serverNow − updatedAt)` once a second locally (one shared timer), using a
server clock offset learned from API responses and the SSE `hello` event. The server rewrites a
stored estimate only when it differs from the running countdown by at least 20 s or 10%, so
countdowns don't jump on every event. A background job re-evaluates counters with waiting tokens
every 60 s so estimates stay honest when a service runs long.

### When students are told about wait changes

Only when a *cause* changes (traffic, delay, camera congestion) and the change is both ≥ 2 minutes
and ≥ 20% — e.g. "Estimated wait increased from 6 to 11 minutes due to heavier traffic (Lunch rush)."
Normal progress is visible live and doesn't generate notifications.

## Notifications generated

| Event | Notification | Mutable by preference |
| --- | --- | --- |
| join | QUEUE_JOINED (shown as a local confirmation) | no |
| position ≤ threshold (default 2), once per token | ALMOST_NEXT | yes |
| call | TOKEN_CALLED (service-specific wording: cafeteria "place your order", lift "board now") | no |
| serve / complete | SERVICE_STARTED / SERVICE_COMPLETED | no |
| skip / staff cancel | TOKEN_SKIPPED / TOKEN_CANCELLED (with reason) | no |
| merge | QUEUE_MERGED (moved) / POSITION_CHANGED (receiving line) | position changes: yes |
| priority | PRIORITY_ASSIGNED / PRIORITY_ADJUSTMENT | adjustments: yes |
| traffic/delay/camera | WAIT_INCREASED / WAIT_DECREASED | yes |
| pause / offline / resume | COUNTER_PAUSED / COUNTER_OFFLINE / COUNTER_RESUMED | yes |

## Service-specific behaviour (configuration, not code)

- **Administration** — single desks, 4–6 min service; Accounts has two desks and "shortest line".
- **Printing** — `unitLabel = jobs`; Report/Bulk Printing has two counters and the ALTERNATE merge.
- **Cafeteria** — Dine-in / Takeaway queue groups; the service notice states that ordering and
  payment happen at the counter. No menus or payments exist in the system.
- **Elevator** — one queue group per lift, `serveCapacity = 8`, `unitLabel = riders`, camera assist on.
  "Call next batch" calls up to 8 tokens; "Start boarding" / "Boarded" complete the trip. The service
  notice states QueueSense doesn't control the lifts.
