import { useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  LayoutDashboard,
  Menu,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { QueueStatus, Service } from "@/lib/demoStore";
import { trpc } from "@/lib/trpc";

export const navItems = [
  { href: "/student", label: "Live queues", icon: LayoutDashboard },
  { href: "/staff", label: "Staff console", icon: Activity },
  { href: "/camera", label: "Camera station", icon: Camera },
  { href: "/admin", label: "Insights", icon: Command },
];

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand-mark" aria-label="QueueSense home">
      <span className="brand-icon"><Zap size={16} fill="currentColor" /></span>
      {!compact && <span>Queue<span className="brand-accent">Sense</span></span>}
    </Link>
  );
}

export function AppShell({ children, active = "/student", onReset }: { children: React.ReactNode; active?: string; onReset?: () => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: backendStatus } = trpc.queue.status.useQuery(undefined, { staleTime: 30_000 });
  const current = active || location;
  const reset = () => {
    onReset?.();
    toast.success("Demo workspace reset", { description: "The Admissions queue is back to its starting state." });
    setMobileOpen(false);
  };

  return (
    <div className="app-frame">
      <aside className={`app-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-top">
          <BrandMark />
          <button className="icon-btn mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <div className="workspace-pill"><span className="live-dot" /> Demo workspace <ChevronRight size={13} /></div>
        <div className="side-label">Workspace</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = current === item.href || (item.href !== "/student" && current.startsWith(item.href));
            return <Link key={item.href} href={item.href} className={`side-link ${isActive ? "active" : ""}`} onClick={() => setMobileOpen(false)}><Icon size={18} /><span>{item.label}</span>{isActive && <span className="nav-active-dot" />}</Link>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <div className="privacy-icon"><ShieldCheck size={17} /></div>
          <div><strong>Privacy by design</strong><p>Video is processed locally. No footage or identities are stored.</p></div>
        </div>
        <button className="reset-link" onClick={reset}><RotateCcw size={15} /> Reset demo data</button>
        <div className="sidebar-footer"><span>QueueSense v0.1</span><span className="status-chip"><span className="live-dot" /> Live</span></div>
      </aside>
      {mobileOpen && <button className="mobile-overlay" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" />}
      <main className="app-main">
        <header className="topbar">
          <button className="icon-btn mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={21} /></button>
          <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.href === current)?.label ?? "QueueSense"}</strong></div>
          <div className="top-actions"><div className="sync-status"><span className="live-dot" /> {backendStatus ? `${backendStatus.storage} · API online` : "Connecting API…"}</div><button className="icon-btn notification-btn" aria-label="Notifications"><Bell size={18} /><span /></button><div className="avatar">SJ</div></div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export function PublicHeader() {
  return <header className="public-header"><BrandMark /><nav><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><Link href="/student">Live queues</Link></nav><div className="public-actions"><Link href="/student" className="button button-dark button-small">Open dashboard <ArrowRight size={15} /></Link></div></header>;
}

export function StatusBadge({ status }: { status: QueueStatus | Service["status"] }) {
  const label = status[0] + status.slice(1).toLowerCase();
  return <span className={`status-badge status-${status.toLowerCase()}`}><span className="status-dot" />{label}</span>;
}

export function MetricCard({ label, value, helper, icon: Icon, accent = "violet", trend }: { label: string; value: string | number; helper?: string; icon: typeof Users; accent?: string; trend?: string }) {
  return <div className={`metric-card accent-${accent}`}><div className="metric-card-top"><span className="metric-label">{label}</span><span className="metric-icon"><Icon size={17} /></span></div><div className="metric-value">{value}</div>{helper && <div className="metric-helper">{trend && <span className="trend-up">{trend}</span>}{helper}</div>}</div>;
}

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}

export function ServiceAccent({ service }: { service: Service }) {
  return <span className={`service-accent service-accent-${service.accent}`}><span /></span>;
}

export function EmptyState({ icon: Icon = CircleHelp, title, description }: { icon?: typeof CircleHelp; title: string; description: string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23} /></div><h3>{title}</h3><p>{description}</p></div>;
}

export function QueueProgress({ progress }: { progress: number }) {
  return <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} /></div>;
}

export function LivePill({ label = "Realtime" }: { label?: string }) {
  return <span className="live-pill"><span className="live-dot" /> {label}</span>;
}

export function Callout({ children, tone = "violet", icon: Icon = Sparkles }: { children: React.ReactNode; tone?: "violet" | "teal" | "orange"; icon?: typeof Sparkles }) {
  return <div className={`callout callout-${tone}`}><Icon size={18} /><span>{children}</span></div>;
}

export function TokenNumber({ token, large = false }: { token: string; large?: boolean }) {
  return <span className={`token-number ${large ? "token-large" : ""}`}><span className="token-prefix">{token.slice(0, 1)}</span>{token.slice(1)}</span>;
}

export function formatRelative(timestamp?: number) {
  if (!timestamp) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

export function KeyboardHint() {
  return <span className="keyboard-hint"><span>⌘</span>K</span>;
}

export function ClockLabel({ minutes }: { minutes: number }) {
  return <span className="clock-label"><Clock3 size={14} /> ~{minutes} min</span>;
}

export function PeopleLabel({ count }: { count: number }) {
  return <span className="people-label"><Users size={14} /> {count} {count === 1 ? "person" : "people"}</span>;
}

export function CheckLabel({ children }: { children: React.ReactNode }) {
  return <span className="check-label"><CheckCircle2 size={15} />{children}</span>;
}
