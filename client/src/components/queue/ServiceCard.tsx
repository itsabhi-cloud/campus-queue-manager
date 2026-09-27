import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { TrafficLevel } from "@shared/domain";
import { Chip, ServiceIcon, TrafficBadge } from "@/components/ui/primitives";
import { approxMinutes } from "@/lib/format";
import type { RouterOutputs } from "@/lib/trpc";

type CatalogService = RouterOutputs["catalog"]["list"]["services"][number];
const ORDER: TrafficLevel[] = ["NORMAL", "MODERATE", "HEAVY"];

function waitText(estimates: number[]) {
  if (estimates.length === 0) return "No estimate";
  const best = Math.min(...estimates);
  return best < 60
    ? "No wait right now"
    : `About ${approxMinutes(best).replace("~", "")} wait`;
}

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
  const traffic = service.groups.reduce<TrafficLevel>(
    (worst, g) =>
      ORDER.indexOf(g.traffic.effectiveLevel) > ORDER.indexOf(worst)
        ? g.traffic.effectiveLevel
        : worst,
    "NORMAL"
  );
  return (
    <Link href={`/app/services/${service.slug}`} className="service-card">
      <ServiceIcon kind={service.kind} large />
      <div>
        <h3>{service.name}</h3>
        <p>{service.groups.map(group => group.name).join(", ")}</p>
      </div>
      <ChevronRight size={20} aria-hidden />
      <div className="service-card-foot">
        {open === 0 ? (
          <Chip tone="danger">Closed now</Chip>
        ) : (
          <>
            <span className="num">{waiting} waiting</span>
            <span>{waitText(estimates)}</span>
            <TrafficBadge level={traffic} />
          </>
        )}
        {activeTokens.length > 0 && (
          <span className="held">You hold {activeTokens.join(", ")}</span>
        )}
      </div>
    </Link>
  );
}
