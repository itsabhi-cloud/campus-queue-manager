# QueueSense design system: "Wayfinding"

The visual language comes from the world queues live in: printed queue tickets, now-serving
boards and campus signage. One element is bold, the token ticket, and everything around it stays
quiet.

## Tokens (`client/src/styles/tokens.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--board` | `#1b2340` | Text, dark "now serving" surfaces, dark buttons |
| `--paper` | `#f5f6f8` | App background |
| `--violet` | `#5b45c9` | Brand, links, your position in the queue line |
| `--signal` | `#f0b82a` | Reserved for "it's your turn": called tickets, called tokens on boards, called toasts |
| `--go` / `--halt` | `#1e7f55` / `#b83b34` | Open or serving / offline, cancelled, errors |
| `--amber-ink` | `#8a5300` | Paused, moderate traffic, "taking longer", waits increasing |
| `--ink-2`, `--ink-3` | `#454e6e`, `#5a6283` | Secondary and muted text (≥ 5.2:1 on every light surface) |

Every text/background pairing was checked for WCAG AA (lowest 4.97:1). Type uses Atkinson
Hyperlegible for everything readable and Barlow Condensed (tabular figures) for tokens, countdowns
and numbers. Minimum text size is 13px. Spacing is a 4px grid (`--s-1`…`--s-8`); corner radii are
6px (controls), 12px (panels) and pill (chips).

## Stylesheets

`tokens.css` → `base.css` (reset, focus, utilities) → `components.css` (buttons, chips, forms,
tables, dialogs, states, stats, lists, toasts) → `queue.css` (ticket, queue line, board, service
cards) → `layout.css` (shell, drawer, bottom nav, page layouts) → `landing.css`.

## Components (`client/src/components`)

| Component | Purpose |
| --- | --- |
| `queue/TokenTicket` | The signature active-queue card. Variants: waiting, almost next, called, serving, paused, offline; merged banner; priority chip; change cue; "taking longer than estimated"; "live updates paused" |
| `queue/QueueLine` | The counter, the people ahead as dots, and "You" |
| `queue/ServiceCard` | Campus service summary from live backend data |
| `queue/CameraSignal` | Fresh crowd count or "Camera offline — using queue data only" |
| `ui/primitives` | `Chip` (one badge with tone + glyph), `StatusBadge`, `CounterBadge`, `TrafficBadge` (bars + word), `StatStrip`/`Stat`, `Note`, `PageHeader`, `PanelHead`, `EmptyState`, `ErrorState`, `LoadingBlock`, `Countdown`, `ConnectionBadge`, `ServiceIcon`, `Field` (wires `aria-invalid`/`aria-describedby`), `Tabs`, `Pagination` |
| `ui/Dialog` | `Dialog` and `ConfirmDialog` (optional required reason, recorded by the server) |
| `AppShell` | Sidebar (desktop), accessible drawer (tablet/phone staff and admin), bottom tab bar (student phones) |

## Principles

1. **The token is the hero.** Students should answer "where am I, how long, where do I go" in about
   two seconds from the ticket alone.
2. **Yellow means go.** Signal yellow appears only when someone is called. The called ticket pulses
   twice on arrival; that is the only animation not triggered by the user (and it respects
   reduced motion).
3. **Say what changed.** Each authoritative update is compared with the previous one and described
   in one line ("Moved up to position 2", "Wait up about 5 min: Lunch rush", "Moved to Report
   Counter A"). Screen readers hear it through a polite live region.
4. **Status never depends on colour alone.** Chips carry an icon and a word; traffic carries bars
   and a word.
5. **Honest wording.** Estimates are labelled as estimates; cafeteria reserves a place, not an
   order; lifts are a virtual boarding queue with a traffic estimate; the camera "counts people,
   never identifies them".
6. **No template chrome.** No all-caps eyebrow labels, arrows appended to buttons, decorative
   gradients or card grids of identical metrics.

## Responsive behaviour

Verified at 360, 390, 768, 1024/1280 and 1440px wide. Students on phones get a bottom tab bar and a
ticket that fits above the fold; staff and admins get a drawer. Admin tables with the `stack` class
become labelled rows under 720px. Dialogs become bottom sheets on phones. Touch targets are at least
44px on coarse pointers.
