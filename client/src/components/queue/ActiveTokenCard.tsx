import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  ArrowRight,
  Bell,
  Camera,
  CameraOff,
  Info,
  MapPin,
  PauseCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/Dialog";
import {
  Countdown,
  ServiceIcon,
  StatusBadge,
  TokenNumber,
  TrafficBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { relativeTime, unitNoun } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";

export type ActiveEntry = RouterOutputs["queue"]["myActive"]["entries"][number];

function statusMessage(entry: ActiveEntry) {
  const kind = entry.service.kind;
  if (entry.status === "CALLED") {
    return {
      icon: Bell,
      tone: "called",
      title:
        kind === "ELEVATOR"
          ? `Board ${entry.counter.name} now`
          : `It's your turn — go to ${entry.counter.name}`,
      detail:
        kind === "CAFETERIA"
          ? "Please place your order at the counter."
          : "Staff are waiting for you. Please go now.",
    };
  }
  if (entry.status === "SERVING")
    return {
      icon: Sparkles,
      tone: "serving",
      title: "You're being served",
      detail: `At ${entry.counter.name}.`,
    };
  if (entry.counter.status !== "OPEN") {
    return {
      icon: PauseCircle,
      tone: "paused",
      title: `${entry.counter.name} is ${entry.counter.status === "PAUSED" ? "paused" : "offline"}`,
      detail: `${entry.counter.statusReason ? `${entry.counter.statusReason}. ` : ""}Your place is kept.`,
    };
  }
  return {
    icon: MapPin,
    tone: "waiting",
    title:
      entry.peopleAhead === 0
        ? "You're next — start heading over"
        : "You can leave the physical line",
    detail:
      entry.peopleAhead <= 2
        ? "We'll alert you when you're called."
        : "We'll alert you as your turn approaches.",
  };
}

export function CameraSignal({ camera }: { camera: ActiveEntry["camera"] }) {
  if (!camera) return null;
  return camera.fresh ? (
    <span className="signal-chip">
      <Camera size={13} aria-hidden /> Crowd sensor: ~{camera.peopleCount}{" "}
      nearby · {relativeTime(camera.reportedAt)}
    </span>
  ) : (
    <span className="signal-chip is-stale">
      <CameraOff size={13} aria-hidden /> Camera signal stale — using queue data
      only
    </span>
  );
}

export function ActiveTokenCard({
  entry,
  detailed = false,
}: {
  entry: ActiveEntry;
  detailed?: boolean;
}) {
  const utils = trpc.useUtils();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cancel = trpc.queue.cancel.useMutation({
    onSuccess: result => {
      toast(`Token ${result.tokenNumber} cancelled`, {
        description: "Your place has been released.",
      });
      setConfirmOpen(false);
      void utils.queue.myActive.invalidate();
      void utils.catalog.list.invalidate();
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const message = statusMessage(entry);
  const MessageIcon = message.icon;
  const waiting = entry.status === "WAITING";
  const progress = waiting
    ? Math.max(
        6,
        Math.round(
          100 * (1 - entry.peopleAhead / Math.max(entry.waitingTotal, 1))
        )
      )
    : 100;
  const paused = waiting && entry.counter.status !== "OPEN";

  return (
    <article
      className={`token-card token-card-${entry.status.toLowerCase()} ${detailed ? "is-detailed" : ""}`}
      aria-label={`Token ${entry.tokenNumber}`}
    >
      <div className="token-card-top">
        <div className="token-card-service">
          <ServiceIcon kind={entry.service.kind} />
          <div>
            <span className="token-kicker">{entry.service.name}</span>
            <strong>
              {entry.group.name} · {entry.counter.name}
            </strong>
            {entry.movedFrom && (
              <small className="moved-note">
                Moved from {entry.movedFrom} — your place was kept
              </small>
            )}
          </div>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      <div className="token-hero">
        <TokenNumber token={entry.tokenNumber} large />
        {entry.isPriority && <span className="priority-pill">Priority</span>}
      </div>

      <div
        className={`token-message tone-${message.tone}`}
        role={entry.status === "CALLED" ? "alert" : undefined}
      >
        <MessageIcon size={18} aria-hidden />
        <strong>{message.title}</strong>
        <span>{message.detail}</span>
      </div>

      <dl className="token-stats">
        <div>
          <dt>
            {waiting
              ? `${unitNoun(entry.group.unitLabel, 2).replace(/^./, c => c.toUpperCase())} ahead`
              : "Status"}
          </dt>
          <dd>
            {waiting
              ? entry.peopleAhead
              : entry.status === "CALLED"
                ? "Called"
                : "Serving"}
          </dd>
        </div>
        <div>
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
        <div>
          <dt>Now serving</dt>
          <dd className="now-serving">
            {entry.nowServing.length
              ? entry.nowServing.slice(0, 3).join(", ")
              : "—"}
          </dd>
        </div>
      </dl>

      {waiting && (
        <>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Queue progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-labels">
            <span>Joined</span>
            <span>
              Position {entry.position} of {entry.waitingTotal}
            </span>
            <span>Your turn</span>
          </div>
        </>
      )}

      <div className="token-signals">
        <TrafficBadge level={entry.traffic.effectiveLevel} />
        {entry.traffic.delaySeconds > 0 && (
          <span className="signal-chip">
            +{Math.round(entry.traffic.delaySeconds / 60)} min delay
            {entry.traffic.reason ? ` · ${entry.traffic.reason}` : ""}
          </span>
        )}
        <CameraSignal camera={entry.camera} />
      </div>

      {detailed && waiting && (
        <details className="estimate-explainer">
          <summary>
            <Info size={14} aria-hidden /> How is this estimated?
          </summary>
          <p>
            {entry.peopleAhead}{" "}
            {unitNoun(entry.group.unitLabel, entry.peopleAhead)} ahead × about{" "}
            {Math.round((entry.traffic.serviceSeconds / 60) * 10) / 10} min each
            {entry.traffic.effectiveLevel !== "NORMAL"
              ? `, adjusted for ${entry.traffic.effectiveLevel.toLowerCase()} traffic`
              : ""}
            {entry.traffic.delaySeconds > 0
              ? `, plus a ${Math.round(entry.traffic.delaySeconds / 60)}-minute delay set by staff`
              : ""}
            .
            {entry.traffic.observedSamples >= 5
              ? " Service time blends the configured average with recent real service times."
              : " Service time uses the configured average for this queue."}{" "}
            It is an estimate, not an appointment.
          </p>
        </details>
      )}

      <div className="token-card-actions">
        <small className="estimate-disclaimer">
          <Info size={13} aria-hidden /> Estimate · updated{" "}
          {relativeTime(entry.estimateUpdatedAt)}
        </small>
        <div className="token-card-buttons">
          {!detailed && (
            <Link
              href={`/app/tokens/${entry.id}`}
              className="button button-outline button-small"
            >
              Details <ArrowRight size={14} aria-hidden />
            </Link>
          )}
          {entry.status !== "SERVING" && (
            <button
              className="button button-outline button-small button-danger"
              onClick={() => setConfirmOpen(true)}
            >
              <XCircle size={14} aria-hidden /> Cancel
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Cancel token ${entry.tokenNumber}?`}
        description="You'll lose your place in this queue. You can take a new token later, but you'll join at the back."
        confirmLabel="Cancel my token"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate({ entryId: entry.id })}
      />
    </article>
  );
}
