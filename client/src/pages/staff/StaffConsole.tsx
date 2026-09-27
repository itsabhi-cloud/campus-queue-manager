import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  BellRing,
  Check,
  CheckCircle2,
  Clock3,
  FastForward,
  GitMerge,
  Gauge,
  Pause,
  Play,
  PowerOff,
  SkipForward,
  Star,
  StarOff,
  Ticket,
  Users,
  XCircle,
} from "lucide-react";
import {
  MERGE_STRATEGIES,
  TRAFFIC_LEVELS,
  type MergeStrategy,
  type TrafficLevel,
} from "@shared/domain";
import { CameraSignal } from "@/components/queue/ActiveTokenCard";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import {
  CounterBadge,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  MetricCard,
  PageHeader,
  ServiceIcon,
  StatusBadge,
  TokenNumber,
  TrafficBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import {
  approxMinutes,
  durationLabel,
  relativeTime,
  TRAFFIC_LABEL,
} from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";

type Board = RouterOutputs["staff"]["board"];
type Waiting = Board["waiting"][number];

const STRATEGY_LABEL: Record<MergeStrategy, string> = {
  ALTERNATE: "Alternate (A1, B1, A2, B2…)",
  JOIN_TIME: "By original join time",
  APPEND: "Append after this counter's line",
};

function useStaffMutations(counterId: number) {
  const utils = trpc.useUtils();
  const onError = (error: unknown) => toast.error(errorMessage(error));
  const done = (message?: string) => {
    if (message) toast.success(message);
    void utils.staff.board.invalidate({ counterId });
    void utils.staff.myCounters.invalidate();
  };
  const tokens = (d: { updated: Array<{ tokenNumber: string }> }) =>
    d.updated.map(u => u.tokenNumber).join(", ");
  return {
    callNext: trpc.staff.callNext.useMutation({
      onSuccess: d =>
        done(`Called ${d.called.map(c => c.tokenNumber).join(", ")}`),
      onError,
    }),
    serve: trpc.staff.serve.useMutation({ onSuccess: () => done(), onError }),
    complete: trpc.staff.complete.useMutation({
      onSuccess: d => done(`Completed ${tokens(d)}`),
      onError,
    }),
    skip: trpc.staff.skip.useMutation({
      onSuccess: d => done(`Skipped ${tokens(d)}`),
      onError,
    }),
    cancel: trpc.staff.cancel.useMutation({
      onSuccess: d => done(`Cancelled ${tokens(d)}`),
      onError,
    }),
    status: trpc.staff.setCounterStatus.useMutation({
      onSuccess: d =>
        done(
          d.moved
            ? `Counter offline · ${d.moved} token(s) merged`
            : "Counter updated"
        ),
      onError,
    }),
    traffic: trpc.staff.setTraffic.useMutation({
      onSuccess: () => done("Traffic updated — estimates recalculated"),
      onError,
    }),
    priority: trpc.staff.setPriority.useMutation({
      onSuccess: d =>
        done(`${d.tokenNumber} is now position ${d.newPosition ?? "—"}`),
      onError,
    }),
  };
}

type Dialogs =
  | { kind: "none" }
  | { kind: "skip" | "cancel"; entryIds: number[]; label: string }
  | { kind: "priority"; entry: Waiting; enable: boolean }
  | { kind: "pause" }
  | { kind: "offline" }
  | { kind: "traffic" };

function TrafficDialog({
  board,
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  board: Board;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (v: {
    level: TrafficLevel;
    delaySeconds: number;
    reason?: string;
  }) => void;
  busy: boolean;
}) {
  const [level, setLevel] = useState<TrafficLevel>(board.traffic.staffLevel);
  const [delay, setDelay] = useState(
    Math.round(board.traffic.delaySeconds / 60)
  );
  const [reason, setReason] = useState(board.traffic.reason ?? "");
  useEffect(() => {
    if (open) {
      setLevel(board.traffic.staffLevel);
      setDelay(Math.round(board.traffic.delaySeconds / 60));
      setReason(board.traffic.reason ?? "");
    }
  }, [open, board.traffic]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Traffic · ${board.group.name}`}
      description="Applies to every counter in this queue. Estimates are recalculated, and students whose wait changes noticeably are told why."
      footer={
        <>
          <button
            className="button button-outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() =>
              onSubmit({
                level,
                delaySeconds: delay * 60,
                reason: reason.trim() || undefined,
              })
            }
          >
            {busy ? "Saving…" : "Update traffic"}
          </button>
        </>
      }
    >
      <fieldset className="segmented" aria-label="Traffic level">
        {TRAFFIC_LEVELS.map(value => (
          <label key={value} className={level === value ? "selected" : ""}>
            <input
              type="radio"
              name="traffic"
              checked={level === value}
              onChange={() => setLevel(value)}
            />
            {TRAFFIC_LABEL[value]}
            <small>
              {value === "NORMAL"
                ? "×1.0"
                : value === "MODERATE"
                  ? "×1.25"
                  : "×1.5"}
            </small>
          </label>
        ))}
      </fieldset>
      <Field
        label="Additional delay (minutes)"
        htmlFor="delay"
        hint="Added once to every waiting estimate, e.g. a system outage"
      >
        <input
          id="delay"
          type="number"
          min={0}
          max={60}
          value={delay}
          onChange={e =>
            setDelay(Math.max(0, Math.min(60, Number(e.target.value) || 0)))
          }
        />
      </Field>
      <Field
        label="Reason (shown to students)"
        htmlFor="traffic-reason"
        hint="e.g. Lunch rush"
      >
        <input
          id="traffic-reason"
          maxLength={200}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </Field>
    </Dialog>
  );
}

function OfflineDialog({
  board,
  open,
  onOpenChange,
  onSubmit,
  busy,
}: {
  board: Board;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (v: {
    reason: string;
    mergeIntoCounterId?: number;
    strategy?: MergeStrategy;
  }) => void;
  busy: boolean;
}) {
  const targets = board.siblings.filter(s => s.status !== "OFFLINE");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<number | "">("");
  const [strategy, setStrategy] = useState<MergeStrategy>(
    board.group.mergeStrategy
  );
  useEffect(() => {
    if (open) {
      setReason("");
      setTarget(targets[0]?.id ?? "");
      setStrategy(board.group.mergeStrategy);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = board.waiting.length;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Take ${board.counter.name} offline`}
      description={
        waiting
          ? `${waiting} token(s) are waiting here. Merge them into another counter so nobody loses their place — queue history is preserved.`
          : "No one is waiting here right now."
      }
      footer={
        <>
          <button
            className="button button-outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            className="button button-danger-solid"
            disabled={busy || reason.trim().length < 3}
            onClick={() =>
              onSubmit({
                reason: reason.trim(),
                mergeIntoCounterId: target === "" ? undefined : target,
                strategy,
              })
            }
          >
            {busy
              ? "Working…"
              : target === ""
                ? "Mark offline"
                : "Mark offline & merge"}
          </button>
        </>
      }
    >
      <Field
        label="Reason"
        htmlFor="offline-reason"
        hint="Required · shown to affected students"
      >
        <input
          id="offline-reason"
          maxLength={200}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Printer jam"
        />
      </Field>
      {targets.length > 0 && (
        <>
          <Field label="Move waiting tokens to" htmlFor="merge-target">
            <select
              id="merge-target"
              value={target}
              onChange={e =>
                setTarget(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">Don't merge — keep them waiting here</option>
              {targets.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.waiting} waiting
                  {s.status === "PAUSED" ? ", paused" : ""})
                </option>
              ))}
            </select>
          </Field>
          {target !== "" && (
            <Field label="Merge order" htmlFor="merge-strategy">
              <select
                id="merge-strategy"
                value={strategy}
                onChange={e => setStrategy(e.target.value as MergeStrategy)}
              >
                {MERGE_STRATEGIES.map(s => (
                  <option key={s} value={s}>
                    {STRATEGY_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
    </Dialog>
  );
}

function CounterBoard({ counterId }: { counterId: number }) {
  const { pollInterval } = useRealtime();
  const board = trpc.staff.board.useQuery(
    { counterId },
    { refetchInterval: pollInterval || 30_000 }
  );
  const m = useStaffMutations(counterId);
  const [dialog, setDialog] = useState<Dialogs>({ kind: "none" });
  const close = () => setDialog({ kind: "none" });

  if (board.isLoading) return <LoadingBlock rows={4} />;
  if (board.error)
    return (
      <ErrorState
        message={errorMessage(board.error)}
        onRetry={() => board.refetch()}
      />
    );
  const b = board.data!;
  const called = b.inProgress.filter(e => e.status === "CALLED");
  const serving = b.inProgress.filter(e => e.status === "SERVING");
  const open = b.counter.status === "OPEN";
  const atCapacity = b.inProgress.length >= b.group.serveCapacity;
  const batch = b.group.serveCapacity > 1;
  const busy = Object.values(m).some(mutation => mutation.isPending);

  return (
    <>
      <div className="staff-toolbar">
        <div className="staff-toolbar-title">
          <ServiceIcon kind={b.service.kind} />
          <div>
            <strong>{b.counter.name}</strong>
            <small>
              {b.service.name} · {b.group.name} · prefix {b.counter.tokenPrefix}
            </small>
          </div>
        </div>
        <div className="staff-toolbar-status">
          <CounterBadge status={b.counter.status} />
          {b.counter.statusReason && b.counter.status !== "OPEN" && (
            <span className="muted">{b.counter.statusReason}</span>
          )}
        </div>
      </div>
      {b.counter.mergedIntoCounterId && (
        <div className="callout callout-orange" role="status">
          <GitMerge size={18} aria-hidden />
          <span>
            This counter's queue was merged into{" "}
            {b.siblings.find(s => s.id === b.counter.mergedIntoCounterId)
              ?.name ?? "another counter"}
            . Reopening it accepts new tokens here; merged tokens stay where
            they are.
          </span>
        </div>
      )}

      <div className="staff-layout">
        <section className="staff-main-card" aria-labelledby="now-serving">
          <div className="card-heading">
            <div>
              <div className="eyebrow">Now serving</div>
              <h2 id="now-serving">
                {batch ? "Current batch" : "Current token"}
              </h2>
            </div>
            <span className="muted">
              {batch ? `Capacity ${b.group.serveCapacity}` : null}
            </span>
          </div>
          <div
            className={`current-token-stage ${called.length ? "is-called" : ""}`}
          >
            <div className="stage-glow" aria-hidden />
            {b.inProgress.length === 0 ? (
              <div className="no-active-token">
                <Ticket size={29} aria-hidden />
                <strong>No active token</strong>
                <span>
                  {b.waiting.length
                    ? "Call the next person when ready."
                    : "No one is waiting."}
                </span>
              </div>
            ) : (
              <div className="in-progress-list">
                {b.inProgress.map(entry => (
                  <div key={entry.id} className="in-progress-item">
                    <TokenNumber token={entry.tokenNumber} large={!batch} />
                    <StatusBadge status={entry.status} />
                    <small>
                      {entry.holderName}
                      {entry.holderCollegeId
                        ? ` · ${entry.holderCollegeId}`
                        : ""}{" "}
                      ·{" "}
                      {entry.status === "CALLED"
                        ? `called ${relativeTime(entry.calledAt)}`
                        : `serving ${relativeTime(entry.servingAt)}`}
                    </small>
                    {entry.status === "CALLED" && (
                      <span className="called-prompt">
                        <BellRing size={13} aria-hidden /> Student notified
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="control-grid">
            <button
              className="button button-primary"
              onClick={() => m.callNext.mutate({ counterId })}
              disabled={busy || !open || atCapacity || b.waiting.length === 0}
              title={!open ? "Resume the counter to call tokens" : undefined}
            >
              <SkipForward size={17} aria-hidden />{" "}
              {batch ? "Call next batch" : "Call next"}
            </button>
            <button
              className="button button-dark"
              onClick={() =>
                m.serve.mutate({ entryIds: called.map(e => e.id) })
              }
              disabled={busy || called.length === 0}
            >
              <Play size={16} aria-hidden />{" "}
              {batch ? "Start boarding" : "Start serving"}
            </button>
            <button
              className="button button-success"
              onClick={() =>
                m.complete.mutate({ entryIds: serving.map(e => e.id) })
              }
              disabled={busy || serving.length === 0}
            >
              <Check size={17} aria-hidden /> {batch ? "Boarded" : "Complete"}
            </button>
            <button
              className="button button-outline button-danger"
              onClick={() =>
                setDialog({
                  kind: "skip",
                  entryIds: called.map(e => e.id),
                  label: called.map(e => e.tokenNumber).join(", "),
                })
              }
              disabled={busy || called.length === 0}
            >
              <FastForward size={16} aria-hidden /> Skip no-show
            </button>
          </div>
          {b.inProgress.length > 0 && (
            <button
              className="text-button danger"
              onClick={() =>
                setDialog({
                  kind: "cancel",
                  entryIds: b.inProgress.map(e => e.id),
                  label: b.inProgress.map(e => e.tokenNumber).join(", "),
                })
              }
            >
              <XCircle size={14} aria-hidden /> Cancel current{" "}
              {batch ? "batch" : "token"}…
            </button>
          )}

          <div className="counter-controls">
            <div>
              <strong>Counter</strong>
              <small>
                {open
                  ? "Accepting new tokens"
                  : b.counter.status === "PAUSED"
                    ? "Paused — places are kept, no new tokens"
                    : "Offline — not accepting tokens"}
              </small>
            </div>
            <div className="counter-control-buttons">
              {open ? (
                <button
                  className="button button-outline button-small"
                  onClick={() => setDialog({ kind: "pause" })}
                  disabled={busy}
                >
                  <Pause size={14} aria-hidden /> Pause
                </button>
              ) : (
                <button
                  className="button button-warning button-small"
                  onClick={() => m.status.mutate({ counterId, status: "OPEN" })}
                  disabled={busy}
                >
                  <Play size={14} aria-hidden /> Resume
                </button>
              )}
              {b.counter.status !== "OFFLINE" && (
                <button
                  className="button button-outline button-small button-danger"
                  onClick={() => setDialog({ kind: "offline" })}
                  disabled={busy}
                >
                  <PowerOff size={14} aria-hidden /> Mark offline
                </button>
              )}
            </div>
          </div>

          <div className="counter-controls">
            <div>
              <strong>
                Traffic ·{" "}
                <TrafficBadge
                  level={b.traffic.effectiveLevel}
                  label={
                    b.traffic.effectiveLevel !== b.traffic.staffLevel
                      ? "Effective"
                      : "Level"
                  }
                />
              </strong>
              <small>
                {b.traffic.delaySeconds
                  ? `+${Math.round(b.traffic.delaySeconds / 60)} min delay · `
                  : ""}
                {b.traffic.reason ?? "No reason set"} ·{" "}
                {Math.round(b.traffic.serviceSeconds / 6) / 10} min per{" "}
                {b.group.serveCapacity > 1 ? "cycle" : "person"}
                {b.traffic.effectiveLevel !== b.traffic.staffLevel
                  ? ` · raised by camera (staff: ${TRAFFIC_LABEL[b.traffic.staffLevel]})`
                  : ""}
              </small>
              <CameraSignal camera={b.camera} />
            </div>
            <button
              className="button button-outline button-small"
              onClick={() => setDialog({ kind: "traffic" })}
              disabled={busy}
            >
              <Gauge size={14} aria-hidden /> Adjust
            </button>
          </div>
        </section>

        <aside className="staff-side-column">
          <section
            className="queue-list-card"
            aria-labelledby="waiting-heading"
          >
            <div className="card-heading compact">
              <div>
                <div className="eyebrow">Up next</div>
                <h3 id="waiting-heading">Waiting line</h3>
              </div>
              <span
                className="count-badge"
                aria-label={`${b.waiting.length} waiting`}
              >
                {b.waiting.length}
              </span>
            </div>
            {b.waiting.length === 0 ? (
              <div className="compact-empty">
                <CheckCircle2 size={22} aria-hidden />
                <span>No one is waiting</span>
              </div>
            ) : (
              <ol className="waiting-list">
                {b.waiting.map(entry => (
                  <li
                    key={entry.id}
                    className={entry.isPriority ? "is-priority" : ""}
                  >
                    <span className="queue-rank">
                      {String(entry.position).padStart(2, "0")}
                    </span>
                    <div className="waiting-main">
                      <TokenNumber token={entry.tokenNumber} />
                      <small>
                        {entry.isPriority ? (
                          <span className="priority-pill">
                            Priority · {entry.priorityReason}
                          </span>
                        ) : (
                          <>joined {relativeTime(entry.joinedAt)}</>
                        )}
                        {entry.movedFrom ? ` · from ${entry.movedFrom}` : ""}
                      </small>
                    </div>
                    <span className="clock-label">
                      <Clock3 size={13} aria-hidden />{" "}
                      {approxMinutes(entry.estimatedWaitSeconds)}
                    </span>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        title={
                          entry.isPriority ? "Remove priority" : "Give priority"
                        }
                        aria-label={`${entry.isPriority ? "Remove priority from" : "Give priority to"} ${entry.tokenNumber}`}
                        onClick={() =>
                          setDialog({
                            kind: "priority",
                            entry,
                            enable: !entry.isPriority,
                          })
                        }
                      >
                        {entry.isPriority ? (
                          <StarOff size={15} />
                        ) : (
                          <Star size={15} />
                        )}
                      </button>
                      <button
                        className="icon-btn"
                        title="Cancel token"
                        aria-label={`Cancel ${entry.tokenNumber}`}
                        onClick={() =>
                          setDialog({
                            kind: "cancel",
                            entryIds: [entry.id],
                            label: entry.tokenNumber,
                          })
                        }
                      >
                        <XCircle size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div className="queue-card-footer">
              <span>
                <Users size={14} aria-hidden /> Limit {b.group.maxWaiting}
              </span>
              <span className="estimated-text">
                {b.waiting.length
                  ? `Last in line ~${approxMinutes(b.waiting[b.waiting.length - 1].estimatedWaitSeconds)}`
                  : ""}
              </span>
            </div>
          </section>

          <section className="activity-card" aria-labelledby="activity-heading">
            <div className="card-heading compact">
              <div>
                <div className="eyebrow">Activity</div>
                <h3 id="activity-heading">Recent events</h3>
              </div>
            </div>
            {b.recentEvents.length === 0 ? (
              <div className="compact-empty">No events yet today</div>
            ) : (
              <ul className="activity-list">
                {b.recentEvents.map(event => (
                  <li className="activity-row" key={event.id}>
                    <span
                      className={`activity-icon activity-${(event.toStatus ?? event.type).toLowerCase()}`}
                      aria-hidden
                    >
                      {event.type === "COMPLETED" ? (
                        <CheckCircle2 size={14} />
                      ) : event.type === "SKIPPED" ? (
                        <SkipForward size={14} />
                      ) : event.type.startsWith("PRIORITY") ? (
                        <Star size={14} />
                      ) : (
                        <Ticket size={14} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {event.tokenNumber ?? b.counter.name}{" "}
                        <span>
                          {event.type.toLowerCase().replace(/_/g, " ")}
                        </span>
                      </strong>
                      {event.reason && <small>{event.reason}</small>}
                    </div>
                    <time dateTime={new Date(event.createdAt).toISOString()}>
                      {relativeTime(event.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <div className="staff-metrics">
        <MetricCard
          label="Waiting now"
          value={b.waiting.length}
          helper={`${b.inProgress.length} at the counter`}
          icon={Users}
          accent="violet"
        />
        <MetricCard
          label="Completed today"
          value={b.today.completed}
          helper={`${b.today.joined} tokens issued today`}
          icon={CheckCircle2}
          accent="teal"
        />
        <MetricCard
          label="Avg. service today"
          value={durationLabel(b.today.averageServiceSeconds)}
          helper={`Configured ${durationLabel(b.traffic.configuredSeconds)}`}
          icon={Clock3}
          accent="orange"
        />
        <MetricCard
          label="Skipped / cancelled"
          value={`${b.today.skipped} / ${b.today.cancelled}`}
          helper="today at this counter"
          icon={FastForward}
          accent="blue"
        />
      </div>

      <ConfirmDialog
        open={dialog.kind === "skip"}
        onOpenChange={close}
        title={dialog.kind === "skip" ? `Skip ${dialog.label}?` : ""}
        description="Use this when the student didn't come to the counter. They'll be notified and can take a new token."
        confirmLabel="Skip"
        tone="dark"
        reason={{ label: "Reason", placeholder: "No-show after 3 minutes" }}
        busy={m.skip.isPending}
        onConfirm={reason =>
          dialog.kind === "skip" &&
          m.skip.mutate(
            { entryIds: dialog.entryIds, reason: reason || undefined },
            { onSuccess: close }
          )
        }
      />
      <ConfirmDialog
        open={dialog.kind === "cancel"}
        onOpenChange={close}
        title={dialog.kind === "cancel" ? `Cancel ${dialog.label}?` : ""}
        description="The student is notified with your reason. This can't be undone."
        confirmLabel="Cancel token"
        tone="danger"
        reason={{
          label: "Reason",
          required: true,
          placeholder: "e.g. Documents missing — please rejoin with them",
        }}
        busy={m.cancel.isPending}
        onConfirm={reason =>
          dialog.kind === "cancel" &&
          m.cancel.mutate(
            { entryIds: dialog.entryIds, reason },
            { onSuccess: close }
          )
        }
      />
      <ConfirmDialog
        open={dialog.kind === "priority"}
        onOpenChange={close}
        title={
          dialog.kind === "priority"
            ? dialog.enable
              ? `Give ${dialog.entry.tokenNumber} priority?`
              : `Remove priority from ${dialog.entry.tokenNumber}?`
            : ""
        }
        description={
          dialog.kind === "priority" && dialog.enable
            ? "The token moves ahead of non-priority tokens. Everyone whose position changes is notified, and the change is audited."
            : "The token returns to its normal place in line. Affected students are notified."
        }
        confirmLabel={
          dialog.kind === "priority" && dialog.enable
            ? "Give priority"
            : "Remove priority"
        }
        reason={{
          label: "Operational reason",
          required: true,
          placeholder: "e.g. Medical appointment, accessibility need",
        }}
        busy={m.priority.isPending}
        onConfirm={reason =>
          dialog.kind === "priority" &&
          m.priority.mutate(
            { entryId: dialog.entry.id, enabled: dialog.enable, reason },
            { onSuccess: close }
          )
        }
      />
      <ConfirmDialog
        open={dialog.kind === "pause"}
        onOpenChange={close}
        title={`Pause ${b.counter.name}?`}
        description="Waiting students keep their places and are notified. No new tokens are issued here until you resume."
        confirmLabel="Pause counter"
        tone="dark"
        reason={{
          label: "Reason",
          placeholder: "e.g. Shift change, back in 10 minutes",
        }}
        busy={m.status.isPending}
        onConfirm={reason =>
          m.status.mutate(
            { counterId, status: "PAUSED", reason: reason || undefined },
            { onSuccess: close }
          )
        }
      />
      <OfflineDialog
        board={b}
        open={dialog.kind === "offline"}
        onOpenChange={v => !v && close()}
        busy={m.status.isPending}
        onSubmit={v =>
          m.status.mutate(
            { counterId, status: "OFFLINE", ...v },
            { onSuccess: close }
          )
        }
      />
      <TrafficDialog
        board={b}
        open={dialog.kind === "traffic"}
        onOpenChange={v => !v && close()}
        busy={m.traffic.isPending}
        onSubmit={v =>
          m.traffic.mutate(
            { queueGroupId: b.group.id, ...v },
            { onSuccess: close }
          )
        }
      />
    </>
  );
}

export default function StaffConsole({ counterId }: { counterId?: string }) {
  const [, navigate] = useLocation();
  const counters = trpc.staff.myCounters.useQuery();
  const id = counterId ? Number(counterId) : null;

  useEffect(() => {
    if (!id && counters.data?.length === 1)
      navigate(`/staff/${counters.data[0].id}`, { replace: true });
  }, [id, counters.data, navigate]);

  if (counters.isLoading) return <LoadingBlock rows={3} />;
  if (counters.error)
    return (
      <ErrorState
        message={errorMessage(counters.error)}
        onRetry={() => counters.refetch()}
      />
    );
  const list = counters.data!;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Counter console"
        subtitle="One clear action at a time. Every change is pushed to students instantly."
        actions={
          list.length > 1 && (
            <label className="counter-switcher">
              <span className="sr-only">Switch counter</span>
              <select
                value={id ?? ""}
                onChange={e => navigate(`/staff/${e.target.value}`)}
              >
                <option value="" disabled>
                  Choose a counter…
                </option>
                {list.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.serviceName} · {c.groupName} · {c.name}
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />
      {list.length === 0 ? (
        <div className="panel">
          <EmptyState
            title="No counters assigned"
            description="An administrator assigns counters to staff accounts. Ask them to add you to the counters you operate."
          />
        </div>
      ) : id && list.some(c => c.id === id) ? (
        <CounterBoard key={id} counterId={id} />
      ) : (
        <div className="counter-picker">
          {list.map(c => (
            <Link key={c.id} href={`/staff/${c.id}`} className="service-card">
              <div className="service-card-head">
                <ServiceIcon kind={c.serviceKind} />
                <CounterBadge status={c.status} />
              </div>
              <h3>{c.name}</h3>
              <p>
                {c.serviceName} · {c.groupName}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
