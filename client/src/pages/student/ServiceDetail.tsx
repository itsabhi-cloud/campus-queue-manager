import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowLeft, Info } from "lucide-react";
import { CameraSignal } from "@/components/queue/CameraSignal";
import {
  CounterBadge,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Note,
  PageHeader,
  ServiceIcon,
  TrafficBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { approxMinutes, unitNoun } from "@/lib/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import type { ServiceKind } from "@shared/domain";

const JOIN_LABEL: Record<ServiceKind, string> = {
  ADMINISTRATION: "Get a token",
  PRINTING: "Get a print token",
  CAFETERIA: "Reserve my place",
  ELEVATOR: "Join the boarding queue",
  OTHER: "Get a token",
};
import { useRealtime } from "@/realtime/RealtimeProvider";

type Group =
  RouterOutputs["catalog"]["list"]["services"][number]["groups"][number];

function counterDetail(group: Group, counter: Group["counters"][number]) {
  if (counter.status === "OPEN") {
    const serving = counter.nowServing.length
      ? `, serving ${counter.nowServing.join(", ")}`
      : "";
    return `${counter.waiting} waiting, ${approxMinutes(counter.estimatedWaitSeconds)}${serving}`;
  }
  if (counter.mergedIntoCounterId)
    return `Moved to ${group.counters.find(c => c.id === counter.mergedIntoCounterId)?.name ?? "another counter"}`;
  return counter.statusReason ?? "Not taking tokens";
}

function GroupPanel({
  group,
  kind,
  heldToken,
}: {
  group: Group;
  kind: ServiceKind;
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
      void utils.queue.myActive.invalidate();
      void utils.catalog.list.invalidate();
      navigate(`/app/tokens/${result.entryId}?joined=1`);
    },
    onError: error => toast.error(errorMessage(error)),
  });
  const canJoin = openCounters.length > 0 && !heldToken;
  const chosen =
    choice === "auto" ? null : group.counters.find(c => c.id === choice);
  const estimate = chosen
    ? chosen.estimatedWaitSeconds
    : group.estimatedWaitSeconds;

  return (
    <section
      className="panel group-panel"
      aria-labelledby={`group-${group.id}`}
    >
      <div className="group-panel-head">
        <div>
          <h2 id={`group-${group.id}`}>{group.name}</h2>
          {kind === "ELEVATOR" && (
            <p className="group-kind">Virtual boarding queue</p>
          )}
          {group.description && <p>{group.description}</p>}
        </div>
        <dl className="group-estimate">
          <dt>
            {kind === "ELEVATOR"
              ? "Estimated wait to board"
              : "If you join now"}
          </dt>
          <dd className="num">
            {estimate === null ? "Closed" : approxMinutes(estimate)}
          </dd>
        </dl>
      </div>
      <div className="signals">
        <span className="num">
          {group.waiting} {unitNoun(group.unitLabel, group.waiting)} waiting
        </span>
        <TrafficBadge
          level={group.traffic.effectiveLevel}
          label={kind === "ELEVATOR" ? "traffic estimate" : "traffic"}
        />
        {group.traffic.delaySeconds > 0 && (
          <span>
            +{Math.round(group.traffic.delaySeconds / 60)} min
            {group.traffic.reason ? `: ${group.traffic.reason}` : ""}
          </span>
        )}
        {group.serveCapacity > 1 && (
          <span>Boards up to {group.serveCapacity} at a time</span>
        )}
        <CameraSignal camera={group.camera} />
      </div>

      <fieldset className="counter-choices" disabled={!canJoin}>
        <legend className="sr-only">Choose a counter for {group.name}</legend>
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
              <small>We'll put you in the shortest line</small>
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
              <small>{counterDetail(group, counter)}</small>
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
          You hold {heldToken.tokenNumber}. View your place
        </Link>
      ) : (
        <button
          className="button button-primary button-large button-full"
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
              : JOIN_LABEL[kind]}
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
          title="This service isn't available"
          description="It doesn't exist or isn't open right now."
          action={
            <Link href="/app" className="button button-outline">
              See all services
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <>
      <Link href="/app" className="back-link">
        <ArrowLeft size={16} aria-hidden /> All services
      </Link>
      <PageHeader
        title={service.name}
        subtitle={service.description}
        actions={
          <span className="hide-sm">
            <ServiceIcon kind={service.kind} large />
          </span>
        }
      />
      {service.notice && (
        <Note icon={Info}>
          <strong>What QueueSense does here.</strong> {service.notice}
        </Note>
      )}
      <div className="group-grid">
        {service.groups.map(group => {
          const held = mine.data?.entries.find(
            entry => entry.group.id === group.id
          );
          return (
            <GroupPanel
              kind={service.kind}
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
        service times and current traffic. They aren't appointments.
      </p>
    </>
  );
}
