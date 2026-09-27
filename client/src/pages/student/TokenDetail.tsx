import { useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, CheckCircle2, SearchX } from "lucide-react";
import { TokenTicket } from "@/components/queue/TokenTicket";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PanelHead,
  StatusBadge,
  TokenNumber,
} from "@/components/ui/primitives";
import { syncServerTime } from "@/lib/clock";
import { appCodeOf, errorMessage } from "@/lib/errors";
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
const FINAL = new Set(["COMPLETED", "SKIPPED", "CANCELLED"]);

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
  const [, navigate] = useLocation();
  const justJoined = new URLSearchParams(useSearch()).get("joined") === "1";

  if (entry.isLoading) return <LoadingBlock rows={3} />;
  if (entry.error && appCodeOf(entry.error) === "NOT_FOUND") {
    return (
      <div className="panel">
        <EmptyState
          icon={SearchX}
          title="We couldn't find that token"
          description="It may belong to another account, or the link is wrong."
          action={
            <Link href="/app" className="button button-primary">
              Go to your tokens
            </Link>
          }
        />
      </div>
    );
  }
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
        <ArrowLeft size={16} aria-hidden /> Your tokens
      </Link>
      {justJoined && live && (
        <div className="joined-banner" role="status">
          <CheckCircle2 size={28} aria-hidden />
          <div>
            <strong>
              You're in. Token {live.tokenNumber} is holding your place.
            </strong>
            <p>
              {live.service.kind === "CAFETERIA"
                ? "You've reserved your place, not an order. "
                : ""}
              You can leave the line now. We'll alert you when your turn is
              close.
            </p>
          </div>
          <button
            className="button button-light button-small"
            onClick={() =>
              navigate(`/app/tokens/${entryId}`, { replace: true })
            }
          >
            Got it
          </button>
        </div>
      )}
      <div className="detail-layout">
        <div>
          {live ? (
            <TokenTicket entry={live} detailed />
          ) : (
            <div className="panel">
              <div className="ticket-where">
                <TokenNumber
                  token={data.tokenNumber}
                  className="ticket-number"
                />
                <StatusBadge status={data.status} />
              </div>
              <p className="ticket-message">
                {data.status === "COMPLETED" && "This visit is complete."}
                {data.status === "CANCELLED" &&
                  `This token was cancelled${data.closedReason ? `: ${data.closedReason}` : "."}`}
                {data.status === "SKIPPED" &&
                  `This token was skipped${data.closedReason ? `: ${data.closedReason}` : " because nobody answered the call."}`}
                {!FINAL.has(data.status) && "Loading your live position…"}
                <span>
                  {data.serviceName}, {data.groupName}, {data.counterName}
                </span>
              </p>
              <Link href="/app" className="button button-primary mt-4">
                Take a new token
              </Link>
            </div>
          )}
        </div>
        <aside className="panel" aria-labelledby="timeline-heading">
          <PanelHead
            id="timeline-heading"
            title="History of this token"
            description={`Joined ${dateTime(data.joinedAt)}`}
          />
          <ol className="timeline">
            {data.timeline.map(event => (
              <li
                key={event.id}
                className={FINAL.has(event.type) ? "is-final" : ""}
              >
                <span className="timeline-dot" aria-hidden />
                <strong>{EVENT_LABEL[event.type] ?? event.type}</strong>
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {timeOnly(event.createdAt)}
                </time>
              </li>
            ))}
          </ol>
          <p className="fine-print">
            Only you and campus staff can see this token.
          </p>
        </aside>
      </div>
    </>
  );
}
