import { Link } from "wouter";
import { ArrowRight, Clock3, Ticket, Users } from "lucide-react";
import { ServiceIcon, TrafficBadge } from "@/components/ui/primitives";
import { approxMinutes } from "@/lib/format";
import type { RouterOutputs } from "@/lib/trpc";
import type { TrafficLevel } from "@shared/domain";

type CatalogService = RouterOutputs["catalog"]["list"]["services"][number];

const ORDER: TrafficLevel[] = ["NORMAL", "MODERATE", "HEAVY"];

export function ServiceCard({
  service,
  activeTokens,
}: {
  service: CatalogService;
  activeTokens: string[];
}) {
  const waiting = service.groups.reduce((sum, group) => sum + group.waiting, 0);
  const open = service.groups.reduce(
    (sum, group) => sum + group.openCounters,
    0
  );
  const estimates = service.groups
    .map(group => group.estimatedWaitSeconds)
    .filter((v): v is number => v !== null);
  const worstTraffic = service.groups.reduce<TrafficLevel>(
    (worst, group) =>
      ORDER.indexOf(group.traffic.effectiveLevel) > ORDER.indexOf(worst)
        ? group.traffic.effectiveLevel
        : worst,
    "NORMAL"
  );
  return (
    <Link href={`/app/services/${service.slug}`} className="service-card">
      <div className="service-card-head">
        <ServiceIcon kind={service.kind} />
        {open === 0 ? (
          <span className="status-badge status-cancelled">Closed</span>
        ) : (
          <TrafficBadge level={worstTraffic} />
        )}
      </div>
      <h3>{service.name}</h3>
      <p>{service.description}</p>
      <div className="service-card-metrics">
        <span>
          <Users size={14} aria-hidden /> {waiting} waiting
        </span>
        <span>
          <Clock3 size={14} aria-hidden />{" "}
          {estimates.length
            ? `from ${approxMinutes(Math.min(...estimates))}`
            : "—"}
        </span>
        <span>{open} open</span>
      </div>
      <div className="service-card-bottom">
        <span>
          {activeTokens.length ? (
            <>
              <Ticket size={14} aria-hidden /> You hold{" "}
              {activeTokens.join(", ")}
            </>
          ) : (
            <>{service.groups.map(group => group.name).join(" · ")}</>
          )}
        </span>
        <ArrowRight size={16} aria-hidden />
      </div>
    </Link>
  );
}
