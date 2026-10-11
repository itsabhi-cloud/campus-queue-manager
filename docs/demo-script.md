# QueueSense: 5-minute demo script

## Before the demo (not on the clock)

1. `pnpm db:reset:dev` rebuilds the demo data and **signs everyone out**. Then `pnpm dev`.
2. Optional pre-flight: `pnpm demo:smoke` runs the same flow automatically. It changes queue state,
   so run `pnpm db:reset:dev` again afterwards.
3. Open three windows. Sessions are per host, so give each role its own:
   - **A, student:** `http://localhost:3000`, Chrome DevTools device toolbar on "iPhone 12 Pro"
     (390 × 844), signed in as `student09@queuesense.dev`.
   - **B, staff:** `http://127.0.0.1:3000`, signed in as `staff.admin@queuesense.dev`.
   - **C, admin:** `http://admin.localhost:3000`, signed in as `admin@queuesense.dev`.

   Passwords are at the top of `scripts/seed-dev.ts` (development only).
4. Close notification toasts from earlier runs. Zoom the browser so the audience can read it.

## Script

| Time | Say / do | Window |
| --- | --- | --- |
| 0:00 | **The problem.** Campus lines at fee desks, printers, the cafeteria and lifts: you can't leave without losing your place, and you don't know how long it will take. Scroll the landing page: "Don't stand in line. Know your turn." | A (or desktop) |
| 0:30 | **Take a token.** Student opens *Administration → Accounts & Fees* and presses **Get a token**. Point at the ticket: token number, people ahead, estimated wait, the queue line with "You". The student can walk away. | A |
| 1:10 | **Live update.** Staff open the Accounts desk shown on the student's ticket and press **Call next**. The ticket changes without a refresh and says what changed ("Moved up to position …"). | B → A |
| 1:40 | **Explainable estimate.** Staff choose **Adjust traffic** → Heavy, +5 min, reason "Lunch rush". The ticket shows the longer wait with the reason, and a notification explains it. Open "How is this estimated?". | B → A |
| 2:20 | **A counter goes down.** Staff use **Take offline or merge** on a desk with people waiting and merge it into the other desk (reason: "System down"). Nobody loses their place; affected students are told where they moved. | B |
| 2:55 | **Admin view.** *Needs attention* lists the offline counter and heavy traffic; *Recent operations* shows the traffic change and the merge from the audit log. | C |
| 3:25 | **Built for phones.** Show the student app at 360 px: bottom tab bar, the ticket fits on screen, *Alerts* lists every change. Mention Lighthouse Accessibility 100 and the reduced-motion support. | A |
| 3:55 | **Privacy-preserving camera** (only if a webcam is available; otherwise one sentence). Camera station counts people in the browser and sends only a number; it can raise traffic, never identifies anyone. | B |
| 4:20 | **It's your turn.** Staff finish the token in front (**Start serving**, **Complete**) and press **Call next**. The ticket turns signal yellow: "Go to … now". | B → A |
| 4:40 | **Close.** Server is the source of truth (transactions, row locks), realtime over Server-Sent Events, role checks on every request, 115 automated tests. Questions. | Any |

If time is short, drop the camera step first, then the merge.

When the demo-mode backend is merged, the landing page shows **Try as Student / Staff / Admin**
buttons; they can replace the manual sign-ins in "Before the demo".

## What I built (Abhi Shiktha)

My part was the frontend, UX and presentation. These are my commits on `abhi/frontend-ux`:

| Area | What changed | Commit |
| --- | --- | --- |
| 404 page and motion | 404 page with the error code, an explanation, the right "home" for the signed-in role and a "Go back" button; short fade-in on page changes that turns off with reduced motion; logo aligned in auth cards | `1942353` |
| Admin overview polish | Chart legend text made readable (it used the pale bar colour); attention panel no longer stretches | `36c942c` |
| Brand assets | Favicon in the app's ticket mark, PNG and Apple touch icons, web manifest, 1200 × 630 Open Graph image, `robots.txt` | `42c89c2` |
| Mobile at 360 px | Notification tabs fit on one line; "Mark read" and history status chips move under the text on narrow screens; 44 px touch targets for text buttons, tabs, back links and the profile chip | `efd3d77` |
| Demo mode | "Try as Student / Staff / Admin" panel on the landing page, shown only when the server reports demo mode; uses a clearly marked placeholder until the backend endpoints merge | `50994ca` |
| Layout stability | Student home no longer jumps while loading (Cumulative Layout Shift 0.406 → 0–0.012) | `095dd68` |
| Accessibility | Profile chip's accessible name now matches its visible text | `ea8d75b` |
| Performance | Signed-in shell loads lazily, so public pages download 38 kB less JavaScript (minified; 12 kB gzipped) | `33de0fc` |
| Lighthouse audit | Scores for five pages on mobile and desktop recorded in `docs/testing.md` | `0363837` |
| README | "What it looks like" section with screenshot grid and demo GIF, plus the capture guide in `docs/images/README.md` | `371f223` |
| Report and demo | Project report in the SRMIST format; this demo script | `222ff51` and the commit that adds this file |

Talking points for my part (about 30 seconds, fits in the 3:25 slot):

- Every student screen was checked at 360 px with touch emulation, with no horizontal scrolling.
- Lighthouse: Accessibility, Best Practices and SEO 100 on every page tested; desktop Performance
  98–99. Mobile Performance is 76–83 because the server doesn't compress responses yet; with
  compression the same build measured 93–98.
- Fixed a large layout shift on the student home page and made the public pages lighter.
