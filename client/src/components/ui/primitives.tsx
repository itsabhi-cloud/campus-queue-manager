import type { ComponentType, ReactNode } from "react";
import {
  AlertTriangle,
  Building2,
  CircleHelp,
  Coffee,
  Printer,
  RefreshCw,
  ArrowUpDown,
  Sparkles,
  Wifi,
  WifiOff,
  type LucideProps,
} from "lucide-react";
import type {
  CounterStatus,
  QueueStatus,
  ServiceKind,
  TrafficLevel,
} from "@shared/domain";
import { useRemainingSeconds } from "@/lib/clock";
import {
  COUNTER_LABEL,
  countdownLabel,
  STATUS_LABEL,
  TRAFFIC_LABEL,
} from "@/lib/format";
import { useRealtime } from "@/realtime/RealtimeProvider";

type Icon = ComponentType<LucideProps>;

export function StatusBadge({ status }: { status: QueueStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      <span className="status-dot" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CounterBadge({ status }: { status: CounterStatus }) {
  const cls =
    status === "OPEN"
      ? "status-open"
      : status === "PAUSED"
        ? "status-paused"
        : "status-cancelled";
  return (
    <span className={`status-badge ${cls}`}>
      <span className="status-dot" aria-hidden />
      {COUNTER_LABEL[status]}
    </span>
  );
}

export function TrafficBadge({
  level,
  label = "Traffic",
}: {
  level: TrafficLevel;
  label?: string;
}) {
  return (
    <span className={`traffic-badge traffic-${level.toLowerCase()}`}>
      <span className="traffic-bars" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {label}: {TRAFFIC_LABEL[level]}
    </span>
  );
}

export function TokenNumber({
  token,
  large = false,
}: {
  token: string;
  large?: boolean;
}) {
  const match = token.match(/^([A-Z]+)(\d+)$/);
  return (
    <span
      className={`token-number ${large ? "token-large" : ""}`}
      aria-label={`Token ${token}`}
    >
      {match ? (
        <>
          <span className="token-prefix">{match[1]}</span>
          {match[2]}
        </>
      ) : (
        token
      )}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  helper,
  icon: IconCmp,
  accent = "violet",
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  icon: Icon;
  accent?: "violet" | "teal" | "orange" | "blue";
}) {
  return (
    <div className={`metric-card accent-${accent}`}>
      <div className="metric-card-top">
        <span className="metric-label">{label}</span>
        <span className="metric-icon" aria-hidden>
          <IconCmp size={17} />
        </span>
      </div>
      <div className="metric-value">{value}</div>
      {helper && <div className="metric-helper">{helper}</div>}
    </div>
  );
}

export function Callout({
  children,
  tone = "violet",
  icon: IconCmp = Sparkles,
}: {
  children: ReactNode;
  tone?: "violet" | "teal" | "orange";
  icon?: Icon;
}) {
  return (
    <div className={`callout callout-${tone}`} role="note">
      <IconCmp size={18} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({
  icon: IconCmp = CircleHelp,
  title,
  description,
  action,
}: {
  icon?: Icon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        <IconCmp size={23} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={20} aria-hidden />
      <div>
        <strong>We couldn't load this.</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button
          className="button button-outline button-small"
          onClick={onRetry}
        >
          <RefreshCw size={14} aria-hidden /> Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({
  height = 16,
  width = "100%",
  radius = 8,
}: {
  height?: number;
  width?: number | string;
  radius?: number;
}) {
  return (
    <span
      className="skeleton"
      style={{ height, width, borderRadius: radius }}
      aria-hidden
    />
  );
}

export function LoadingBlock({
  rows = 3,
  label = "Loading",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="loading-block" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          height={i === 0 ? 28 : 64}
          width={i === 0 ? "40%" : "100%"}
          radius={12}
        />
      ))}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-intro-row">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="intro-actions">{actions}</div>}
    </div>
  );
}

/** Live countdown derived from the server's estimate. It is an estimate, never an appointment. */
export function Countdown({
  seconds,
  updatedAt,
  paused = false,
  size = "md",
}: {
  seconds: number;
  updatedAt: Date | string;
  paused?: boolean;
  size?: "md" | "lg";
}) {
  const remaining = useRemainingSeconds(seconds, updatedAt);
  if (paused)
    return (
      <span className={`countdown countdown-${size} is-paused`}>Paused</span>
    );
  return (
    <span className={`countdown countdown-${size}`} aria-live="off">
      {remaining <= 30 ? "Any moment" : countdownLabel(remaining)}
    </span>
  );
}

export function ConnectionBadge() {
  const { state } = useRealtime();
  const label =
    state === "live"
      ? "Live"
      : state === "connecting"
        ? "Connecting…"
        : state === "reconnecting"
          ? "Reconnecting…"
          : "Offline";
  return (
    <span
      className={`connection-badge connection-${state}`}
      role="status"
      aria-live="polite"
      title={
        state === "live"
          ? "Receiving live updates"
          : "Live updates paused — refreshing every 20 seconds"
      }
    >
      {state === "offline" ? (
        <WifiOff size={13} aria-hidden />
      ) : (
        <Wifi size={13} aria-hidden />
      )}
      {label}
    </span>
  );
}

export const SERVICE_ICON: Record<ServiceKind, Icon> = {
  ADMINISTRATION: Building2,
  PRINTING: Printer,
  CAFETERIA: Coffee,
  ELEVATOR: ArrowUpDown,
  OTHER: CircleHelp,
};

export const SERVICE_ACCENT: Record<
  ServiceKind,
  "violet" | "blue" | "orange" | "teal"
> = {
  ADMINISTRATION: "violet",
  PRINTING: "blue",
  CAFETERIA: "orange",
  ELEVATOR: "teal",
  OTHER: "violet",
};

export function ServiceIcon({
  kind,
  size = 18,
}: {
  kind: ServiceKind;
  size?: number;
}) {
  const IconCmp = SERVICE_ICON[kind];
  return (
    <span
      className={`service-icon service-icon-${SERVICE_ACCENT[kind]}`}
      aria-hidden
    >
      <IconCmp size={size} />
    </span>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <small className="field-error" role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field-hint">{hint}</small>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {total === 0
          ? "No results"
          : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}
      </span>
      <div>
        <button
          className="button button-outline button-small"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <button
          className="button button-outline button-small"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: ReactNode }>;
  label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(item => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
