import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Tabs,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";

function BrowserAlertsButton() {
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState(
    supported ? Notification.permission : "denied"
  );
  if (!supported) return null;
  if (permission === "granted")
    return <span className="signal-chip">Browser alerts on</span>;
  return (
    <button
      className="button button-outline button-small"
      disabled={permission === "denied"}
      title={
        permission === "denied" ? "Blocked in your browser settings" : undefined
      }
      onClick={async () =>
        setPermission(await Notification.requestPermission())
      }
    >
      <BellRing size={14} aria-hidden />{" "}
      {permission === "denied"
        ? "Browser alerts blocked"
        : "Enable browser alerts"}
    </button>
  );
}

export default function Notifications() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const list = trpc.notifications.list.useInfiniteQuery(
    { limit: 20, unreadOnly: filter === "unread" },
    { getNextPageParam: last => last.nextCursor ?? undefined }
  );
  const refresh = () => void utils.notifications.invalidate();
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: refresh,
  });
  const markAll = trpc.notifications.markAllRead.useMutation({
    onSuccess: refresh,
    onError: e => toast.error(errorMessage(e)),
  });
  const items = list.data?.pages.flatMap(page => page.items) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Updates"
        title="Notifications"
        subtitle="Queue updates that need your attention. New ones also pop up while QueueSense is open."
        actions={
          <>
            <BrowserAlertsButton />
            <button
              className="button button-outline button-small"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck size={14} aria-hidden /> Mark all read
            </button>
          </>
        }
      />
      <Tabs
        label="Filter notifications"
        value={filter}
        onChange={setFilter}
        items={[
          { value: "all", label: "All" },
          { value: "unread", label: "Unread" },
        ]}
      />
      {list.isLoading ? (
        <LoadingBlock rows={3} />
      ) : list.error ? (
        <ErrorState
          message={errorMessage(list.error)}
          onRetry={() => list.refetch()}
        />
      ) : items.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={Bell}
            title={
              filter === "unread"
                ? "You're all caught up"
                : "No notifications yet"
            }
            description="We'll notify you when you join a queue, when your turn approaches, and if anything changes."
          />
        </div>
      ) : (
        <div className="panel">
          <ul className="notification-list">
            {items.map(item => (
              <li key={item.id} className={item.readAt ? "" : "is-unread"}>
                <span
                  className={`notification-dot type-${item.type.toLowerCase()}`}
                  aria-hidden
                />
                <div className="notification-body">
                  <strong>{item.title}</strong>
                  <p>{item.message}</p>
                  <small>
                    {relativeTime(item.createdAt)}
                    {item.queueEntryId && (
                      <>
                        {" · "}
                        <Link href={`/app/tokens/${item.queueEntryId}`}>
                          View token
                        </Link>
                      </>
                    )}
                  </small>
                </div>
                {!item.readAt && (
                  <button
                    className="button button-outline button-small"
                    onClick={() => markRead.mutate({ ids: [item.id] })}
                    aria-label={`Mark "${item.title}" as read`}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <button
              className="button button-outline button-full"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
