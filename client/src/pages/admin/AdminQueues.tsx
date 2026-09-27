import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  CounterBadge,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ServiceIcon,
  TrafficBadge,
} from "@/components/ui/primitives";
import { errorMessage } from "@/lib/errors";
import { approxMinutes } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";

export default function AdminQueues() {
  const { pollInterval } = useRealtime();
  const catalog = trpc.catalog.list.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  if (catalog.isLoading) return <LoadingBlock rows={4} />;
  if (catalog.error)
    return (
      <ErrorState
        message={errorMessage(catalog.error)}
        onRetry={() => catalog.refetch()}
      />
    );
  return (
    <>
      <PageHeader
        title="Live queues"
        subtitle="Every counter on campus. Administrators can operate any counter from the console."
      />
      {catalog.data!.services.map(service => (
        <section
          key={service.id}
          className="panel"
          aria-labelledby={`svc-${service.id}`}
        >
          <div className="panel-head">
            <div className="cell-with-icon">
              <ServiceIcon kind={service.kind} />
              <h2 id={`svc-${service.id}`}>{service.name}</h2>
            </div>
          </div>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label={`${service.name} counters`}
          >
            <table className="data-table stack">
              <thead>
                <tr>
                  <th scope="col">Queue and counter</th>
                  <th scope="col">Status</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Now serving</th>
                  <th scope="col">Wait if joined now</th>
                  <th scope="col">Traffic</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {service.groups.flatMap(group =>
                  group.counters.map(counter => (
                    <tr key={counter.id}>
                      <th scope="row">
                        {group.name} · <strong>{counter.name}</strong>{" "}
                        <small className="muted">({counter.tokenPrefix})</small>
                      </th>
                      <td data-label="Status">
                        <CounterBadge status={counter.status} />
                      </td>
                      <td data-label="Waiting">{counter.waiting}</td>
                      <td data-label="Now serving">
                        {counter.nowServing.join(", ") || "None"}
                      </td>
                      <td data-label="Wait if joined now">
                        {counter.status === "OPEN"
                          ? approxMinutes(counter.estimatedWaitSeconds)
                          : "—"}
                      </td>
                      <td data-label="Traffic">
                        <TrafficBadge
                          level={group.traffic.effectiveLevel}
                          label=""
                        />
                      </td>
                      <td>
                        <Link
                          href={`/staff/${counter.id}`}
                          className="button button-outline button-small"
                        >
                          Console <ArrowRight size={13} aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
