# QueueSense: A Realtime Campus Queue Management Platform

<!--
  Course project report in the SRMIST chapter format. Text in [square brackets] is a placeholder
  to fill in before submission. Every number in this report comes from the code, the test suite or
  the checks recorded in testing.md; update them together if the app changes.
-->

**A course project report submitted for [Course code] Full Stack Web Development**

**Submitted by**

[Student name 1] ([Register number])
[Student name 2] ([Register number])

**Under the guidance of**

[Guide name], [Designation], [Department]

In partial fulfilment of the requirements for the degree of **Bachelor of Technology** in
**[Computer Science and Engineering / specialisation]**

[Department], School of Computing, College of Engineering and Technology,
SRM Institute of Science and Technology, Kattankulathur, Chengalpattu District

[Month Year]

---

## Bonafide certificate

Certified that this project report titled **"QueueSense: A Realtime Campus Queue Management
Platform"** is the bonafide work of **[Student name 1] ([Register number])** and **[Student name 2]
([Register number])**, who carried out the project work under my supervision.

| | |
| --- | --- |
| [Guide name], [Designation], [Department] | [Head of Department name], Professor and Head, [Department] |
| Signature: | Signature: |

## Acknowledgement

[Write your acknowledgement here: guide, head of department, course coordinator, institution and
anyone who helped test the system.]

## Abstract

QueueSense is a realtime web platform that lets students reserve a place in campus service queues
(administration desks, print centre, cafeteria and lifts) and leave the physical line. The server
issues concurrency-safe tokens, computes each student's position and an explainable wait estimate,
and pushes changes to browsers over Server-Sent Events. Staff operate counters, including priority,
pausing and merging a failed counter's queue into another without losing anyone's place.
Administrators manage services, people and policy with a full audit trail. Optional browser-side
computer vision (TensorFlow.js, COCO-SSD) estimates crowding near a counter while storing only
aggregate counts. The interface is phone-first for students and was checked at 360 px wide. The
system is implemented in TypeScript (React 19, Express, tRPC, MySQL 8) and verified by 115
automated tests against a real database, an automated accessibility audit, a Lighthouse audit
(Accessibility, Best Practices and SEO 100 on every page tested) and an end-to-end demonstration
script.

**Keywords:** queue management, realtime web application, Server-Sent Events, tRPC, MySQL,
computer vision, accessibility.

## Table of contents

1. [Introduction](#1-introduction)
2. [Literature survey and existing systems](#2-literature-survey-and-existing-systems)
3. [System requirements and analysis](#3-system-requirements-and-analysis)
4. [System design](#4-system-design)
5. [Implementation](#5-implementation)
6. [Testing and results](#6-testing-and-results)
7. [Conclusion and future enhancements](#7-conclusion-and-future-enhancements)
8. [References](#references)
9. [Appendix A: screenshots](#appendix-a-screenshots)
10. [Appendix B: repository guide](#appendix-b-repository-guide)

### List of tables

Table 3.1 Software requirements · Table 4.1 Modules · Table 4.2 Database tables · Table 6.1 Test
summary · Table 6.2 Lighthouse scores

### List of figures

Figure 4.1 System architecture · Figures A.1–A.8 Screenshots (Appendix A)

### Abbreviations

| Abbreviation | Meaning |
| --- | --- |
| API | Application Programming Interface |
| CLS | Cumulative Layout Shift |
| CSP | Content Security Policy |
| CSRF | Cross-Site Request Forgery |
| ORM | Object-Relational Mapper |
| RBAC | Role-Based Access Control |
| ROI | Region of Interest |
| SPA | Single-Page Application |
| SSE | Server-Sent Events |
| tRPC | TypeScript Remote Procedure Call |
| WCAG | Web Content Accessibility Guidelines |

---

## 1. Introduction

### 1.1 Overview

Campus services concentrate demand at predictable times: fee deadlines, printing before
submissions, lunch, and lifts between lectures. QueueSense replaces standing in line with a digital
token. A student takes a token on their phone, leaves, watches their live position and estimated
wait, and is notified when their turn approaches. Staff run each counter from a console, and
administrators configure services, people and policy centrally.

### 1.2 Problem statement

Students wait in physical lines with no idea how long the wait is, and cannot leave without losing
their place. Staff have no view of the line beyond what they can see, and no way to tell waiting
students about delays or a counter going down.

### 1.3 Objectives

1. Hold a student's place digitally so they can leave the line.
2. Show an authoritative live position and an explainable, honest wait estimate.
3. Notify students when their turn approaches and when conditions change.
4. Give staff fast, safe operational controls (call, serve, skip, priority, pause, merge).
5. Give administrators central configuration, people management, analytics and auditability.
6. Estimate physical congestion with computer vision without identifying individuals.
7. Make the student experience usable on a small phone (360 px) and accessible (WCAG 2.1 AA).

### 1.4 Scope

QueueSense covers four campus services (Administration, Printing, Cafeteria and Elevator/Lift)
with one configurable queue engine and no per-service code paths. It manages lines only: wait times
are estimates, not appointments; the cafeteria queue holds a place but does not take orders or
payments; the lift queue is a virtual boarding queue and does not control lift hardware; camera
stations count people and never identify them.

### 1.5 Organisation of the report

Chapter 2 reviews existing approaches. Chapter 3 lists requirements. Chapter 4 describes the
architecture, modules and database. Chapter 5 covers implementation, including the interface.
Chapter 6 presents testing and results. Chapter 7 concludes and lists future work.

## 2. Literature survey and existing systems

| Approach | Strength | Gap QueueSense addresses |
| --- | --- | --- |
| Physical lines | No equipment | No information, no mobility, unfair when counters change |
| Paper or kiosk tickets | Free people from standing | Still require watching a display nearby; give no estimate |
| Generic appointment systems | Predictable slots | Fixed slots don't fit walk-in services with variable service times |
| Single-counter token apps | Simple digital tokens | Usually no counter merge, priority with reasons, traffic-aware estimates or audit trail |

Design references used for the interface were the visual conventions of printed queue tickets,
"now serving" boards and campus signage, and the WCAG 2.1 guidelines for contrast, target size and
labelling.

## 3. System requirements and analysis

### 3.1 Functional requirements

- **Students:** sign in, activate an account with a one-time code, browse services, join a queue by
  counter or "shortest line", see live position, people ahead and estimated wait, cancel, view
  history, receive notifications and set notification preferences.
- **Staff:** call next (or the next lift batch), start serving, complete, skip a no-show, cancel
  with a reason, pause or take a counter offline, merge queues, adjust traffic or add a delay, and
  give priority with a reason.
- **Administrators:** live overview and analytics, live queues, people management, CSV bulk import
  with preview, catalogue editor, staff assignments, camera stations, audit log and settings.

### 3.2 Non-functional requirements

- **Consistency:** the server is the single source of truth; concurrent actions must not create
  duplicate or missing tokens.
- **Realtime:** changes reach open pages without a refresh, and pages resynchronise after a
  reconnect.
- **Security:** server-side authorisation on every call, protection against CSRF, safe session
  storage.
- **Privacy:** camera data is aggregate counts only.
- **Usability and accessibility:** WCAG 2.1 AA, phone-first student screens down to 360 px, 44 px
  touch targets on touch screens, reduced-motion support.

### 3.3 Software requirements

*Table 3.1 Software requirements*

| Component | Version |
| --- | --- |
| Node.js | 22 (the Docker image uses `node:22-alpine`) |
| Package manager | pnpm 10 |
| Database | MySQL 8.0.16 or later (CHECK constraints, generated columns) |
| Browser | A current Chrome, Edge, Firefox or Safari; the camera station needs camera permission |

### 3.4 Hardware requirements

Any machine that runs Node.js and MySQL for development. The camera station needs a webcam on the
staff device. Students only need a phone browser.

## 4. System design

### 4.1 Architecture

*Figure 4.1 System architecture*

```
React 19 + Vite ──tRPC (HTTP)──▶ Express + tRPC routers ──▶ Queue engine ──▶ MySQL 8 (Drizzle)
      ▲                                   │                    (transactions,
      └──────── SSE /api/realtime ◀── in-process broker ◀──── post-commit effects)
```

The backend is the single source of truth. Clients request actions; the server validates,
authorises and executes them in database transactions, records events, creates notifications and
then broadcasts identifier-only realtime events so every client refetches the authoritative state.
Details: [architecture.md](architecture.md).

### 4.2 Modules

*Table 4.1 Modules*

| Module | Responsibility |
| --- | --- |
| Accounts | Password sign-in, sessions, activation/reset codes, profiles, CSV import |
| RBAC | Role middleware plus object-level checks (staff counter assignments, token ownership) |
| Queue engine | Joining, transitions, priority, traffic, pause/offline, merge, estimates, notifications |
| Realtime | In-process broker and SSE stream; client invalidation, backoff and resync |
| Student app | Services, join flow, token ticket with live position and countdown, history, notifications |
| Staff console | Now-serving board, call/serve/complete/skip/cancel, traffic, priority, merge |
| Admin console | Overview and analytics, people, catalogue, assignments, audit log, settings |
| Camera station | In-browser person detection, ROI, smoothing, aggregate reporting, staleness |

### 4.3 Database design

*Table 4.2 Database tables*

The schema has 18 application tables ([database.md](database.md)): `users`, `student_profiles`,
`staff_profiles`, `user_avatars`, `sessions`, `auth_codes`, `services`, `queue_groups`, `counters`,
`staff_counter_assignments`, `queue_entries`, `queue_events`, `notifications`,
`notification_preferences`, `camera_stations`, `camera_metrics`, `audit_logs` and
`system_settings`.

Key invariants are enforced by the database: one active token per student per queue (a stored
generated column plus a unique index), a unique token sequence per counter per day, and CHECK
constraints on configuration. A clean migration creates 31 foreign keys, 11 unique constraints and
6 CHECK constraints.

### 4.4 Interface design

The visual language ("Wayfinding", [design-system.md](design-system.md)) comes from printed queue
tickets and "now serving" boards. The token ticket is the one bold element on a student's screen;
signal yellow is reserved for "it's your turn"; status is never shown by colour alone (chips carry
an icon and a word). Type uses Atkinson Hyperlegible for text and Barlow Condensed with tabular
figures for tokens and countdowns. Every text colour pairing meets WCAG AA contrast.

Students get a bottom tab bar on phones; staff and admins get a sidebar on desktop and an accessible
drawer on smaller screens. Data views show a loading placeholder, an empty state where a list can
be empty, and an error state with a retry button.

## 5. Implementation

### 5.1 Technologies

TypeScript throughout; React 19, Vite 7, wouter, TanStack Query and tRPC 11 on the client; Express
4, tRPC 11, Drizzle ORM and mysql2 on the server; zod for validation; Server-Sent Events for
realtime; TensorFlow.js with COCO-SSD for the camera station; Recharts for admin charts; Vitest and
axe-core for testing.

### 5.2 Queue engine

Every queue action runs in a transaction with row locks and a guarded state machine (waiting →
called → serving → completed, plus skipped and cancelled). Token numbers are generated per counter
per campus day (for example `F001`). Wait estimates combine the people ahead, the service time
(the configured average blended with recent completions), the traffic level and any staff delay;
when an estimate changes noticeably, the student is told why.
Merging a counter into another weaves the two lines together (A1, B1, A2, B2) without deleting
entries and keeps where each token came from. See [queue-engine.md](queue-engine.md).

### 5.3 Realtime communication

Server-Sent Events carry identifiers only; clients refetch authoritative data, coalesce bursts, and
resynchronise everything after reconnecting. See [realtime.md](realtime.md).

### 5.4 Security

scrypt password hashing; random session tokens stored as HMAC digests; HTTP-only, SameSite=Lax,
Secure cookies; CSRF origin checks; server-side RBAC with object-level authorisation; input
validation; rate limiting; audit logging; CSP and HSTS in production; production refuses insecure
origins and placeholder secrets. Details in [security.md](security.md).

### 5.5 Computer vision

Frames are processed in the browser; only a smoothed people count is sent every 5 seconds. Counts
map to a congestion level that can raise, but never lower, a queue's traffic level, and are never
added to the digital queue (which would double-count token holders standing nearby). Stale data is
ignored. See [computer-vision.md](computer-vision.md).

### 5.6 Frontend performance and polish

- Role areas are separate code chunks; TensorFlow.js loads only when the camera station opens, and
  the signed-in shell loads only with the first protected page, so the landing and sign-in pages
  download less (entry chunk 263.6 kB, 82.2 kB gzipped).
- The student home shows one placeholder until its data arrives, so content does not jump while
  loading (Cumulative Layout Shift 0 to 0.012).
- Page changes fade in briefly; with "reduce motion" turned on, animations are cut to effectively
  zero.
- A favicon set, web manifest, Open Graph preview image, `robots.txt` and a dedicated 404 page.
- A demo-mode panel ("Try as Student / Staff / Admin") on the landing page that appears only when
  the server reports demo mode. [Update this line once the backend endpoints are merged: at the
  time of writing the client reads a placeholder that keeps the panel hidden.]

## 6. Testing and results

### 6.1 Testing approach

*Table 6.1 Test summary*

| Kind | What | Result |
| --- | --- | --- |
| Automated (Vitest) | 115 unit and integration tests in 14 files against a real MySQL test database: authentication, a permissions matrix of 26 privileged operations, state transitions, concurrency, priority, merge and restore, traffic, notifications and recipient isolation, import validation, SSE delivery, security headers, and the full demo flow over HTTP and SSE | 115/115 pass |
| Accessibility | axe-core (WCAG 2.1 A/AA and best practices) on 21 screens and dialogs | 0 violations after fixes |
| Lighthouse | Five pages, mobile and desktop profiles, median of three runs on a local production build | See Table 6.2 |
| Responsive | Every student, staff and admin screen at 360 × 780 with touch emulation; earlier checks at 390, 768, 1024, 1280 and 1440 px | No horizontal overflow |
| End-to-end | Scripted 12-step demo (`pnpm demo:smoke`) and a manual three-role session | All steps pass |

The full matrix is in [testing.md](testing.md).

### 6.2 Results

- All 115 automated tests pass; the production build succeeds; type checking is clean.
- Concurrency: 25 simultaneous joins produced tokens C001–C025 with no gaps or duplicates; six
  simultaneous joins by one student produced exactly one token; two simultaneous "call next" clicks
  on one desk called exactly one token.
- Merge: a counter's waiting tokens were woven A1, B1, A2, B2 into the remaining counter with no
  entries lost and provenance kept; reopening the counter left both lines consistent.
- Estimates: heavy traffic plus a 5-minute delay changed a 4-person-line estimate from 360 s to
  840 s and notified the student with the reason.
- Realtime: after a server outage during which data changed, the open page showed the change after
  reconnecting without a reload.
- Accessibility: 0 axe-core violations across audited screens; Lighthouse Accessibility 100 on every
  page tested.

*Table 6.2 Lighthouse scores (2026-10-11, local production build, median of three runs)*

| Page | Mobile Perf | Desktop Perf | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- | --- | --- |
| Landing | 83 | 99 | 100 | 100 | 100 |
| Sign in | 83 | 99 | 100 | 100 | 100 |
| 404 | 83 | 99 | 100 | 100 | 100 |
| Student home | 76 | 98 | 100 | 100 | 100 |
| Service page | 77 | 98 | 100 | 100 | 100 |

Accessibility, Best Practices and SEO are the same on the mobile and desktop profiles. Mobile
Performance is below the 90 target because the server does not yet compress responses. With a
temporary gzip proxy in front of the same build, the mobile scores were 93–98; this is an experiment,
not a recorded score.

## 7. Conclusion and future enhancements

### 7.1 Conclusion

QueueSense lets students hold a place in campus queues from their phones and see a live,
explainable position and wait estimate. The server enforces consistency with transactions and
database constraints, realtime updates reach every open page, and staff can handle real-world
problems (a counter going down, a priority case, a lunch rush) without anyone losing their place.
The objectives in Section 1.3 are met, with the limitations below.

### 7.2 Limitations

Estimates are heuristics, not appointments. The API runs as a single instance (in-memory realtime
and rate limits). There is no email delivery, self-service password reset or administrator MFA.
Mobile Lighthouse Performance is below 90 until responses are compressed. Live webcam detection,
browser notifications with permission granted, a screen-reader session and a hosted deployment were
not tested in the development environment.

### 7.3 Future enhancements

Response compression; email/SMS notifications and self-service password reset; Redis-backed
realtime and rate limiting for multiple instances; SSO with the institution's identity provider;
dark mode; historical forecasting of busy periods; kiosk mode for students without phones; QR
check-in at counters.

## References

1. React documentation, react.dev.
2. tRPC documentation, trpc.io.
3. Drizzle ORM documentation, orm.drizzle.team.
4. MySQL 8.0 Reference Manual, dev.mysql.com/doc.
5. WHATWG HTML Living Standard, "Server-sent events", html.spec.whatwg.org.
6. TensorFlow.js and the COCO-SSD model, tensorflow.org/js and github.com/tensorflow/tfjs-models.
7. W3C, Web Content Accessibility Guidelines (WCAG) 2.1, w3.org/TR/WCAG21.
8. Google, Lighthouse documentation, developer.chrome.com/docs/lighthouse.
9. OWASP Cheat Sheet Series (session management, CSRF), cheatsheetseries.owasp.org.

[Format these in the citation style your department requires.]

## Appendix A: screenshots

The screenshots are in [`docs/images/`](images/README.md), which also says exactly how each one was
captured.

| Figure | File |
| --- | --- |
| A.1 Landing page | `images/landing.png` |
| A.2 Student home (phone) | `images/student-home.png` |
| A.3 Token detail (phone) | `images/student-ticket.png` |
| A.4 Called ticket (phone) | `images/student-called.png` |
| A.5 Notifications (phone) | `images/notifications.png` |
| A.6 Staff counter console | `images/staff-console.png` |
| A.7 Admin overview | `images/admin-overview.png` |
| A.8 Camera station | `images/camera-station.png` |

## Appendix B: repository guide

| Path | Contents |
| --- | --- |
| `client/src` | React app: pages per role, components, hooks, styles (design tokens) |
| `server` | Express app, tRPC routers, queue engine, auth, realtime |
| `drizzle` | Schema and SQL migrations |
| `shared` | Types and constants used by both sides |
| `tests` | Unit and integration tests |
| `docs` | Architecture, database, queue engine, realtime, security, computer vision, testing, deployment, design system, demo script |
