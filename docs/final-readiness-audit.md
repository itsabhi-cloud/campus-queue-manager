# Final readiness audit

Date: 2026-09-28 · Branch `master` · Audited from commit `58e4c47` (clean working tree) · Local
environment: macOS, Node 24.15, MySQL 8.0.45. Every "Verified" below names the check that was run.
Full per-feature results are in [final-test-matrix.md](final-test-matrix.md).

## Summary

| Area | Status |
| --- | --- |
| Build, types, tests | **Verified**: `tsc` clean; 114/114 tests (14 files; updated in [final-verification-report.md](final-verification-report.md)) against a real MySQL test DB; production build succeeds |
| Database and migrations | **Verified**: clean database created by the bundled migrator (19 tables, 31 FKs, 11 unique, 6 CHECK); idempotent; 0 users |
| Authentication and sessions | **Verified**: automated tests plus manual keyboard sign-in; production cookie flags inspected |
| RBAC and object-level authorization | **Verified**: 26 privileged endpoints × student/staff/anonymous matrix; nothing changes on rejection |
| Queue engine, concurrency | **Verified**: transitions, invalid transitions, 25 concurrent joins, 20 mixed concurrent joins, racing duplicate joins, simultaneous staff calls, cancel-vs-call race |
| Priority, merge, traffic, notifications | **Verified**: automated tests plus live browser checks and the 12-step demo script |
| Realtime and resync | **Verified**: SSE delivery tests; manual disconnect, missed change and reconnect on the production build without reload |
| Four services | **Verified** via seeded configuration: Administration (Accounts, Certificates, Admissions), Printing (Xerox, Colour, Report/Bulk ×2), Cafeteria (Dine-in, Takeaway), Elevator (Lift 1, Lift 2, batch of 8) |
| Camera | **Partially verified**: aggregate reporting, access, staleness, traffic raising (tests); permission-denied UI (browser); model metadata reachable under production CSP. **Requires physical camera test** for live detection |
| Browser notifications | **Partially verified**: denied state handled (browser reported `denied`); granted path **not verified** |
| Email / password reset | **Not implemented** (by design): admins issue one-time reset codes. Email delivery is post-MVP |
| Accessibility | **Verified (automated)**: axe-core WCAG 2.1 A/AA + best practices on 21 screens/dialogs, 0 violations after fixes. A later re-run found 2 more (staff counter picker heading order, duplicate admin landmark names), now fixed; see [final-verification-report.md](final-verification-report.md) §17. Screen-reader session **not performed** |
| Responsive | **Verified (manual)**: 360, 390, 768, 1024/1280, 1440 px; no horizontal page scroll at 360 px |
| Deployment | **Configured**: Dockerfile, bundled migrate/admin scripts, production guards. **Requires external setup**: host, domain/TLS, managed MySQL. Docker image not built (Docker unavailable) |
| Dark mode | **Post-MVP** (decision below) |

## Issues found and fixed in this pass

| Issue | How it was found | Fix |
| --- | --- | --- |
| Production would start with `APP_ORIGIN=http://localhost` | Booted the production build | Server now refuses non-https or localhost origins in production (`ALLOW_INSECURE_ORIGIN=true` for local runs only). Unit test plus boot test |
| The first attempt at that guard wasn't wired into startup (a text replacement silently missed) | Boot test still started the server | Wired in and re-verified by booting with three origins |
| Malformed JSON body returned 500 and was logged as a server error | `curl` with a broken body | Returns `400 Malformed request body.`; integration test added |
| `node dist/migrate.js` could not find migrations when bundled | Ran the bundle | Migrations resolved from the working directory (`MIGRATIONS_DIR` override) |
| No production path for migrations and the first admin without dev tools | Deployment review | `build` now also bundles `dist/migrate.js` and `dist/create-admin.js` |
| `create-admin` printed a raw validation dump | Ran with bad input | Prints the first readable message |
| axe: definition-list misuse (stat strip, ticket stub) | axe-core | Helper text is now a `dd`; queue line moved out of the list |
| axe: scrollable tables not keyboard-reachable | axe-core | `tabIndex=0`, `role=region` and a unique label on each table wrapper |
| axe: duplicate unlabelled landmarks; missing `main` on auth/404; heading order; no `h1` on token page | axe-core | Labelled asides, `main` elements, `h2` empty-state titles, token number is the `h1` on its page |
| Catalogue counter rows showed unlabelled values on phones | 390 px review | Cell labels added |
| Staff board wasted height on phones; lift copy said "Nobody at the counter" | 390 px review | Compact board on phones; "No trip in progress" for lifts |

## Environment

All variables are documented in [`.env.example`](../.env.example) and validated at startup
(`server/_core/env.ts`). Development uses `.env` (git-ignored, verified not tracked). Production
values are set in the host's environment; `NODE_ENV` is set by the npm scripts. There is **no** email,
CORS, external notification or model configuration: notifications are in-app (plus the optional
browser Notification API), the API serves only its own origin, and the camera model is fetched by
the browser from Google's public model storage (allowed by the production CSP).

## Demo data and resets

`pnpm db:seed:dev` / `pnpm db:reset:dev` create the demo catalogue, staff, students and live queue
entries through the real queue engine. `db:reset:dev` **truncates all tables, including sessions, so
everyone is signed out**. Do it before a presentation, never during one. The seed refuses to run
with `NODE_ENV=production`; a production database created by migrations has zero users.

## Dark mode decision

Not implemented. It would double the colour review surface (tickets, signal yellow, charts, chips)
right before a demo for little gain in a daytime campus setting. The token-based stylesheet
(`client/src/styles/tokens.css`) makes it a contained post-MVP change.

## Two-browser demo, as run

Browser A was the in-app browser signed in as a student. Browser B was a scripted HTTP client signed in
as staff (this environment has one browser pane, and cookies are shared across its tabs). All
student-side updates were observed in Browser A without refreshing: call, traffic change with the
"Wait up…" cue and notification, priority reorder, merge banner, called (yellow) state, paused
counter, and reconnect resync. The same flow is reproducible with `pnpm demo:smoke`
(`scripts/demo-smoke.mjs`), which passed all 12 steps on 2026-09-28.

## Not verified

Live webcam detection, browser notifications with permission granted, a screen-reader session,
building/running the Docker image, and any real hosted deployment (HTTPS, proxy, managed database).
