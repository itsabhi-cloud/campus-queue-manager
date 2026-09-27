import { Link } from "wouter";
import { CameraOff, CheckCircle2, Gauge, Pause, PowerOff } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import {
  ErrorState,
  LoadingBlock,
  PageHeader,
  PanelHead,
  ServiceIcon,
  Stat,
  StatStrip,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { durationLabel, relativeTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";

type Health = {
  status: string;
  uptimeSeconds: number;
  checks: {
    database: string;
    databaseLatencyMs: number;
    realtime: { transport: string; connections: number };
  };
};

const CHART = {
  joined: "#b8c0d8",
  completed: "#1b2340",
  cancelled: "#b83b34",
  skipped: "#8a5300",
  axis: "#5a6283",
  grid: "#e9ecf2",
};

/** Things an operator should look at now, derived from live catalogue and camera data. */
function useAttention() {
  const { pollInterval } = useRealtime();
  const catalog = trpc.catalog.list.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  const items: Array<{
    key: string;
    icon: typeof Pause;
    title: string;
    detail: string;
    href: string;
  }> = [];
  catalog.data?.services.forEach(service =>
    service.groups.forEach(group => {
      group.counters.forEach(counter => {
        if (counter.status === "OPEN") return;
        items.push({
          key: `c${counter.id}`,
          icon: counter.status === "PAUSED" ? Pause : PowerOff,
          title: `${counter.name} is ${counter.status.toLowerCase()}`,
          detail: `${service.name}, ${group.name}. ${counter.statusReason ?? "No reason given"}${counter.waiting ? `. ${counter.waiting} still waiting` : ""}`,
          href: `/staff/${counter.id}`,
        });
      });
      if (group.traffic.effectiveLevel === "HEAVY") {
        items.push({
          key: `t${group.id}`,
          icon: Gauge,
          title: `Heavy traffic at ${group.name}`,
          detail: `${service.name}. ${group.traffic.reason ?? (group.traffic.effectiveLevel !== group.traffic.staffLevel ? "Raised by camera" : "Set by staff")}`,
          href: group.counters[0]
            ? `/staff/${group.counters[0].id}`
            : "/admin/queues",
        });
      }
      if (group.camera && !group.camera.fresh) {
        items.push({
          key: `cam${group.id}`,
          icon: CameraOff,
          title: `Camera offline for ${group.name}`,
          detail: `Last report ${relativeTime(group.camera.reportedAt)}. Estimates use queue data only.`,
          href: "/camera",
        });
      }
    })
  );
  return { items, loading: catalog.isLoading };
}

const ACTION_TEXT: Record<string, string> = {
  "queue.priority_assigned": "gave a token priority",
  "queue.priority_removed": "removed a token's priority",
  "queue.merged": "merged a counter's queue",
  "queue.traffic_updated": "changed traffic",
  "queue.token_cancelled": "cancelled a token",
  "counter.paused": "paused a counter",
  "counter.resumed": "reopened a counter",
  "counter.offline": "took a counter offline",
  "user.bulk_import": "imported students",
  "user.student_created": "added a student",
  "user.staff_created": "added a staff member",
  "user.suspended": "suspended an account",
  "user.enabled": "re-enabled an account",
  "assignment.changed": "changed counter assignments",
  "settings.updated": "changed settings",
};

function detailOf(metadata: Record<string, unknown>) {
  const parts: string[] = [];
  if (typeof metadata.tokenNumber === "string")
    parts.push(metadata.tokenNumber);
  if (typeof metadata.reason === "string" && metadata.reason)
    parts.push(metadata.reason);
  if (typeof metadata.moved === "number")
    parts.push(`${metadata.moved} tokens moved`);
  if (typeof metadata.created === "number")
    parts.push(`${metadata.created} created`);
  const to = metadata.to as { level?: string } | undefined;
  if (to?.level) parts.push(`now ${to.level.toLowerCase()}`);
  return parts.join(", ");
}

function RecentOperations() {
  const { pollInterval } = useRealtime();
  const logs = trpc.admin.audit.useQuery(
    { page: 1, pageSize: 10 },
    { refetchInterval: pollInterval || 30_000 }
  );
  return (
    <section className="panel" aria-labelledby="ops-title">
      <PanelHead
        id="ops-title"
        title="Recent operations"
        description="From the audit log."
        actions={
          <Link
            href="/admin/audit"
            className="button button-outline button-small"
          >
            Full log
          </Link>
        }
      />
      {logs.isLoading ? (
        <LoadingBlock rows={1} />
      ) : logs.error ? (
        <ErrorState
          message={errorMessage(logs.error)}
          onRetry={() => logs.refetch()}
        />
      ) : !logs.data || logs.data.rows.length === 0 ? (
        <p className="muted">No operations recorded yet.</p>
      ) : (
        <ul className="activity-list">
          {logs.data.rows.slice(0, 8).map(({ log, actorName }) => (
            <li key={log.id}>
              <div>
                <strong>{actorName ?? "System"}</strong>{" "}
                {ACTION_TEXT[log.action] ?? log.action.replace(/[._]/g, " ")}
                {detailOf(log.metadata) && (
                  <small>{detailOf(log.metadata)}</small>
                )}
              </div>
              <time dateTime={new Date(log.createdAt).toISOString()}>
                {relativeTime(log.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminOverview() {
  const { pollInterval, state } = useRealtime();
  const overview = trpc.admin.overview.useQuery(undefined, {
    refetchInterval: pollInterval || 60_000,
  });
  const attention = useAttention();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async (): Promise<Health> => (await fetch("/api/health")).json(),
    refetchInterval: 30_000,
  });
  if (overview.isLoading) return <LoadingBlock rows={4} />;
  if (overview.error)
    return (
      <ErrorState
        message={errorMessage(overview.error)}
        onRetry={() => overview.refetch()}
      />
    );
  const o = overview.data!;
  const hourly = o.hourly.map(h => ({
    hour: `${String(h.hour).padStart(2, "0")}:00`,
    Joined: h.joined,
    Completed: h.completed,
  }));
  const volume = o.volume.map(v => ({
    day: new Date(`${v.day}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
    }),
    Completed: v.completed,
    Cancelled: v.cancelled,
    Skipped: v.skipped,
  }));

  return (
    <>
      <PageHeader
        title="Campus overview"
        subtitle={`Live picture of every queue. Updated ${relativeTime(o.generatedAt)}.`}
      />

      <StatStrip label="Right now">
        <Stat
          label="Waiting now"
          value={o.live.waiting}
          helper={`${o.live.inService} at counters, ${o.live.activeQueues} active queues`}
        />
        <Stat
          label="Counters open"
          value={o.live.countersOpen}
          helper={`${o.live.countersPaused} paused, ${o.live.countersOffline} offline`}
        />
        <Stat
          label="Average wait today"
          value={durationLabel(o.today.averageWaitSeconds)}
          helper={`Service takes ${durationLabel(o.today.averageServiceSeconds)} on average`}
        />
        <Stat
          label="Completed today"
          value={o.today.completed}
          helper={`${o.today.joined} tokens issued, ${o.today.priority} with priority`}
        />
      </StatStrip>

      <div className="admin-grid">
        <section className="panel" aria-labelledby="attention-title">
          <PanelHead
            id="attention-title"
            title="Needs attention"
            description="Counters that aren't open, heavy traffic and cameras that stopped reporting."
          />
          {attention.loading ? (
            <LoadingBlock rows={1} />
          ) : attention.items.length === 0 ? (
            <p className="cell-with-icon success-text">
              <CheckCircle2 size={18} aria-hidden /> Everything is running
              normally.
            </p>
          ) : (
            <ul className="attention-list">
              {attention.items.map(item => {
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <Icon size={18} aria-hidden />
                    <div>
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </div>
                    <Link
                      href={item.href}
                      className="button button-outline button-small"
                    >
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <div className="console-main">
          <section className="panel" aria-labelledby="health-title">
            <PanelHead id="health-title" title="System health" />
            <dl className="status-list">
              <div>
                <dt>Database</dt>
                <dd
                  className={
                    health.data?.checks.database === "up"
                      ? "success-text"
                      : "danger-text"
                  }
                >
                  {health.isLoading
                    ? "Checking"
                    : health.data
                      ? `${health.data.checks.database === "up" ? "Up" : "Down"}, ${health.data.checks.databaseLatencyMs} ms`
                      : "Unreachable"}
                </dd>
              </div>
              <div>
                <dt>Live updates</dt>
                <dd
                  className={state === "live" ? "success-text" : "danger-text"}
                >
                  {state === "live"
                    ? `Connected, ${o.live.realtimeConnections} open`
                    : state}
                </dd>
              </div>
              <div>
                <dt>Server uptime</dt>
                <dd>
                  {health.data ? durationLabel(health.data.uptimeSeconds) : "–"}
                </dd>
              </div>
              <div>
                <dt>Accounts</dt>
                <dd>
                  {o.people.activeStudents} students active,{" "}
                  {o.people.pendingStudents} not activated
                </dd>
              </div>
              <div>
                <dt>Staff</dt>
                <dd>
                  {o.people.staff} staff, {o.people.admins} admin
                  {o.people.admins === 1 ? "" : "s"}
                </dd>
              </div>
            </dl>
          </section>
          <RecentOperations />
        </div>
      </div>

      <section className="panel" aria-labelledby="services-title">
        <PanelHead id="services-title" title="Services today" />
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Services today table"
        >
          <table className="data-table stack">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Waiting</th>
                <th scope="col">Open counters busy</th>
                <th scope="col">Issued</th>
                <th scope="col">Completed</th>
                <th scope="col">Cancelled, skipped</th>
                <th scope="col">Average wait</th>
                <th scope="col">Average service</th>
              </tr>
            </thead>
            <tbody>
              {o.byService.map(s => (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="cell-with-icon">
                      <ServiceIcon kind={s.kind} /> <strong>{s.name}</strong>
                    </span>
                  </th>
                  <td data-label="Waiting" className="num">
                    {s.waiting}
                  </td>
                  <td data-label="Open counters busy" className="nowrap">
                    <span className="util-bar" aria-hidden>
                      <span
                        style={{
                          width: `${s.openCounters ? (100 * s.busyCounters) / s.openCounters : 0}%`,
                        }}
                      />
                    </span>
                    <span className="num nowrap">
                      {s.busyCounters} of {s.openCounters}
                    </span>
                  </td>
                  <td data-label="Issued" className="num">
                    {s.joinedToday}
                  </td>
                  <td data-label="Completed" className="num">
                    {s.completedToday}
                  </td>
                  <td data-label="Cancelled, skipped" className="num">
                    {s.cancelledToday}, {s.skippedToday}
                  </td>
                  <td data-label="Average wait">
                    {durationLabel(s.averageWaitSeconds)}
                  </td>
                  <td data-label="Average service">
                    {durationLabel(s.averageServiceSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="admin-grid mt-4">
        <section className="panel" aria-labelledby="hourly-title">
          <PanelHead id="hourly-title" title="Tokens by hour today" as="h3" />
          <div
            className="chart-box"
            role="img"
            aria-label={`Tokens issued and completed per hour today. ${hourly.map(h => `${h.hour}: ${h.Joined} issued, ${h.Completed} completed`).join("; ")}`}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourly}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 12, fill: CHART.axis }}
                />
                <YAxis
                  allowDecimals={false}
                  width={30}
                  tick={{ fontSize: 12, fill: CHART.axis }}
                />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="Joined"
                  name="Issued"
                  fill={CHART.joined}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Completed"
                  fill={CHART.completed}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel" aria-labelledby="week-title">
          <PanelHead id="week-title" title="Outcomes, last 7 days" as="h3" />
          <div
            className="chart-box"
            role="img"
            aria-label={`Outcomes per day. ${volume.map(v => `${v.day}: ${v.Completed} completed, ${v.Cancelled} cancelled, ${v.Skipped} skipped`).join("; ")}`}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={volume}>
                <CartesianGrid vertical={false} stroke={CHART.grid} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 12, fill: CHART.axis }}
                />
                <YAxis
                  allowDecimals={false}
                  width={30}
                  tick={{ fontSize: 12, fill: CHART.axis }}
                />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="Completed"
                  stackId="a"
                  fill={CHART.completed}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Cancelled"
                  stackId="a"
                  fill={CHART.cancelled}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Skipped"
                  stackId="a"
                  fill={CHART.skipped}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </>
  );
}
