# Security

## Authentication

- **Passwords**: scrypt (N=16384, r=8, p=1, 64-byte key, per-user salt), parameters stored with the
  hash. Policy: 10–128 characters with at least one letter and one digit. Unknown accounts still
  run a scrypt computation so response time doesn't reveal whether an email exists; wrong email and
  wrong password return the same message.
- **Sessions**: 256-bit random token in an HTTP-only cookie `qs_session` (`SameSite=Lax`, `Secure`
  in production, `Path=/`). The database stores only `HMAC-SHA256(AUTH_SECRET, token)`, so a
  database leak can't be replayed as sessions. Absolute expiry (`SESSION_TTL_HOURS`, default 7 days);
  logout deletes the server-side session; password change signs out other devices; suspension signs
  out everywhere and closes realtime streams. Expired sessions are purged hourly.
- **Provisioning**: there is no public sign-up. Admins create staff and students (individually or
  by CSV import). Accounts start `PENDING` and are activated with a one-time code (60-bit, Crockford
  base32, stored as an HMAC digest, single use, expires after a configurable number of days). The
  same flow resets forgotten passwords. Codes are shown to the admin exactly once.
- **Brute force**: 5 failed passwords lock an account for 15 minutes. Per IP, 50 *failed* sign-ins
  (or 20 failed activation codes) in 10 minutes block further attempts from that IP; successful
  sign-ins are not counted, so hundreds of students behind one campus NAT can still sign in. Set
  `TRUST_PROXY` behind a reverse proxy so client IPs are real.
- **Bootstrap**: `pnpm admin:create` creates the first administrator from the command line.

## Authorization

- Role checks are tRPC middleware (`studentProcedure`, `staffProcedure`, `adminProcedure`); the role
  comes from the database session, never from the browser.
- Object-level checks: staff operate only counters in `staff_counter_assignments`
  (`assertCounterAccess`); group-level actions (traffic, camera reports) require an assignment in
  that group; merges require the staff member to operate one of the two counters. Students can only
  read and cancel their own tokens — other students' tokens return `NOT_FOUND` (no existence leak).
- Admin safety rails: admins can't change their own role/status, the last active admin can't be
  demoted or disabled, and student accounts can't be turned into staff.
- Frontend route guards exist for UX only.

## Input, output and data exposure

- Every procedure validates input with zod (unknown keys are stripped, so e.g. a `role` field sent to
  profile update is ignored). The queue position, counter ownership and role are always computed on
  the server.
- SQL: Drizzle parameterises all queries; `LIKE` searches escape wildcards; the only raw SQL uses
  fixed table names (development reset).
- XSS: React escapes output; there is no `dangerouslySetInnerHTML`. Avatars must be base64 PNG/JPEG/WebP
  data URLs (SVG rejected) under ~100 KB.
- CSV exports prefix cells starting with `= + - @` to prevent spreadsheet formula injection.
- Broadcast realtime events carry ids only. Queue views show tokens, not names; staff see the
  name and college ID only for the token currently at their counter, to verify the holder.
- Errors: internal errors are logged server-side and returned as a generic message with an
  `appCode`; stack traces and SQL never reach clients.
- Logs are structured JSON; keys matching password/secret/token/cookie/code/authorization are
  redacted automatically. Database errors are logged with the SQL shape and the driver's cause
  (e.g. `ER_DUP_ENTRY`), but the bound values Drizzle appends (`params: …`) are replaced with
  `[redacted]`, so hashes, digests and emails don't reach the logs.

## Browser protections

- CSRF: `SameSite=Lax` cookies **and** an Origin check — state-changing API requests with a foreign
  `Origin` are rejected (`APP_ORIGIN` in production).
- Production headers: strict `Content-Security-Policy` (scripts only from self; styles/fonts from
  self and Google Fonts; `connect-src` also allows Google's model bucket for COCO-SSD weights),
  `Strict-Transport-Security`, `X-Frame-Options: DENY` / `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy: camera=(self)`.
- Request bodies are limited (3 MB for tRPC, enough for a 5,000-row CSV).

## Abuse and resource limits

- 240 mutations per user per minute; camera reports ≤ 40 per station per minute.
- At most 8 realtime (SSE) streams per session (several tabs); further attempts get `429`. The cap
  is per session, not per account, so many people signed into one shared demo account each get
  their own allowance.
- Per-counter queue limit and per-student active-token limit (admin setting).

## Production configuration guards

- The server refuses to start in production unless `APP_ORIGIN` is a public `https://` origin (not
  `localhost`). `ALLOW_INSECURE_ORIGIN=true` exists only for running a production build locally.
- Malformed JSON bodies get `400 Malformed request body.`, oversized bodies `413`; neither is logged
  as a server error, and no response includes stack traces, SQL or file paths.

- `TRUST_PROXY` must be a hop count (usually `1`) or IP/subnet names. `true` is refused: trusting
  every hop would let clients forge `X-Forwarded-For` and sidestep the per-IP sign-in limits.
- `AUTH_SECRET` values from `.env.example`, the test setup or the CI workflow are refused in
  production, as are low-variety strings.

## Secrets

`.env` is git-ignored; `.env.example` has placeholders only. `AUTH_SECRET` (≥ 32 chars) is required
and validated at startup. Nothing secret is exposed to the client bundle (no `VITE_` secrets exist).

## Known limitations

- Rate limiting and realtime fan-out are in-memory (single instance). Use Redis-backed equivalents
  if you scale horizontally.
- No email delivery is built in: activation codes are distributed by the institution (the import
  produces a CSV of codes). Integrating an SMTP provider would allow self-service password reset.
- No MFA for administrators.
- Development seed credentials live in `scripts/seed-dev.ts` by design (local testing only; the seed
  refuses to run with `NODE_ENV=production`, and production databases start with zero users).

## Public demo mode

`DEMO_MODE=true` is for a showcase instance with its own database.

- **Sign-in**: `auth.demo` (public query) returns `{ enabled, roles }`; `auth.demoLogin({ role })`
  signs into the shared demo account for that role and returns the same user object and session
  cookie as `auth.login`. With `DEMO_MODE` off it returns `FORBIDDEN`. Limited to 60 per IP per 10
  minutes (each creates a session).
- **Accounts**: created by the demo seed with `users.is_demo = true` and random passwords that are
  never stored or shown, so password sign-in can't reach them. Accounts a demo admin creates are
  flagged as demo too, so they carry the same restrictions.
- **Blocked for demo accounts** (`FORBIDDEN`): changing password, uploading a profile photo (it
  would be shown to every visitor), and the admin actions that lock people out or change the demo
  for everyone: suspending/disabling users, changing roles, issuing access codes, committing a CSV
  import and changing system settings. Queue, staff and catalog actions stay available; the daily
  reset undoes them.
- **Reset**: wipes every table and reseeds, once per campus day after `DEMO_RESET_HOUR`, on startup
  if the database is empty, or on demand with `node dist/seed-demo.js`. It refuses while any
  non-demo account exists, so a real deployment started with `DEMO_MODE=true` by mistake is not
  wiped. Resets sign everyone out.
- **Privacy**: anyone can be the demo admin and read the audit log, so in demo mode the audit log
  doesn't record IP addresses.

## Production review (2026-10-11)

Checked against the production build (`NODE_ENV=production`, `node dist/index.js`) and the code:

| Area | Result |
| --- | --- |
| Session cookie | `HttpOnly; Secure; SameSite=Lax; Path=/`, 7-day `Max-Age`; only an HMAC of the token is stored |
| CSRF | Cross-origin POST → 403; `Origin: null` → 403; a mutation over GET → 405 (tRPC); session cookie is `SameSite=Lax` |
| Sign-in limits | Per-IP failure limits and per-account lockout as described above; depend on a correct `TRUST_PROXY` |
| `AUTH_SECRET` guard | Refuses example, test and CI secrets and low-variety strings in production (**fixed**: the CI secret was accepted) |
| Error responses | Malformed JSON → 400, oversized → 413, internal → generic message; no stack, SQL or paths in responses |
| Logs | **Fixed**: database errors included bound query values (password hashes, digests, emails) in message and stack |
| Realtime | 401 without a session; **fixed**: one session could open unlimited streams, now 8 |
| Headers | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; no `X-Powered-By` |
| Static files | `../` traversal falls through to `index.html`; hashed assets cached immutably, HTML `no-cache` |
| Health | Reports status, uptime, DB latency and SSE connection count; no versions, hosts or secrets |
| `TRUST_PROXY` | **Fixed**: `true` crashed with Express's "invalid IP address"; now a clear startup error |

Not changed, by design or left for later: account lockout can be triggered by anyone who knows an
email (the trade-off for not counting successful sign-ins per IP); signing in does not revoke a
session cookie the browser already held; the cookie has no `__Host-` prefix; queries are not
rate-limited.
