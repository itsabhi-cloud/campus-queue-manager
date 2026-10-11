import { History as HistoryIcon } from "lucide-react";
import { Link } from "wouter";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ServiceIcon,
  StatusBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { dateTime, durationLabel } from "@/lib/format";
import { trpc } from "@/lib/trpc";

export default function History() {
  const history = trpc.queue.history.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: last => last.nextCursor ?? undefined }
  );
  const items = history.data?.pages.flatMap(page => page.items) ?? [];
  return (
    <>
      <PageHeader
        title="History"
        subtitle="Tokens you've finished, cancelled or missed."
      />
      {history.isLoading ? (
        <LoadingBlock rows={3} />
      ) : history.error ? (
        <ErrorState
          message={errorMessage(history.error)}
          onRetry={() => history.refetch()}
        />
      ) : items.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={HistoryIcon}
            title="No past tokens yet"
            description="Once you finish or cancel a token, it shows up here."
            action={
              <Link href="/app" className="button button-primary">
                Find a service
              </Link>
            }
          />
        </div>
      ) : (
        <div className="panel">
          <ul className="list-rows">
            {items.map(item => (
              <li key={item.id}>
                <Link href={`/app/tokens/${item.id}`} className="list-row">
                  <ServiceIcon kind={item.serviceKind} />
                  <div className="list-row-main">
                    <strong>
                      <span className="display token-inline">
                        {item.tokenNumber}
                      </span>{" "}
                      {item.serviceName}
                    </strong>
                    <small>
                      {item.groupName}, {item.counterName}.{" "}
                      {dateTime(item.joinedAt)}
                      {item.calledAt
                        ? `. Waited ${durationLabel((new Date(item.calledAt).getTime() - new Date(item.joinedAt).getTime()) / 1000)}`
                        : ""}
                    </small>
                  </div>
                  <StatusBadge status={item.status} />
                </Link>
              </li>
            ))}
          </ul>
          {history.hasNextPage && (
            <button
              className="button button-outline button-full mt-4"
              onClick={() => history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage ? "Loading…" : "Show older tokens"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
