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
  // Most urgent first: called, then being served, then fewest people ahead.
  const urgency = { CALLED: 0, SERVING: 1, WAITING: 2 } as const;
  const entries = [...(active.data?.entries ?? [])].sort(
    (a, b) =>
      urgency[a.status as keyof typeof urgency] -
        urgency[b.status as keyof typeof urgency] ||
      a.peopleAhead - b.peopleAhead
  );

  return (
    <>
      {/* The title stays the same once tokens load so the content below doesn't jump. */}
      <PageHeader
        title={`Hi ${firstName}`}
        subtitle={
          entries.length
            ? "Your place is held. Leave the line and come back when we call you."
            : "Take a token for a campus service, then get on with your day. We'll tell you when to come back."
        }
      />

      {/* One placeholder until both lists arrive; they then appear together instead of each
          section growing and pushing the next one down. */}
      {active.isLoading || catalog.isLoading ? (
        <LoadingBlock rows={3} label="Loading your queues" />
      ) : (
        <>
          <section className="section" aria-labelledby="active-heading">
            <div className="section-head">
              <h2 id="active-heading">Your tokens</h2>
            </div>
            {active.error ? (
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
            {catalog.error ? (
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
      )}
    </>
  );
}
