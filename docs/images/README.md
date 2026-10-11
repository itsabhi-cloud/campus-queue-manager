# Screenshots and demo GIF

The main [README](../../README.md) shows these files. Capture them from a freshly seeded development
database (`pnpm db:reset:dev`, then `pnpm dev`) so the data matches the demo script. Development
logins are listed at the top of `scripts/seed-dev.ts`.

The committed images were captured on 2026-10-11 by driving these steps with Playwright in headless
Chrome against a throwaway, freshly seeded database (phone shots at 3×, desktop at 2×). The steps
below also work by hand.

Use Chrome. For **phone** shots open DevTools → device toolbar → "iPhone 12 Pro" (390 × 844) and use
DevTools' ⋮ menu → **Capture screenshot** (not "full size"). For **desktop** shots set the window so
the page is 1280 × 800 (device toolbar → Responsive → 1280 × 800) and capture the same way. Save PNGs
at the device pixel ratio DevTools gives you; don't crop.

| File | Viewport | Account | How to get there |
| --- | --- | --- | --- |
| `landing.png` | Desktop 1280 × 800 | Signed out | Open `/`. Top of the page: headline, ticket and "Now serving" board. |
| `student-home.png` | Phone 390 × 844 | `student09@queuesense.dev` | Take a token at *Administration → Accounts & Fees* ("Any open counter") first, then open *Queues* (`/app`). The seed already gives this student a cafeteria token, which is listed first because fewer people are ahead of it. |
| `student-ticket.png` | Phone 390 × 844 | `student09@queuesense.dev` | Tap the ticket to open `/app/tokens/…`. Best moment: right after staff press **Call next** once, so it shows "Moved up to position …". |
| `student-called.png` | Phone 390 × 844 | `student09@queuesense.dev` | Keep the ticket open while staff call this student: the yellow "Go to … now" ticket. |
| `notifications.png` | Phone 390 × 844 | `student09@queuesense.dev` | After the traffic and priority steps of the demo, open *Alerts* (`/notifications`). |
| `staff-console.png` | Desktop 1280 × 800 | `staff.admin@queuesense.dev` | *Counter console* → *Accounts Desk 1* with at least two people waiting. |
| `admin-overview.png` | Desktop 1280 × 800 | `admin@queuesense.dev` | `/admin` after the demo steps, scrolled so *Needs attention* and the *Recent operations* entries are both in view. |
| `camera-station.png` | Desktop 1280 × 800 | `staff.lift@queuesense.dev` | `/camera` with a webcam running and a person in frame. Without a webcam (or with camera access blocked), press **Start camera** and capture the "Camera unavailable" state instead; the committed image shows that state. |

## Demo GIF: `demo.gif`

About 20–30 seconds, no audio, showing a live update arriving without a refresh:

The committed GIF was made from screenshots of the two windows taken together about 19 times a
second, played back at 10 frames per second side by side (ffmpeg); the clicked button is briefly outlined in yellow. By hand:

1. Put two windows side by side: the student ticket (`/app/tokens/…`, phone view) on the left and
   the staff console for the same counter on the right. Use different hosts so the sessions don't
   clash: `http://localhost:3000` for the student and `http://127.0.0.1:3000` for staff.
2. Start recording with **⌘ ⇧ 5 → Record Selected Portion** around both windows.
3. Staff press **Call next** → the ticket says "Moved up to position …".
4. Staff choose **Adjust traffic** → Heavy, +5 min, "Lunch rush" → the ticket shows the longer wait
   and the reason.
5. Staff finish the token in front (**Start serving**, then **Complete**) and press **Call next**
   again → the student's ticket turns yellow. Stop recording.

Convert the `.mov` to a GIF under 10 MB (GitHub's limit for images in a README):

```bash
ffmpeg -i demo.mov -vf "fps=12,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" docs/images/demo.gif
```

If it is still over 10 MB, lower `fps` to 10 or `scale` to 960.
