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
              <h3 id={`svc-${service.id}`}>{service.name}</h3>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Queue · counter</th>
                  <th scope="col">Status</th>
                  <th scope="col">Waiting</th>
                  <th scope="col">Now serving</th>
                  <th scope="col">New joiner wait</th>
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
                      <td>
                        <CounterBadge status={counter.status} />
                      </td>
                      <td>{counter.waiting}</td>
                      <td>{counter.nowServing.join(", ") || "—"}</td>
                      <td>
                        {counter.status === "OPEN"
                          ? approxMinutes(counter.estimatedWaitSeconds)
                          : "—"}
                      </td>
                      <td>
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
