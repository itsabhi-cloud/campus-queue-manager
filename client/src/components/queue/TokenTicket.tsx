import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/Dialog";
import {
  Countdown,
  ServiceIcon,
  StatusBadge,
  TrafficBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { relativeTime, unitNoun } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { CameraSignal } from "./CameraSignal";
import { QueueLine } from "./QueueLine";

export type ActiveEntry = RouterOutputs["queue"]["myActive"]["entries"][number];

/** What the student should do right now, in one sentence. */
function instruction(entry: ActiveEntry) {
  const kind = entry.service.kind;
  if (entry.status === "CALLED") {
    return {
      title:
        kind === "ELEVATOR"
          ? `Board ${entry.counter.name} now`
          : `Go to ${entry.counter.name} now`,
      detail:
        kind === "CAFETERIA"
          ? "It's your turn. Place your order at the counter."
          : "It's your turn. Staff are waiting for you.",
    };
  }
  if (entry.status === "SERVING")
    return {
      title: "You're being served",
      detail: `At ${entry.counter.name}.`,
    };
  if (entry.counter.status !== "OPEN") {
    return {
      title: `${entry.counter.name} is ${entry.counter.status === "PAUSED" ? "paused" : "offline"}`,
      detail: `${entry.counter.statusReason ? `${entry.counter.statusReason}. ` : ""}You keep your place.`,
    };
  }
  if (entry.peopleAhead === 0)
    return { title: "You're next", detail: "Start heading to the counter." };
  return {
    title: "You can leave the line",
    detail: "We'll alert you as your turn gets close.",
  };
}

/** Announces position changes politely to screen readers. */
function usePositionAnnouncement(entry: ActiveEntry) {
  const [message, setMessage] = useState("");
  const previous = useRef({ position: entry.position, status: entry.status });
  useEffect(() => {
    const before = previous.current;
    if (
      entry.status === "WAITING" &&
      before.status === "WAITING" &&
      before.position !== entry.position
    ) {
      setMessage(
        `Token ${entry.tokenNumber} is now position ${entry.position}, previously ${before.position}.`
      );
    }
    previous.current = { position: entry.position, status: entry.status };
  }, [entry.position, entry.status, entry.tokenNumber]);
  return message;
}

export function TokenTicket({
  entry,
  detailed = false,
}: {
  entry: ActiveEntry;
  detailed?: boolean;
}) {
  const utils = trpc.useUtils();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const announcement = usePositionAnnouncement(entry);
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
  const say = instruction(entry);
  const waiting = entry.status === "WAITING";
  const paused = waiting && entry.counter.status !== "OPEN";

  return (
    <article
      className={`ticket is-${entry.status.toLowerCase()}`}
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
          <StatusBadge status={entry.status} />
        </div>
        <h3 className="ticket-number" id={`ticket-${entry.id}`}>
          <span aria-label={`Token ${entry.tokenNumber}`}>
            {entry.tokenNumber}
          </span>
          {entry.isPriority && <span className="chip chip-warn">Priority</span>}
        </h3>
        <p
          className="ticket-message"
          role={entry.status === "CALLED" ? "alert" : undefined}
        >
          {say.title}
          <span>{say.detail}</span>
        </p>
        {entry.movedFrom && (
          <p className="ticket-moved">
            Moved from {entry.movedFrom}. Your place was kept.
          </p>
        )}
      </div>

      <div className="ticket-perf" aria-hidden />

      <dl className="ticket-stub">
        <div className="ticket-figure">
          <dt>Estimated wait</dt>
          <dd>
            {waiting ? (
              <Countdown
                seconds={entry.estimatedWaitSeconds}
                updatedAt={entry.estimateUpdatedAt}
                paused={paused}
              />
            ) : (
              "Now"
            )}
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
            {waiting && <small>of {entry.waitingTotal} waiting</small>}
          </dd>
        </div>
        {waiting && (
          <div className="ticket-line">
            <QueueLine
              peopleAhead={entry.peopleAhead}
              unit={entry.group.unitLabel}
            />
          </div>
        )}
      </dl>

      <div className="ticket-meta">
        {entry.nowServing.length > 0 && waiting && (
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
            Details
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

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

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
