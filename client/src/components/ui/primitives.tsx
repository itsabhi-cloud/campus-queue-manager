import {
  Children,
  cloneElement,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  Bell,
  Building2,
  Check,
  CircleHelp,
  Clock3,
  Coffee,
  Pause,
  Play,
  PowerOff,
  Printer,
  RefreshCw,
  Redo2,
  X,
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

// ---------------------------------------------------------------- Chips

export type ChipTone =
  | "brand"
  | "waiting"
  | "called"
  | "serving"
  | "done"
  | "go"
  | "warn"
  | "danger"
  | "muted"
  | "outline";

/** The single badge component. Pass an icon so meaning never depends on colour alone. */
export function Chip({
  tone = "muted",
  icon: IconCmp,
  children,
}: {
  tone?: ChipTone;
  icon?: Icon;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip-${tone}`}>
      {IconCmp && <IconCmp aria-hidden strokeWidth={2.5} />}
      {children}
    </span>
  );
}

const STATUS_CHIP: Record<QueueStatus, { tone: ChipTone; icon: Icon }> = {
  WAITING: { tone: "waiting", icon: Clock3 },
  CALLED: { tone: "called", icon: Bell },
  SERVING: { tone: "serving", icon: Play },
  COMPLETED: { tone: "done", icon: Check },
  SKIPPED: { tone: "warn", icon: Redo2 },
  CANCELLED: { tone: "danger", icon: X },
};

export function StatusBadge({ status }: { status: QueueStatus }) {
  const { tone, icon } = STATUS_CHIP[status];
  return (
    <Chip tone={tone} icon={icon}>
      {STATUS_LABEL[status]}
    </Chip>
  );
}

const COUNTER_CHIP: Record<CounterStatus, { tone: ChipTone; icon: Icon }> = {
  OPEN: { tone: "go", icon: Check },
  PAUSED: { tone: "warn", icon: Pause },
  OFFLINE: { tone: "danger", icon: PowerOff },
};

export function CounterBadge({ status }: { status: CounterStatus }) {
  const { tone, icon } = COUNTER_CHIP[status];
  return (
    <Chip tone={tone} icon={icon}>
      {COUNTER_LABEL[status]}
    </Chip>
  );
}

/** Three bars plus a word: readable without colour. */
export function TrafficBadge({
  level,
  label = "traffic",
}: {
  level: TrafficLevel;
  label?: string;
}) {
  return (
    <span className={`traffic traffic-${level.toLowerCase()}`}>
      <span className="traffic-bars" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {TRAFFIC_LABEL[level]}
      {label ? ` ${label}` : ""}
    </span>
  );
}

export function TokenNumber({
  token,
  className = "",
}: {
  token: string;
  className?: string;
}) {
  return (
    <span className={`display ${className}`} aria-label={`Token ${token}`}>
      {token}
    </span>
  );
}

// ---------------------------------------------------------------- Stats

export function StatStrip({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <dl className="stat-strip" aria-label={label}>
      {children}
    </dl>
  );
}

export function Stat({
  label,
  value,
  helper,
  alert = false,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={`stat ${alert ? "is-alert" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {helper && <dd className="stat-helper">{helper}</dd>}
    </div>
  );
}

// ---------------------------------------------------------------- Surfaces

export function Note({
  children,
  tone = "neutral",
  icon: IconCmp = CircleHelp,
}: {
  children: ReactNode;
  tone?: "neutral" | "warn" | "go";
  icon?: Icon;
}) {
  return (
    <div
      className={`note ${tone === "neutral" ? "" : `note-${tone}`}`}
      role="note"
    >
      <IconCmp size={18} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function PanelHead({
  title,
  description,
  actions,
  as: Heading = "h2",
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
  id?: string;
}) {
  return (
    <div className="panel-head">
      <div>
        <Heading id={id}>{title}</Heading>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- States

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
      <IconCmp size={28} aria-hidden />
      <h2 className="empty-title">{title}</h2>
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
        <strong>This didn't load.</strong>
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
  radius = 6,
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
          height={i === 0 ? 28 : 72}
          width={i === 0 ? "36%" : "100%"}
          radius={i === 0 ? 6 : 12}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Live data

/** Countdown derived from the server's estimate. Always an estimate, never an appointment. */
export function Countdown({
  seconds,
  updatedAt,
  paused = false,
}: {
  seconds: number;
  updatedAt: Date | string;
  paused?: boolean;
}) {
  const remaining = useRemainingSeconds(seconds, updatedAt);
  if (paused) return <span className="countdown is-paused">Paused</span>;
  return (
    <span className="countdown num">
      {remaining <= 30 ? "Soon" : countdownLabel(remaining)}
    </span>
  );
}

export function ConnectionBadge() {
  const { state } = useRealtime();
  const label =
    state === "live"
      ? "Live"
      : state === "connecting"
        ? "Connecting"
        : state === "reconnecting"
          ? "Reconnecting"
          : "Offline";
  return (
    <span
      className={`connection connection-${state}`}
      role="status"
      aria-live="polite"
      title={
        state === "live"
          ? "Receiving live updates"
          : "Live updates paused — refreshing every 20 seconds"
      }
    >
      <span className="connection-dot" aria-hidden />
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

export function ServiceIcon({
  kind,
  size = 18,
  large = false,
}: {
  kind: ServiceKind;
  size?: number;
  large?: boolean;
}) {
  const IconCmp = SERVICE_ICON[kind];
  return (
    <span className={`service-icon ${large ? "is-large" : ""}`} aria-hidden>
      <IconCmp size={large ? 24 : size} />
    </span>
  );
}

// ---------------------------------------------------------------- Forms

/** Label, hint and error for one control. Wires aria-describedby / aria-invalid onto the control. */
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
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const control = Children.only(children);
  const wired = isValidElement(control)
    ? cloneElement(control as ReactElement<Record<string, unknown>>, {
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : control;
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {wired}
      {error ? (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
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
      <span className="num">
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
