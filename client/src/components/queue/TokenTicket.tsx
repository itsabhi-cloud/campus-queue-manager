import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { GitMerge, TrendingDown, TrendingUp, WifiOff } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Dialog";
import {
  Chip,
  ServiceIcon,
  StatusBadge,
  TrafficBadge,
} from "@/components/ui/primitives";
import { useRemainingSeconds } from "@/lib/clock";
import { errorMessage } from "@/lib/errors";
import { countdownLabel, relativeTime, unitNoun } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { CameraSignal } from "./CameraSignal";
import { QueueLine } from "./QueueLine";

export type ActiveEntry = RouterOutputs["queue"]["myActive"]["entries"][number];

type Variant =
  | "waiting"
  | "almost"
  | "called"
  | "serving"
  | "paused"
  | "offline";

export function variantOf(entry: ActiveEntry): Variant {
  if (entry.status === "CALLED") return "called";
  if (entry.status === "SERVING") return "serving";
  if (entry.counter.status === "PAUSED") return "paused";
  if (entry.counter.status === "OFFLINE") return "offline";
  return entry.peopleAhead <= 1 ? "almost" : "waiting";
}

/** What the student should do right now, in one sentence. Wording varies by service, behaviour doesn't. */
function instruction(entry: ActiveEntry, variant: Variant) {
  const kind = entry.service.kind;
  const counter = entry.counter.name;
  switch (variant) {
    case "called":
      return {
        title:
          kind === "ELEVATOR" ? `Board ${counter} now` : `Go to ${counter} now`,
        detail:
          kind === "CAFETERIA"
            ? "It's your turn. Place your order at the counter."
            : "It's your turn. Staff are waiting for you.",
      };
    case "serving":
      return {
        title: kind === "ELEVATOR" ? "You're boarding" : "You're being served",
        detail: `At ${counter}.`,
      };
    case "paused":
      return {
        title: `${counter} is paused`,
        detail: `${entry.counter.statusReason ? `${entry.counter.statusReason}. ` : ""}You keep your place while it's paused.`,
      };
    case "offline":
      return {
        title: `${counter} is offline`,
        detail: `${entry.counter.statusReason ? `${entry.counter.statusReason}. ` : ""}You keep your place; staff may move your token to another counter.`,
      };
    case "almost":
      return {
        title: entry.peopleAhead === 0 ? "You're next" : "Almost your turn",
        detail:
          kind === "CAFETERIA"
            ? "Head to the cafeteria counter so you're ready to order."
            : kind === "ELEVATOR"
              ? "Make your way to the lift lobby."
              : `Start heading to ${counter}.`,
      };
    default:
      return {
        title:
          kind === "CAFETERIA"
            ? "Your place is reserved"
            : "You can leave the line",
        detail: "We'll alert you as your turn gets close.",
      };
  }
}

type Change = { tone: "up" | "down" | "move"; text: string; at: number };

/**
 * Compares each authoritative update with the previous one and describes what changed, so a
 * student glancing at the screen sees "Moved up to position 2", not just a different number.
 */
function useChange(entry: ActiveEntry): Change | null {
  const [change, setChange] = useState<Change | null>(null);
  const previous = useRef(entry);
  useEffect(() => {
    const before = previous.current;
    previous.current = entry;
    if (
      before.id !== entry.id ||
      entry.status !== "WAITING" ||
      before.status !== "WAITING"
    )
      return;
    const now = Date.now();
    if (before.counter.id !== entry.counter.id) {
      setChange({
        tone: "move",
        text: `Moved to ${entry.counter.name}, position ${entry.position}`,
        at: now,
      });
      return;
    }
    if (entry.position < before.position) {
      setChange({
        tone: "down",
        text: `Moved up to position ${entry.position}`,
        at: now,
      });
      return;
    }
    if (entry.position > before.position) {
      setChange({
        tone: "up",
        text:
          entry.isPriority === before.isPriority
            ? `Queue order changed, now position ${entry.position}`
            : `Position changed to ${entry.position}`,
        at: now,
      });
      return;
    }
    const estimateMoved =
      new Date(entry.estimateUpdatedAt).getTime() !==
      new Date(before.estimateUpdatedAt).getTime();
    const oldRemaining =
      before.estimatedWaitSeconds -
      (new Date(entry.estimateUpdatedAt).getTime() -
        new Date(before.estimateUpdatedAt).getTime()) /
        1000;
    const delta = entry.estimatedWaitSeconds - oldRemaining;
    if (estimateMoved && Math.abs(delta) >= 60) {
      const why =
        entry.traffic.effectiveLevel !== before.traffic.effectiveLevel ||
        entry.traffic.delaySeconds !== before.traffic.delaySeconds;
      const minutes = Math.round(Math.abs(delta) / 60);
      setChange(
        delta > 0
          ? {
              tone: "up",
              text: `Wait up about ${minutes} min${why ? (entry.traffic.reason ? `: ${entry.traffic.reason}` : ", heavier traffic") : ""}`,
              at: now,
            }
          : {
              tone: "down",
              text: `Wait down about ${minutes} min${why ? ", traffic eased" : ", queue moving faster"}`,
              at: now,
            }
      );
    }
  }, [entry]);
  return change;
}

function WaitFigure({
  entry,
  variant,
}: {
  entry: ActiveEntry;
  variant: Variant;
}) {
  const remaining = useRemainingSeconds(
    entry.estimatedWaitSeconds,
    entry.estimateUpdatedAt
  );
  if (variant === "called" || variant === "serving") return <>Now</>;
  if (variant === "paused" || variant === "offline")
    return <span className="countdown is-paused">On hold</span>;
  if (entry.peopleAhead === 0 && remaining <= 30) return <>Next</>;
  if (remaining === 0)
    return <span className="countdown is-late">Any minute</span>;
  if (remaining <= 30) return <>Soon</>;
  return <span className="countdown num">{countdownLabel(remaining)}</span>;
}

function useOverdue(entry: ActiveEntry) {
  const remaining = useRemainingSeconds(
    entry.estimatedWaitSeconds,
    entry.estimateUpdatedAt
  );
  return (
    entry.status === "WAITING" &&
    entry.peopleAhead > 0 &&
    entry.counter.status === "OPEN" &&
    remaining === 0
  );
}

export function TokenTicket({
  entry,
  detailed = false,
}: {
  entry: ActiveEntry;
  /** Detailed view is the token's own page, where the token number is the page heading. */
  detailed?: boolean;
}) {
  const Heading = detailed ? "h1" : "h3";
  const utils = trpc.useUtils();
  const { state } = useRealtime();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const change = useChange(entry);
  const overdue = useOverdue(entry);
  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: result => {
      toast(`Token ${result.tokenNumber} cancelled`, {
        description: "Your place was released.",
      });
      setConfirmOpen(false);
      void utils.queue.myActive.invalidate();
      void utils.catalog.list.invalidate();
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const variant = variantOf(entry);
  const say = instruction(entry, variant);
  const waiting = entry.status === "WAITING";
  const ChangeIcon =
    change?.tone === "up"
      ? TrendingUp
      : change?.tone === "down"
        ? TrendingDown
        : GitMerge;

  return (
    <article
      className={`ticket is-${variant}`}
      aria-labelledby={`ticket-${entry.id}`}
    >
      <div className="ticket-top">
        <div className="ticket-where">
          <div className="ticket-where-text">
            <ServiceIcon kind={entry.service.kind} />
            <div>
              <small>
                {entry.service.name}, {entry.group.name}
              </small>
              <strong>{entry.counter.name}</strong>
            </div>
          </div>
          {variant === "almost" ? (
            <Chip tone="brand">Almost next</Chip>
          ) : (
            <StatusBadge status={entry.status} />
          )}
        </div>
        <Heading className="ticket-number" id={`ticket-${entry.id}`}>
          <span aria-label={`Token ${entry.tokenNumber}`}>
            {entry.tokenNumber}
          </span>
          {entry.isPriority && <Chip tone="outline">Priority</Chip>}
        </Heading>
        <p
          className="ticket-message"
          role={entry.status === "CALLED" ? "alert" : undefined}
        >
          {say.title}
          <span>{say.detail}</span>
        </p>
        {entry.movedFrom && (
          <div className="ticket-banner">
            <GitMerge size={16} aria-hidden />
            <p>
              <strong>{entry.movedFrom} became unavailable.</strong> Your token
              continues at {entry.counter.name}. Your place was kept, not reset.
            </p>
          </div>
        )}
      </div>

      <div className="ticket-perf" aria-hidden />

      <dl className="ticket-stub">
        <div className="ticket-figure">
          <dt>{waiting ? "Estimated wait" : "Wait"}</dt>
          <dd>
            <WaitFigure entry={entry} variant={variant} />
          </dd>
        </div>
        <div className="ticket-figure">
          <dt>
            {waiting
              ? `${unitNoun(entry.group.unitLabel, 2).replace(/^./, c => c.toUpperCase())} ahead`
              : "Now serving"}
          </dt>
          <dd className="num">
            {waiting
              ? entry.peopleAhead
              : (entry.nowServing[0] ?? entry.tokenNumber)}
            {waiting && (
              <small>
                position {entry.position} of {entry.waitingTotal}
              </small>
            )}
          </dd>
        </div>
      </dl>
      {waiting && (
        <div className="ticket-line ticket-line-row">
          <QueueLine
            peopleAhead={entry.peopleAhead}
            unit={entry.group.unitLabel}
          />
        </div>
      )}

      {change && (
        <p
          className={`ticket-change is-${change.tone}`}
          key={change.at}
          role="status"
        >
          <ChangeIcon size={15} aria-hidden /> {change.text}
        </p>
      )}
      {overdue && (
        <p className="ticket-change is-up">
          Taking longer than estimated. You keep your place.
        </p>
      )}
      {state !== "live" && (
        <p className="ticket-change is-muted">
          <WifiOff size={15} aria-hidden /> Live updates paused. Showing the
          last update; refreshing every 20 seconds.
        </p>
      )}

      <div className="ticket-meta">
        {waiting && entry.nowServing.length > 0 && (
          <span>Now serving {entry.nowServing.slice(0, 3).join(", ")}</span>
        )}
        <TrafficBadge level={entry.traffic.effectiveLevel} />
        {entry.traffic.delaySeconds > 0 && (
          <span>
            +{Math.round(entry.traffic.delaySeconds / 60)} min delay
            {entry.traffic.reason ? `: ${entry.traffic.reason}` : ""}
          </span>
        )}
        <CameraSignal camera={entry.camera} />
        {waiting && entry.peopleAhead > 0 && (
          <span>Estimate updated {relativeTime(entry.estimateUpdatedAt)}</span>
        )}
      </div>

      {detailed && waiting && (
        <details className="ticket-explainer">
          <summary>How is this estimated?</summary>
          <p>
            {entry.peopleAhead}{" "}
            {unitNoun(entry.group.unitLabel, entry.peopleAhead)} ahead, about{" "}
            {Math.round((entry.traffic.serviceSeconds / 60) * 10) / 10} minutes
            each
            {entry.group.unitLabel === "riders" ? " trip" : ""}
            {entry.traffic.effectiveLevel !== "NORMAL"
              ? `, adjusted for ${entry.traffic.effectiveLevel.toLowerCase()} traffic`
              : ""}
            {entry.traffic.delaySeconds > 0
              ? `, plus a ${Math.round(entry.traffic.delaySeconds / 60)}-minute delay set by staff`
              : ""}
            .{" "}
            {entry.traffic.observedSamples >= 5
              ? "Service time blends the configured average with recent real service times."
              : "Service time uses this queue's configured average."}{" "}
            It's an estimate, not an appointment.
          </p>
        </details>
      )}

      <div className="ticket-actions">
        {!detailed && (
          <Link
            href={`/app/tokens/${entry.id}`}
            className="button button-outline"
          >
            View details
          </Link>
        )}
        {entry.status !== "SERVING" && (
          <button
            className="button button-outline button-danger"
            onClick={() => setConfirmOpen(true)}
          >
            Cancel token
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Cancel token ${entry.tokenNumber}?`}
        description="You'll lose your place. If you take a new token later, you'll join at the back."
        confirmLabel="Cancel token"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate({ entryId: entry.id })}
      />
    </article>
  );
}
