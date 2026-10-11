import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Bell,
  BellRing,
  CheckCheck,
  CircleCheck,
  CircleX,
  GitMerge,
  Pause,
  PowerOff,
  Play,
  Star,
  Ticket,
  TrendingDown,
  TrendingUp,
  ListOrdered,
  type LucideIcon,
} from "lucide-react";
import type { NotificationType } from "@shared/domain";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Tabs,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";

type Item = RouterOutputs["notifications"]["list"]["items"][number];
type Filter = "all" | "unread" | "turn" | "changes";

/** Your turn: act now. Changes: your place or wait moved. Everything else is a record. */
const CATEGORY: Record<NotificationType, "turn" | "changes" | "updates"> = {
  ALMOST_NEXT: "turn",
  TOKEN_CALLED: "turn",
  SERVICE_STARTED: "updates",
  SERVICE_COMPLETED: "updates",
  QUEUE_JOINED: "updates",
  TOKEN_CANCELLED: "updates",
  TOKEN_SKIPPED: "updates",
  POSITION_CHANGED: "changes",
  PRIORITY_ADJUSTMENT: "changes",
  PRIORITY_ASSIGNED: "changes",
  QUEUE_MERGED: "changes",
  WAIT_INCREASED: "changes",
  WAIT_DECREASED: "changes",
  COUNTER_PAUSED: "changes",
  COUNTER_RESUMED: "changes",
  COUNTER_OFFLINE: "changes",
};

const ICON: Record<NotificationType, LucideIcon> = {
  ALMOST_NEXT: BellRing,
  TOKEN_CALLED: BellRing,
  SERVICE_STARTED: Play,
  SERVICE_COMPLETED: CircleCheck,
  QUEUE_JOINED: Ticket,
  TOKEN_CANCELLED: CircleX,
  TOKEN_SKIPPED: CircleX,
  POSITION_CHANGED: ListOrdered,
  PRIORITY_ADJUSTMENT: ListOrdered,
  PRIORITY_ASSIGNED: Star,
  QUEUE_MERGED: GitMerge,
  WAIT_INCREASED: TrendingUp,
  WAIT_DECREASED: TrendingDown,
  COUNTER_PAUSED: Pause,
  COUNTER_RESUMED: Play,
  COUNTER_OFFLINE: PowerOff,
};

function BrowserAlertsButton() {
  const supported = typeof Notification !== "undefined";
  const [permission, setPermission] = useState(
    supported ? Notification.permission : "denied"
  );
  if (!supported) return null;
  if (permission === "granted")
    return <span className="chip chip-go">Phone alerts on</span>;
  return (
    <button
      className="button button-outline button-small"
      disabled={permission === "denied"}
      title={
        permission === "denied"
          ? "Blocked in your browser settings"
          : "Show alerts even when QueueSense is in the background"
      }
      onClick={async () =>
        setPermission(await Notification.requestPermission())
      }
    >
      <BellRing size={14} aria-hidden />{" "}
      {permission === "denied"
        ? "Browser alerts blocked"
        : "Turn on browser alerts"}
    </button>
  );
}

function isToday(date: Date | string) {
  return new Date(date).toDateString() === new Date().toDateString();
}

function NotificationRow({
  item,
  onRead,
}: {
  item: Item;
  onRead: (id: number) => void;
}) {
  const Icon = ICON[item.type];
  const category = CATEGORY[item.type];
  return (
    <li className={`${item.readAt ? "" : "is-unread"} cat-${category}`}>
      <span className="notification-icon" aria-hidden>
        <Icon size={16} />
      </span>
      <div className="notification-body">
        <strong>
          {!item.readAt && <span className="sr-only">Unread: </span>}
          {item.title}
        </strong>
        <p>{item.message}</p>
        <small>
          {relativeTime(item.createdAt)}
          {item.queueEntryId && (
            <>
              {", "}
              <Link href={`/app/tokens/${item.queueEntryId}`}>view token</Link>
            </>
          )}
        </small>
      </div>
      {!item.readAt && (
        <button
          className="text-button"
          onClick={() => onRead(item.id)}
          aria-label={`Mark "${item.title}" as read`}
        >
          Mark read
        </button>
      )}
    </li>
  );
}

export default function Notifications() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<Filter>("all");
  const list = trpc.notifications.list.useInfiniteQuery(
    { limit: 30, unreadOnly: filter === "unread" },
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
  const items = useMemo(() => {
    const all = list.data?.pages.flatMap(page => page.items) ?? [];
    return filter === "turn" || filter === "changes"
      ? all.filter(item => CATEGORY[item.type] === filter)
      : all;
  }, [list.data, filter]);
  const today = items.filter(item => isToday(item.createdAt));
  const earlier = items.filter(item => !isToday(item.createdAt));
  const onRead = (id: number) => markRead.mutate({ ids: [id] });

  const emptyText: Record<Filter, { title: string; description: string }> = {
    all: {
      title: "No notifications yet",
      description:
        "We'll tell you when you join a queue, when your turn is close, and if anything changes.",
    },
    unread: {
      title: "You're all caught up",
      description: "New updates about your tokens will appear here.",
    },
    turn: {
      title: "Nothing needs you right now",
      description: "When you're almost next or called, it shows up here.",
    },
    changes: {
      title: "No changes to your queues",
      description: "Moves, merges, pauses and big wait changes appear here.",
    },
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Updates about your tokens. While QueueSense is open, new ones also pop up."
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
          { value: "turn", label: "Your turn" },
          { value: "changes", label: "Changes" },
        ]}
      />
      {list.isLoading ? (
        <LoadingBlock rows={3} label="Loading notifications" />
      ) : list.error ? (
        <ErrorState
          message={errorMessage(list.error)}
          onRetry={() => list.refetch()}
        />
      ) : items.length === 0 ? (
        <div className="panel">
          <EmptyState icon={Bell} {...emptyText[filter]} />
        </div>
      ) : (
        <div className="panel">
          {[
            { label: "Today", rows: today },
            { label: "Earlier", rows: earlier },
          ]
            .filter(group => group.rows.length > 0)
            .map(group => (
              <section
                key={group.label}
                aria-label={group.label}
                className="notification-group"
              >
                <h2>{group.label}</h2>
                <ul className="notification-list">
                  {group.rows.map(item => (
                    <NotificationRow
                      key={item.id}
                      item={item}
                      onRead={onRead}
                    />
                  ))}
                </ul>
              </section>
            ))}
          {list.hasNextPage && (
            <button
              className="button button-outline button-full mt-4"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage
                ? "Loading…"
                : "Show older notifications"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
