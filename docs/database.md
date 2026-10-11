# Database

MySQL 8.0.16+ via Drizzle ORM. Tables and columns are `snake_case`; timestamps are `TIMESTAMP(3)`
stored and exchanged in **UTC** (every pooled connection runs `SET time_zone = '+00:00'`).
The schema lives in [`drizzle/schema.ts`](../drizzle/schema.ts); SQL migrations in `drizzle/migrations/`.

## Entities

| Table | Purpose |
| --- | --- |
| `users` | Identity: email (unique), name, role (`STUDENT`/`STAFF`/`ADMIN`), status (`PENDING`/`ACTIVE`/`SUSPENDED`/`DISABLED`), scrypt password hash, lockout counters |
| `student_profiles` | College ID (unique), department, phone. No academic year/semester — those change over time and aren't identity |
| `staff_profiles` | Employee ID (unique, optional), designation, phone |
| `user_avatars` | Small client-resized profile photo (validated PNG/JPEG/WebP data URL) |
| `notification_preferences` | Opt-outs for informational alerts and the "almost next" threshold |
| `auth_codes` | HMAC digests of one-time activation/reset codes, expiry, used-at |
| `sessions` | HMAC digest of the session cookie token, expiry, last seen, user agent, IP |
| `services` | Administration, Printing, Cafeteria, Elevator… (`kind` drives icon/copy only) |
| `queue_groups` | A queue within a service: service time, batch capacity, queue limit, merge strategy, traffic level/delay/reason, camera assist + thresholds |
| `counters` | A desk/station within a group: token prefix (unique), status, merge target, daily sequence and order-key allocators |
| `staff_counter_assignments` | Which staff may operate which counters |
| `queue_entries` | Tokens: current and original counter, status, timestamps, priority (+ who/why/when), stored estimate + time, order key |
| `queue_events` | Append-only history of every queue transition and operation |
| `notifications` | Per-user notification center rows |
| `camera_stations` | Station name, watched queue group, ROI, confidence threshold, last aggregate report |
| `camera_metrics` | Aggregate counts only (people count, raw detections, traffic level, time) |
| `audit_logs` | Actor, action, entity, metadata (no secrets), IP |
| `system_settings` | Key/value campus settings (token limit, camera staleness, email domains, code validity) |

## Invariants enforced by the database

| Invariant | Mechanism |
| --- | --- |
| One active token per student per queue group | `active_group_key` is a **stored generated column** = `queue_group_id` while status is WAITING/CALLED/SERVING, otherwise `NULL`; unique index on `(user_id, active_group_key)`. Racing joins cannot both succeed. |
| No duplicate token numbers | Unique `(original_counter_id, queue_date, sequence_number)`; sequences are allocated under the counter row lock |
| Unique emails, college IDs, employee IDs, token prefixes, service slugs | Unique indexes |
| Sane configuration | CHECK constraints: service time 10–7200 s, capacity 1–50, queue limit 1–5000, delay 0–7200 s, sequence ≥ 1, camera counts ≥ 0 |
| Referential integrity | Foreign keys; queue history is `RESTRICT` (services/counters with history can't be hard-deleted; they're deactivated instead) |

MySQL does not allow CHECK constraints on `AUTO_INCREMENT` columns or on columns with `ON DELETE`
actions, so "a counter can't be merged into itself" is enforced in the engine.

## Indexes worth knowing

- `queue_entries (counter_id, status, is_priority, order_key)` — the waiting line of a counter.
- `queue_entries (user_id, joined_at)` — a student's tokens and history.
- `queue_events (queue_group_id, created_at)`, `(type, created_at)` — analytics.
- `notifications (user_id, read_at)` — unread counts.

## Migrations

```bash
pnpm db:generate   # after editing drizzle/schema.ts
pnpm db:migrate    # apply to DATABASE_URL
```

The initial migration replaces the prototype's schema entirely (the prototype stored no production
data). Tests rebuild `TEST_DATABASE_URL` from the same migrations before every run.

## Development data vs production data

`pnpm db:seed:dev` (refuses `NODE_ENV=production`) creates a demo catalogue and test accounts.
Production starts empty: `pnpm admin:create` bootstraps an administrator, who then configures the
catalogue and imports real students.
