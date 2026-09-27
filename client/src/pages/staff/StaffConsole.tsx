import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  FastForward,
  GitMerge,
  Gauge,
  Pause,
  Play,
  PowerOff,
  SkipForward,
  Star,
  StarOff,
  XCircle,
} from "lucide-react";
import {
  MERGE_STRATEGIES,
  TRAFFIC_LEVELS,
  type MergeStrategy,
  type TrafficLevel,
} from "@shared/domain";
import { CameraSignal } from "@/components/queue/CameraSignal";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import {
  CounterBadge,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  Note,
  PageHeader,
  PanelHead,
  ServiceIcon,
  Stat,
  StatStrip,
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

const EVENT_TEXT: Record<string, string> = {
  JOINED: "joined",
  CALLED: "called",
  SERVING: "being served",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
  PRIORITY_ASSIGNED: "given priority",
  PRIORITY_REMOVED: "priority removed",
  MERGED: "moved here",
  COUNTER_STATUS: "status changed",
};

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

function NowServing({ board }: { board: Board }) {
  const batch = board.group.serveCapacity > 1;
  return (
    <section className="board" aria-labelledby="now-serving">
      <div className="board-label">
        <h2 id="now-serving">Now serving</h2>
        {batch && <span>Up to {board.group.serveCapacity} per trip</span>}
      </div>
      {board.inProgress.length === 0 ? (
        <div className="board-empty">
          <strong>Nobody at the counter</strong>
          {board.waiting.length
            ? `${board.waiting.length} waiting. Call the next token when you're ready.`
            : "Nobody is waiting."}
        </div>
      ) : (
        <div className={`board-tokens ${batch ? "is-batch" : ""}`}>
          {board.inProgress.map(entry => (
            <div
              key={entry.id}
              className={`board-token ${entry.status === "CALLED" ? "is-called" : ""}`}
            >
              <span className="display">{entry.tokenNumber}</span>
              <small>
                {entry.status === "CALLED"
                  ? `Called ${relativeTime(entry.calledAt)}, student notified`
                  : `Serving since ${relativeTime(entry.servingAt)}`}
              </small>
              <small>
                {entry.holderName}
                {entry.holderCollegeId ? `, ${entry.holderCollegeId}` : ""}
              </small>
            </div>
          ))}
        </div>
      )}
    </section>
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
  const callBlocker = !open
    ? "Resume the counter to call tokens."
    : atCapacity
      ? batch
        ? "The current trip is full."
        : "Finish the current token first."
      : b.waiting.length === 0
        ? "Nobody is waiting."
        : null;

  return (
    <>
      <div className="console-head">
        <div className="cell-with-icon">
          <ServiceIcon kind={b.service.kind} large />
          <div>
            <h2>{b.counter.name}</h2>
            <small>
              {b.service.name}, {b.group.name}. Tokens start with{" "}
              {b.counter.tokenPrefix}
            </small>
          </div>
        </div>
        <CounterBadge status={b.counter.status} />
      </div>
      {b.counter.mergedIntoCounterId && (
        <Note tone="warn" icon={GitMerge}>
          This counter's line was moved to{" "}
          {b.siblings.find(s => s.id === b.counter.mergedIntoCounterId)?.name ??
            "another counter"}
          . Reopening it takes new tokens here; moved tokens stay where they
          are.
        </Note>
      )}

      <div className="console">
        <div className="console-main">
          <NowServing board={b} />
          <div className="console-actions">
            <button
              className="button button-primary button-large"
              onClick={() => m.callNext.mutate({ counterId })}
              disabled={busy || Boolean(callBlocker)}
              aria-describedby="call-blocker"
            >
              <SkipForward size={20} aria-hidden />{" "}
              {batch ? "Call next trip" : "Call next"}
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
              className="button button-outline"
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
          {callBlocker && (
            <p className="fine-print mt-0" id="call-blocker">
              {callBlocker}
            </p>
          )}
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
              <XCircle size={15} aria-hidden /> Cancel{" "}
              {batch ? "this trip" : "this token"}
            </button>
          )}

          <section
            className="panel console-settings"
            aria-label="Counter settings"
          >
            <div className="setting-row">
              <div>
                <strong>Counter</strong>
                <small>
                  {open
                    ? "Taking new tokens"
                    : b.counter.status === "PAUSED"
                      ? `Paused${b.counter.statusReason ? `: ${b.counter.statusReason}` : ""}. Places are kept.`
                      : `Offline${b.counter.statusReason ? `: ${b.counter.statusReason}` : ""}.`}
                </small>
              </div>
              <div className="setting-row-actions">
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
                    onClick={() =>
                      m.status.mutate({ counterId, status: "OPEN" })
                    }
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
                    <PowerOff size={14} aria-hidden /> Take offline
                  </button>
                )}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <strong>
                  <TrafficBadge level={b.traffic.effectiveLevel} />
                </strong>
                <small>
                  {b.traffic.delaySeconds
                    ? `+${Math.round(b.traffic.delaySeconds / 60)} min delay. `
                    : ""}
                  {b.traffic.reason ? `${b.traffic.reason}. ` : ""}
                  About {Math.round(b.traffic.serviceSeconds / 6) / 10} min per{" "}
                  {batch ? "trip" : "person"}.
                  {b.traffic.effectiveLevel !== b.traffic.staffLevel
                    ? ` Raised by the camera (you set ${TRAFFIC_LABEL[b.traffic.staffLevel].toLowerCase()}).`
                    : ""}
                </small>
                <CameraSignal camera={b.camera} />
              </div>
              <button
                className="button button-outline button-small"
                onClick={() => setDialog({ kind: "traffic" })}
                disabled={busy}
              >
                <Gauge size={14} aria-hidden /> Adjust traffic
              </button>
            </div>
          </section>
        </div>

        <aside className="console-main">
          <section className="panel" aria-labelledby="waiting-heading">
            <PanelHead
              id="waiting-heading"
              title={`Waiting (${b.waiting.length})`}
              description={
                b.waiting.length
                  ? `Last in line waits ${approxMinutes(b.waiting[b.waiting.length - 1].estimatedWaitSeconds)}. Limit ${b.group.maxWaiting}.`
                  : `Limit ${b.group.maxWaiting}.`
              }
            />
            {b.waiting.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nobody is waiting"
                description="New tokens appear here instantly."
              />
            ) : (
              <ol className="waiting-list">
                {b.waiting.map(entry => (
                  <li
                    key={entry.id}
                    className={entry.isPriority ? "is-priority" : ""}
                  >
                    <span
                      className="waiting-pos"
                      aria-label={`Position ${entry.position}`}
                    >
                      {entry.position}
                    </span>
                    <div className="waiting-main">
                      <span className="display">{entry.tokenNumber}</span>
                      <small>
                        {entry.isPriority
                          ? `Priority: ${entry.priorityReason}`
                          : `Joined ${relativeTime(entry.joinedAt)}`}
                        {entry.movedFrom ? `. From ${entry.movedFrom}` : ""}
                      </small>
                    </div>
                    <span className="waiting-est num">
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
                          <StarOff size={16} />
                        ) : (
                          <Star size={16} />
                        )}
                      </button>
                      <button
                        className="icon-btn danger"
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
                        <XCircle size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel" aria-labelledby="activity-heading">
            <PanelHead id="activity-heading" title="Recent activity" as="h3" />
            {b.recentEvents.length === 0 ? (
              <p className="muted">Nothing yet today.</p>
            ) : (
              <ul className="activity-list">
                {b.recentEvents.map(event => (
                  <li key={event.id}>
                    <div>
                      <strong>{event.tokenNumber ?? b.counter.name}</strong>{" "}
                      {EVENT_TEXT[event.type] ??
                        event.type.toLowerCase().replace(/_/g, " ")}
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

      <StatStrip label="Today at this counter">
        <Stat
          label="Waiting now"
          value={b.waiting.length}
          helper={`${b.inProgress.length} at the counter`}
        />
        <Stat
          label="Completed today"
          value={b.today.completed}
          helper={`${b.today.joined} tokens issued`}
        />
        <Stat
          label="Average service"
          value={durationLabel(b.today.averageServiceSeconds)}
          helper={`Configured ${durationLabel(b.traffic.configuredSeconds)}`}
        />
        <Stat
          label="Skipped or cancelled"
          value={`${b.today.skipped} / ${b.today.cancelled}`}
        />
      </StatStrip>

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
        title="Counter console"
        subtitle={
          id
            ? undefined
            : "Choose the counter you are running. Students see every change you make instantly."
        }
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
              <ServiceIcon kind={c.serviceKind} large />
              <div>
                <h3>{c.name}</h3>
                <p>
                  {c.serviceName}, {c.groupName}
                </p>
              </div>
              <CounterBadge status={c.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
