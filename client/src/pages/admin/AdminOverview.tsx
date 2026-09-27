import {
  Activity,
  CheckCircle2,
  Clock3,
  Database,
  Radio,
  Timer,
  Users,
  XCircle,
} from "lucide-react";
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
  MetricCard,
  PageHeader,
  ServiceIcon,
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

const COLORS = {
  joined: "#b9a3e6",
  completed: "#8757db",
  cancelled: "#e0a3ac",
  skipped: "#efc089",
};

export default function AdminOverview() {
  const { pollInterval, state } = useRealtime();
  const overview = trpc.admin.overview.useQuery(undefined, {
    refetchInterval: pollInterval || 60_000,
  });
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
        eyebrow="Administration"
        title="Campus overview"
        subtitle={`Live operational picture · updated ${relativeTime(o.generatedAt)}`}
      />
      <div className="admin-metrics">
        <MetricCard
          label="Waiting now"
          value={o.live.waiting}
          helper={`${o.live.inService} at counters · ${o.live.activeQueues} active queues`}
          icon={Users}
          accent="violet"
        />
        <MetricCard
          label="Counters"
          value={`${o.live.countersOpen} open`}
          helper={`${o.live.countersPaused} paused · ${o.live.countersOffline} offline`}
          icon={Activity}
          accent="blue"
        />
        <MetricCard
          label="Completed today"
          value={o.today.completed}
          helper={`${o.today.joined} tokens issued · ${o.today.priority} priority`}
          icon={CheckCircle2}
          accent="teal"
        />
        <MetricCard
          label="Avg. wait today"
          value={durationLabel(o.today.averageWaitSeconds)}
          helper={`service ${durationLabel(o.today.averageServiceSeconds)} on average`}
          icon={Clock3}
          accent="orange"
        />
      </div>
      <div className="admin-metrics">
        <MetricCard
          label="Students"
          value={o.people.students}
          helper={`${o.people.activeStudents} active · ${o.people.pendingStudents} not yet activated`}
          icon={Users}
          accent="violet"
        />
        <MetricCard
          label="Staff"
          value={o.people.staff}
          helper={`${o.people.admins} administrator${o.people.admins === 1 ? "" : "s"}`}
          icon={Users}
          accent="blue"
        />
        <MetricCard
          label="Cancelled / skipped"
          value={`${o.today.cancelled} / ${o.today.skipped}`}
          helper="today"
          icon={XCircle}
          accent="orange"
        />
        <MetricCard
          label="Live connections"
          value={o.live.realtimeConnections}
          helper={`this dashboard: ${state}`}
          icon={Radio}
          accent="teal"
        />
      </div>

      <div className="admin-grid">
        <section className="panel chart-panel" aria-labelledby="hourly-title">
          <div className="card-heading compact">
            <div>
              <div className="eyebrow">Today</div>
              <h3 id="hourly-title">Queue volume by hour</h3>
            </div>
          </div>
          <div
            className="chart-box"
            role="img"
            aria-label="Tokens issued and completed per hour today"
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourly}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#eee9f2"
                />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis
                  allowDecimals={false}
                  width={30}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="Joined"
                  fill={COLORS.joined}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="Completed"
                  fill={COLORS.completed}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel" aria-labelledby="health-title">
          <div className="card-heading compact">
            <div>
              <div className="eyebrow">System health</div>
              <h3 id="health-title">Operational status</h3>
            </div>
          </div>
          <dl className="status-list">
            <div>
              <dt>
                <Database size={14} aria-hidden /> Database
              </dt>
              <dd
                className={
                  health.data?.checks.database === "up"
                    ? "success-text"
                    : "danger-text"
                }
              >
                {health.isLoading
                  ? "Checking…"
                  : health.data
                    ? `${health.data.checks.database === "up" ? "Up" : "Down"} · ${health.data.checks.databaseLatencyMs} ms`
                    : "Unreachable"}
              </dd>
            </div>
            <div>
              <dt>
                <Radio size={14} aria-hidden /> Realtime (SSE)
              </dt>
              <dd className={state === "live" ? "success-text" : "danger-text"}>
                {state === "live" ? "Connected" : state}
              </dd>
            </div>
            <div>
              <dt>
                <Timer size={14} aria-hidden /> API uptime
              </dt>
              <dd>
                {health.data ? durationLabel(health.data.uptimeSeconds) : "—"}
              </dd>
            </div>
            {o.cameras.map(camera => (
              <div key={camera.id}>
                <dt>{camera.name}</dt>
                <dd className={camera.fresh ? "success-text" : "muted"}>
                  {!camera.isActive
                    ? "Inactive"
                    : camera.fresh
                      ? `${camera.lastPeopleCount ?? 0} people · ${relativeTime(camera.lastReportedAt)}`
                      : camera.lastReportedAt
                        ? `Stale · ${relativeTime(camera.lastReportedAt)}`
                        : "Never reported"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="panel" aria-labelledby="services-title">
        <div className="card-heading compact">
          <div>
            <div className="eyebrow">Services</div>
            <h3 id="services-title">Utilisation and outcomes today</h3>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Waiting</th>
                <th scope="col">Counters busy</th>
                <th scope="col">Issued</th>
                <th scope="col">Completed</th>
                <th scope="col">Cancelled / skipped</th>
                <th scope="col">Avg. wait</th>
                <th scope="col">Avg. service</th>
              </tr>
            </thead>
            <tbody>
              {o.byService.map(s => (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="cell-with-icon">
                      <ServiceIcon kind={s.kind} size={15} /> {s.name}
                    </span>
                  </th>
                  <td>{s.waiting}</td>
                  <td>
                    <span
                      className="util-bar"
                      aria-label={`${s.busyCounters} of ${s.openCounters} open counters busy`}
                    >
                      <span
                        style={{
                          width: `${s.openCounters ? (100 * s.busyCounters) / s.openCounters : 0}%`,
                        }}
                      />
                    </span>
                    {s.busyCounters}/{s.openCounters}{" "}
                    <small className="muted">({s.totalCounters} total)</small>
                  </td>
                  <td>{s.joinedToday}</td>
                  <td>{s.completedToday}</td>
                  <td>
                    {s.cancelledToday} / {s.skippedToday}
                  </td>
                  <td>{durationLabel(s.averageWaitSeconds)}</td>
                  <td>{durationLabel(s.averageServiceSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel chart-panel" aria-labelledby="week-title">
        <div className="card-heading compact">
          <div>
            <div className="eyebrow">Last 7 days</div>
            <h3 id="week-title">Outcomes by day</h3>
          </div>
        </div>
        <div
          className="chart-box"
          role="img"
          aria-label="Completed, cancelled and skipped tokens per day for the last week"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={volume}>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#eee9f2"
              />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} width={30} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar
                dataKey="Completed"
                stackId="a"
                fill={COLORS.completed}
                isAnimationActive={false}
              />
              <Bar
                dataKey="Cancelled"
                stackId="a"
                fill={COLORS.cancelled}
                isAnimationActive={false}
              />
              <Bar
                dataKey="Skipped"
                stackId="a"
                fill={COLORS.skipped}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
