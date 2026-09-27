import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, Clock3 } from "lucide-react";
import { ActiveTokenCard } from "@/components/queue/ActiveTokenCard";
import {
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatusBadge,
  TokenNumber,
} from "@/components/ui/primitives";
import { syncServerTime } from "@/lib/clock";
import { errorMessage } from "@/lib/errors";
import { dateTime, timeOnly } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";

const EVENT_LABEL: Record<string, string> = {
  JOINED: "Joined the queue",
  CALLED: "Called to the counter",
  SERVING: "Service started",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
  CANCELLED: "Cancelled",
  PRIORITY_ASSIGNED: "Given priority",
  PRIORITY_REMOVED: "Priority removed",
  MERGED: "Moved to another counter",
};

export default function TokenDetail({ id }: { id: string }) {
  const entryId = Number(id);
  const { pollInterval } = useRealtime();
  const entry = trpc.queue.entry.useQuery(
    { entryId },
    { enabled: Number.isInteger(entryId) && entryId > 0 }
  );
  const active = trpc.queue.myActive.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  useEffect(() => {
    if (active.data) syncServerTime(active.data.serverTime);
  }, [active.data]);
  const live = active.data?.entries.find(e => e.id === entryId);

  if (entry.isLoading) return <LoadingBlock rows={3} />;
  if (entry.error)
    return (
      <ErrorState
        message={errorMessage(entry.error)}
        onRetry={() => entry.refetch()}
      />
    );
  const data = entry.data!;

  return (
    <>
      <Link href="/app" className="back-link">
        <ArrowLeft size={15} aria-hidden /> My queues
      </Link>
      <PageHeader
        eyebrow={`${data.serviceName} · ${data.groupName}`}
        title={`Token ${data.tokenNumber}`}
        subtitle={`Joined ${dateTime(data.joinedAt)}`}
      />
      <div className="detail-layout">
        <div>
          {live ? (
            <ActiveTokenCard entry={live} detailed />
          ) : (
            <div className="panel finished-token">
              <TokenNumber token={data.tokenNumber} large />
              <StatusBadge status={data.status} />
              <p className="muted">
                {data.status === "COMPLETED" &&
                  "This visit is complete. Thanks for using QueueSense."}
                {data.status === "CANCELLED" &&
                  `This token was cancelled${data.closedReason ? `: ${data.closedReason}` : "."}`}
                {data.status === "SKIPPED" &&
                  `This token was skipped${data.closedReason ? `: ${data.closedReason}` : " because it wasn't answered."}`}
                {(data.status === "WAITING" ||
                  data.status === "CALLED" ||
                  data.status === "SERVING") &&
                  "Loading live position…"}
              </p>
              <Link href="/app" className="button button-primary">
                Take another token
              </Link>
            </div>
          )}
        </div>
        <aside className="panel">
          <div className="eyebrow">Timeline</div>
          <h3>What happened</h3>
          <ol className="timeline">
            {data.timeline.map(event => (
              <li key={event.id}>
                <span className="timeline-dot" aria-hidden>
                  {event.type === "COMPLETED" ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <Clock3 size={13} />
                  )}
                </span>
                <div>
                  <strong>{EVENT_LABEL[event.type] ?? event.type}</strong>
                  <small>{timeOnly(event.createdAt)}</small>
                </div>
              </li>
            ))}
          </ol>
          <p className="fine-print">
            At {data.counterName}. Only you and campus staff can see this
            token's details.
          </p>
        </aside>
      </div>
    </>
  );
}
