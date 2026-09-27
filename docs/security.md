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
  redacted automatically.

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
- Per-counter queue limit and per-student active-token limit (admin setting).

## Production configuration guards

- The server refuses to start in production unless `APP_ORIGIN` is a public `https://` origin (not
  `localhost`). `ALLOW_INSECURE_ORIGIN=true` exists only for running a production build locally.
- Malformed JSON bodies get `400 Malformed request body.`, oversized bodies `413`; neither is logged
  as a server error, and no response includes stack traces, SQL or file paths.

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
