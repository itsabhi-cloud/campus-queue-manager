import { useEffect } from "react";
import {
  Bell,
  CheckCircle2,
  MapPin,
  Radio,
  Ticket,
  TimerReset,
} from "lucide-react";
import { ActiveTokenCard } from "@/components/queue/ActiveTokenCard";
import { ServiceCard } from "@/components/queue/ServiceCard";
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

const JOURNEY = [
  { icon: Ticket, label: "Get token" },
  { icon: MapPin, label: "Leave the line" },
  { icon: Radio, label: "Watch position" },
  { icon: Bell, label: "Get alerted" },
  { icon: CheckCircle2, label: "Arrive & finish" },
];

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

  return (
    <>
      <PageHeader
        eyebrow="Student"
        title={`Hi, ${firstName}.`}
        subtitle="Take a token, get on with your day, and we'll tell you when it's your turn."
      />
      <ol className="journey-strip" aria-label="How QueueSense works">
        {JOURNEY.map(({ icon: Icon, label }) => (
          <li key={label}>
            <Icon size={15} aria-hidden /> {label}
          </li>
        ))}
      </ol>

      <section aria-labelledby="active-heading" className="page-section">
        <div className="section-mini-heading">
          <div>
            <div className="eyebrow">Right now</div>
            <h2 id="active-heading">My active queues</h2>
          </div>
        </div>
        {active.isLoading ? (
          <LoadingBlock rows={2} />
        ) : active.error ? (
          <ErrorState
            message={errorMessage(active.error)}
            onRetry={() => active.refetch()}
          />
        ) : active.data!.entries.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={TimerReset}
              title="No active tokens"
              description="Choose a campus service below to reserve your place — you won't need to stand in line."
            />
          </div>
        ) : (
          <div className="token-grid">
            {active.data!.entries.map(entry => (
              <ActiveTokenCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="services-heading" className="page-section">
        <div className="section-mini-heading">
          <div>
            <div className="eyebrow">Choose a destination</div>
            <h2 id="services-heading">Campus services</h2>
          </div>
        </div>
        {catalog.isLoading ? (
          <LoadingBlock rows={2} />
        ) : catalog.error ? (
          <ErrorState
            message={errorMessage(catalog.error)}
            onRetry={() => catalog.refetch()}
          />
        ) : catalog.data!.services.length === 0 ? (
          <div className="panel">
            <EmptyState
              title="No services are open"
              description="Check back later — services appear here as soon as the administration opens them."
            />
          </div>
        ) : (
          <div className="service-grid service-grid-4">
            {catalog.data!.services.map(service => (
              <ServiceCard
                key={service.id}
                service={service}
                activeTokens={(active.data?.entries ?? [])
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
