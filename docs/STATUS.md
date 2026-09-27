# Verification status

Last full verification: 2026-09-28, macOS, Node 24.15, MySQL 8.0.45, local only.

Legend — **Verified (auto)**: covered by `pnpm test` against a real MySQL test database.
**Verified (manual)**: exercised by hand in a browser and/or via the HTTP API against the running
dev or production build. **Implemented, not verified**: code exists but was not exercised here.
**Needs external setup**: depends on something outside this repository.

## Build and tooling

| Check | Status |
| --- | --- |
| `pnpm check` (TypeScript, client + server + tests + scripts) | Verified — 0 errors |
| `pnpm test` | Verified — 87 tests, 10 files, all passing |
| `pnpm build` | Verified — client entry 274 KB (84 KB gzip); TensorFlow.js split into the camera page only |
| `pnpm start` (`NODE_ENV=production`) | Verified locally over HTTP on localhost |
| `pnpm db:migrate` on an empty database | Verified (dev DB, and the test DB is rebuilt from migrations on every test run) |
| `pnpm db:seed:dev`, `pnpm admin:create` | Verified |
| Linting | No ESLint config exists in the project; Prettier was applied to all changed source |

## Checklist

| Item | Status |
| --- | --- |
| Application starts (dev and production) | Verified (manual) |
| Authentication, logout, session expiry, lockout, activation codes | Verified (auto + manual) |
| RBAC and object-level authorization (staff scope, own tokens only) | Verified (auto + manual API) |
| Student flow: browse → join → live position → notifications → cancel/history | Verified (manual browser + auto) |
| Staff flow: call, serve, complete, skip, cancel, pause/resume, offline, traffic, priority, merge | Verified (auto; UI buttons for serve/complete/traffic verified manually) |
| Admin flow: overview, people, CSV import (preview + commit), catalogue, audit log | Verified (manual browser + auto) |
| Safe token generation under concurrency (25 parallel joins, racing duplicate joins) | Verified (auto) |
| Queue positions and ordering, priority consistency, merge loses no entries | Verified (auto + manual) |
| Countdown from stored estimate + server clock | Verified (manual browser) |
| Realtime updates without refresh (student sees calls, traffic, merge, priority) | Verified (manual browser + auto over real HTTP/SSE) |
| Reconnect + full resync after missed events (no page reload) | Verified (manual, production build) |
| Notifications and preferences | Verified (auto + manual) |
| Traffic updates with explained wait change | Verified (auto: exact message; manual browser) |
| Counter states (open/paused/offline) | Verified (auto + manual) |
| Administration / Printing / Cafeteria / Elevator services | Verified via seeded configuration (desk, merge, dine-in/takeaway, batch-of-8 lift estimates) |
| Camera: aggregate storage, access control, traffic raising, stale fallback | Verified (auto) |
| Camera: live webcam detection with COCO-SSD | **Implemented, not verified** — needs a device camera, permission, and internet for model weights |
| Privacy: only aggregates stored, no person-to-token link | Verified (schema + test asserting stored columns) |
| Audit logs | Verified (auto + manual) |
| Security headers, CSP (no violations in production bundle), CSRF origin check | Verified (manual + auto) |
| Responsive UI | Verified (manual) at 360, 390, 768, 1280 and 1440 px: student home, service detail, token detail, notifications, profile, staff console, admin overview, people, services, landing. No horizontal page scroll at 360 px |
| Accessibility | Implemented and checked by hand: AA contrast for every text colour pair (computed), 13px minimum text, focus-visible, skip link, labelled fields with linked errors, icon + word for every status, polite live announcements of queue changes, accessible drawer (focus trap, Escape, scroll lock — verified), reduced-motion support. **No automated a11y audit or screen-reader session was run.** |
| Browser notifications (Notification API) | Implemented, not verified (needs the user to grant permission) |

## Needs external setup

- **HTTPS / reverse proxy / hosting** — not performed. Required for secure cookies off localhost and
  for camera access on other devices. See [deployment.md](deployment.md).
- **Email delivery** — none built in; activation/reset codes are distributed by the institution
  (CSV export after import, or copy from the admin UI).
- **Multiple API instances** — would need a shared pub/sub and rate-limit store (see realtime.md).
- **COCO-SSD model weights** — downloaded from Google's public storage at runtime.

## Known limitations

- Estimates are heuristics (documented in queue-engine.md); with fewer than 5 recent completions the
  configured service time is used.
- Rate limits and realtime fan-out are per-process.
- No administrator MFA; no self-service password reset without an admin-issued code.

## Frontend design pass (2026-09-28)

Frontend-only changes (no backend, API, auth or realtime changes). Verified manually in the browser:
the ticket variants (waiting, almost next, called, serving, merged, paused/offline copy), the change
cue after a staff traffic change, the "You're in" banner after joining, notification categories,
the admin *Recent operations* feed, and the accessible mobile drawer. The 12-step demo flow script
still passes against the dev server after the redesign. See [design-system.md](design-system.md).
