import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Info, Ticket, Users } from "lucide-react";
import { CameraSignal } from "@/components/queue/ActiveTokenCard";
import {
  Callout,
  CounterBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ServiceIcon,
  TrafficBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { approxMinutes, plural, unitNoun } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";

type Group =
  RouterOutputs["catalog"]["list"]["services"][number]["groups"][number];

function GroupPanel({
  group,
  heldToken,
}: {
  group: Group;
  heldToken?: { id: number; tokenNumber: string };
}) {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const openCounters = group.counters.filter(
    counter => counter.status === "OPEN"
  );
  const [choice, setChoice] = useState<number | "auto">(
    openCounters.length > 1 ? "auto" : (openCounters[0]?.id ?? "auto")
  );
  const join = trpc.queue.join.useMutation({
    onSuccess: result => {
      toast.success(`You're in: ${result.tokenNumber}`, {
        description: `${result.counterName} · ${plural(result.peopleAhead, unitNoun(group.unitLabel, 1), group.unitLabel)} ahead. You can leave the line now.`,
      });
      void utils.queue.myActive.invalidate();
      void utils.catalog.list.invalidate();
      navigate(`/app/tokens/${result.entryId}`);
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const canJoin = openCounters.length > 0 && !heldToken;

  return (
    <section
      className="panel group-panel"
      aria-labelledby={`group-${group.id}`}
    >
      <div className="group-panel-head">
        <div>
          <h2 id={`group-${group.id}`}>{group.name}</h2>
          {group.description && <p className="muted">{group.description}</p>}
        </div>
        <div className="group-stats">
          <span>
            <Users size={14} aria-hidden /> {group.waiting} waiting
          </span>
          <span>
            {group.estimatedWaitSeconds === null
              ? "No counter open"
              : `${approxMinutes(group.estimatedWaitSeconds)} if you join now`}
          </span>
        </div>
      </div>
      <div className="token-signals">
        <TrafficBadge level={group.traffic.effectiveLevel} />
        {group.traffic.delaySeconds > 0 && (
          <span className="signal-chip">
            +{Math.round(group.traffic.delaySeconds / 60)} min
            {group.traffic.reason ? ` · ${group.traffic.reason}` : ""}
          </span>
        )}
        {group.serveCapacity > 1 && (
          <span className="signal-chip">
            Boards up to {group.serveCapacity} at a time
          </span>
        )}
        <CameraSignal camera={group.camera} />
      </div>

      <fieldset className="counter-choices" disabled={!canJoin}>
        <legend className="sr-only">Choose a counter</legend>
        {openCounters.length > 1 && (
          <label
            className={`counter-choice ${choice === "auto" ? "selected" : ""}`}
          >
            <input
              type="radio"
              name={`counter-${group.id}`}
              checked={choice === "auto"}
              onChange={() => setChoice("auto")}
            />
            <span>
              <strong>Any open counter</strong>
              <small>We'll place you in the shortest line</small>
            </span>
          </label>
        )}
        {group.counters.map(counter => (
          <label
            key={counter.id}
            className={`counter-choice ${choice === counter.id ? "selected" : ""} ${counter.status !== "OPEN" ? "is-disabled" : ""}`}
          >
            <input
              type="radio"
              name={`counter-${group.id}`}
              checked={choice === counter.id}
              disabled={counter.status !== "OPEN"}
              onChange={() => setChoice(counter.id)}
            />
            <span>
              <strong>{counter.name}</strong>
              <small>
                {counter.status === "OPEN"
                  ? `${counter.waiting} waiting · ${approxMinutes(counter.estimatedWaitSeconds)}${counter.nowServing.length ? ` · now ${counter.nowServing.join(", ")}` : ""}`
                  : counter.mergedIntoCounterId
                    ? `Merged into ${group.counters.find(c => c.id === counter.mergedIntoCounterId)?.name ?? "another counter"}`
                    : (counter.statusReason ?? "Not accepting tokens")}
              </small>
            </span>
            <CounterBadge status={counter.status} />
          </label>
        ))}
      </fieldset>

      {heldToken ? (
        <Link
          href={`/app/tokens/${heldToken.id}`}
          className="button button-outline button-full"
        >
          <Ticket size={16} aria-hidden /> You hold {heldToken.tokenNumber} —
          view live position <ArrowRight size={15} aria-hidden />
        </Link>
      ) : (
        <button
          className="button button-primary button-full"
          disabled={!canJoin || join.isPending}
          onClick={() =>
            join.mutate({
              queueGroupId: group.id,
              counterId: choice === "auto" ? undefined : choice,
            })
          }
        >
          {openCounters.length === 0
            ? "No counter is open right now"
            : join.isPending
              ? "Reserving your place…"
              : "Get digital token"}
          {canJoin && !join.isPending && <ArrowRight size={16} aria-hidden />}
        </button>
      )}
    </section>
  );
}

export default function ServiceDetail({ slug }: { slug: string }) {
  const { pollInterval } = useRealtime();
  const catalog = trpc.catalog.list.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  const mine = trpc.queue.myActive.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  if (catalog.isLoading) return <LoadingBlock rows={3} />;
  if (catalog.error)
    return (
      <ErrorState
        message={errorMessage(catalog.error)}
        onRetry={() => catalog.refetch()}
      />
    );
  const service = catalog.data!.services.find(s => s.slug === slug);
  if (!service) {
    return (
      <div className="panel">
        <EmptyState
          title="Service not available"
          description="This service doesn't exist or isn't open right now."
          action={
            <Link href="/app" className="button button-outline button-small">
              Back to services
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <>
      <Link href="/app" className="back-link">
        <ArrowLeft size={15} aria-hidden /> All services
      </Link>
      <PageHeader
        eyebrow="Campus service"
        title={service.name}
        subtitle={service.description}
        actions={<ServiceIcon kind={service.kind} size={22} />}
      />
      {service.notice && (
        <Callout tone="teal" icon={Info}>
          {service.notice}
        </Callout>
      )}
      <div className="group-grid">
        {service.groups.map(group => {
          const held = mine.data?.entries.find(
            entry => entry.group.id === group.id
          );
          return (
            <GroupPanel
              key={group.id}
              group={group}
              heldToken={
                held
                  ? { id: held.id, tokenNumber: held.tokenNumber }
                  : undefined
              }
            />
          );
        })}
      </div>
      <p className="fine-print">
        Wait times are estimates based on the people ahead of you, recent
        service times and current traffic. They are not appointments.
      </p>
    </>
  );
}
