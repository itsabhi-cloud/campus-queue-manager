/**
 * DEVELOPMENT DEMO SMOKE TEST — runs the hackathon demo flow over HTTP + SSE against a running
 * dev server seeded with `pnpm db:reset:dev`. Uses the dev seed accounts from scripts/seed-dev.ts.
 * Usage: pnpm dev (in another terminal), then `pnpm demo:smoke`. It changes queue state; reseed after.
 */
import superjson from "superjson";
const base = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const post = async (cookie, path, input) => {
  const r = await fetch(`${base}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(superjson.serialize(input)),
  });
  const body = await r.json();
  if (body.error) throw new Error(`${path}: ${body.error.json.message}`);
  return {
    data: superjson.deserialize(body.result.data),
    cookie: r.headers.getSetCookie()[0]?.split(";")[0],
  };
};
const get = async (cookie, path, input) => {
  const r = await fetch(
    `${base}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(superjson.serialize(input)))}`,
    { headers: { cookie } }
  );
  const body = await r.json();
  if (body.error) throw new Error(`${path}: ${body.error.json.message}`);
  return superjson.deserialize(body.result.data);
};
const login = async (email, password) =>
  (await post(null, "auth.login", { email, password })).cookie;
const step = (n, text) => console.log(`${String(n).padStart(2)}. ${text}`);

const student = await login("student09@queuesense.dev", "DevStudent#2026");
step(1, "student signed in");
const events = [];
const ctrl = new AbortController();
const stream = await fetch(`${base}/api/realtime`, {
  headers: { cookie: student },
  signal: ctrl.signal,
});
(async () => {
  const rd = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop();
      for (const p of parts) {
        const d = p.split("\n").find(l => l.startsWith("data: "));
        if (d) events.push(JSON.parse(d.slice(6)));
      }
    }
  } catch {}
})();

const catalog = await get(student, "catalog.list", undefined);
step(2, `campus services: ${catalog.services.map(s => s.name).join(", ")}`);
const reports = catalog.services
  .find(s => s.kind === "PRINTING")
  .groups.find(g => g.slug === "reports");
const counterB = reports.counters.find(c => c.tokenPrefix === "RB"),
  counterA = reports.counters.find(c => c.tokenPrefix === "RA");
step(3, `selected ${reports.name} → ${counterB.name}`);
const joined = (
  await post(student, "queue.join", {
    queueGroupId: reports.id,
    counterId: counterB.id,
  })
).data;
step(
  4,
  `token ${joined.tokenNumber}, position ${joined.position}, ~${Math.round(joined.estimatedWaitSeconds / 60)} min`
);
const staff = await login("staff.print@queuesense.dev", "DevStaff#2026");
const other = await login("student10@queuesense.dev", "DevStudent#2026");
const behind = (
  await post(other, "queue.join", {
    queueGroupId: reports.id,
    counterId: counterB.id,
  })
).data;
let mine = (await get(student, "queue.myActive", undefined)).entries.find(
  e => e.id === joined.entryId
);
step(
  5,
  `left the line; watching: ${mine.peopleAhead} ahead, estimate ${mine.estimatedWaitSeconds}s as of ${mine.estimateUpdatedAt.toISOString()}`
);
const called = (await post(staff, "staff.callNext", { counterId: counterB.id }))
  .data;
step(6, `staff called ${called.called[0].tokenNumber}`);
await post(staff, "staff.setTraffic", {
  queueGroupId: reports.id,
  level: "HEAVY",
  delaySeconds: 300,
  reason: "Lunch rush",
});
mine = (await get(student, "queue.myActive", undefined)).entries.find(
  e => e.id === joined.entryId
);
step(
  7,
  `traffic HEAVY +5 min → student estimate now ${mine.estimatedWaitSeconds}s`
);
const pr = (
  await post(staff, "staff.setPriority", {
    entryId: behind.entryId,
    enabled: true,
    reason: "Medical appointment",
  })
).data;
step(
  8,
  `priority for ${pr.tokenNumber}: position ${pr.previousPosition} → ${pr.newPosition}`
);
const board = await get(staff, "staff.board", { counterId: counterB.id });
await post(staff, "staff.serve", { entryIds: board.inProgress.map(e => e.id) });
await post(staff, "staff.complete", {
  entryIds: board.inProgress.map(e => e.id),
});
const m = (
  await post(staff, "staff.setCounterStatus", {
    counterId: counterB.id,
    status: "OFFLINE",
    reason: "Printer jam",
    mergeIntoCounterId: counterA.id,
  })
).data;
step(
  9,
  `Counter B offline, ${m.moved} tokens merged into Counter A (${m.strategy})`
);
mine = (await get(student, "queue.myActive", undefined)).entries.find(
  e => e.id === joined.entryId
);
step(
  10,
  `student now at ${mine.counter.name} (moved from ${mine.movedFrom}), position ${mine.position}, traffic ${mine.traffic.effectiveLevel}`
);
const lift = await login("staff.lift@queuesense.dev", "DevStaff#2026");
const stations = await get(lift, "camera.stations", undefined);
const rep = (
  await post(lift, "camera.report", {
    stationId: stations.stations[0].station.id,
    peopleCount: 14,
    rawDetections: 16,
  })
).data;
step(
  11,
  `camera station "${stations.stations[0].station.name}" reported 14 people → ${rep.trafficLevel}`
);
const admin = await login("admin@queuesense.dev", "DevAdmin#2026");
const ov = await get(admin, "admin.overview", undefined);
step(
  12,
  `admin overview: ${ov.live.waiting} waiting, ${ov.today.joined} tokens today, ${ov.live.countersOffline} counter(s) offline, ${ov.live.realtimeConnections} live connection(s)`
);
await new Promise(r => setTimeout(r, 800));
ctrl.abort();
console.log(`\nstudent SSE: ${events.length} events`);
console.log(
  `notifications pushed to student: ${events
    .filter(e => e.type === "notification.created")
    .map(e => e.notificationType)
    .join(", ")}`
);
console.log(
  `queue.changed events seen: ${events.filter(e => e.type === "queue.changed").length}`
);
