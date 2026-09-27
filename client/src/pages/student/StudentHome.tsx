import { useEffect } from "react";
import { TimerReset } from "lucide-react";
import { ServiceCard } from "@/components/queue/ServiceCard";
import { TokenTicket } from "@/components/queue/TokenTicket";
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
} from "@/components/ui/primitives";
import { useAuth } from "@/hooks/useAuth";
import { syncServerTime } from "@/lib/clock";
import { errorMessage } from "@/lib/errors";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";

export default function StudentHome() {
  const { user } = useAuth();
  const { pollInterval } = useRealtime();
  const active = trpc.queue.myActive.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  const catalog = trpc.catalog.list.useQuery(undefined, {
    refetchInterval: pollInterval,
  });
  useEffect(() => {
    if (active.data) syncServerTime(active.data.serverTime);
  }, [active.data]);
  const firstName = user?.name.split(" ")[0] ?? "there";
  const entries = active.data?.entries ?? [];

  return (
    <>
      <PageHeader
        title={
          entries.length
            ? `Hi ${firstName}, here's where you stand`
            : `Hi ${firstName}`
        }
        subtitle={
          entries.length
            ? "Your place is held. Leave the line and come back when we call you."
            : "Take a token for a campus service, then get on with your day. We'll tell you when to come back."
        }
      />

      <section className="section" aria-labelledby="active-heading">
        <div className="section-head">
          <h2 id="active-heading">Your tokens</h2>
        </div>
        {active.isLoading ? (
          <LoadingBlock rows={2} label="Loading your tokens" />
        ) : active.error ? (
          <ErrorState
            message={errorMessage(active.error)}
            onRetry={() => active.refetch()}
          />
        ) : entries.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={TimerReset}
              title="You're not in any queue"
              description="Pick a service below to reserve your place. You won't need to stand in line."
            />
          </div>
        ) : (
          <div className="token-grid">
            {entries.map(entry => (
              <TokenTicket key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="services-heading">
        <div className="section-head">
          <h2 id="services-heading">Campus services</h2>
        </div>
        {catalog.isLoading ? (
          <LoadingBlock rows={2} label="Loading services" />
        ) : catalog.error ? (
          <ErrorState
            message={errorMessage(catalog.error)}
            onRetry={() => catalog.refetch()}
          />
        ) : catalog.data!.services.length === 0 ? (
          <div className="panel">
            <EmptyState
              title="No services are open"
              description="Services appear here as soon as the administration opens them."
            />
          </div>
        ) : (
          <div className="service-list">
            {catalog.data!.services.map(service => (
              <ServiceCard
                key={service.id}
                service={service}
                activeTokens={entries
                  .filter(e => e.service.id === service.id)
                  .map(e => e.tokenNumber)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
