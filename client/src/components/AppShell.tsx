import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Bell,
  Camera,
  ClipboardList,
  History,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Ticket,
  Upload,
  UserRound,
  Users,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@shared/domain";
import { useAuth } from "@/hooks/useAuth";
import { initials } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { ConnectionBadge } from "./ui/primitives";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

const NAV: Record<Role, Array<{ section: string; items: NavItem[] }>> = {
  STUDENT: [
    {
      section: "Queues",
      items: [
        { href: "/app", label: "My queues", icon: Ticket, exact: true },
        { href: "/app/history", label: "History", icon: History },
      ],
    },
    {
      section: "Account",
      items: [
        { href: "/notifications", label: "Notifications", icon: Bell },
        { href: "/profile", label: "Profile", icon: UserRound },
      ],
    },
  ],
  STAFF: [
    {
      section: "Operations",
      items: [
        { href: "/staff", label: "Counter console", icon: Activity },
        { href: "/camera", label: "Camera station", icon: Camera },
      ],
    },
    {
      section: "Account",
      items: [{ href: "/profile", label: "Profile", icon: UserRound }],
    },
  ],
  ADMIN: [
    {
      section: "Operations",
      items: [
        {
          href: "/admin",
          label: "Overview",
          icon: LayoutDashboard,
          exact: true,
        },
        { href: "/admin/queues", label: "Live queues", icon: ListOrdered },
        { href: "/staff", label: "Counter console", icon: Activity },
        { href: "/camera", label: "Camera station", icon: Camera },
      ],
    },
    {
      section: "Management",
      items: [
        { href: "/admin/users", label: "People", icon: Users },
        { href: "/admin/import", label: "Import students", icon: Upload },
        {
          href: "/admin/services",
          label: "Services & counters",
          icon: Workflow,
        },
        { href: "/admin/audit", label: "Audit log", icon: ClipboardList },
        { href: "/admin/settings", label: "Settings", icon: Settings2 },
      ],
    },
    {
      section: "Account",
      items: [{ href: "/profile", label: "Profile", icon: UserRound }],
    },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: "Student",
  STAFF: "Staff",
  ADMIN: "Administrator",
};

export function BrandMark() {
  return (
    <Link href="/" className="brand-mark" aria-label="QueueSense home">
      <span className="brand-icon" aria-hidden>
        <Zap size={16} fill="currentColor" />
      </span>
      <span>
        Queue<span className="brand-accent">Sense</span>
      </span>
    </Link>
  );
}

export function AppShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pollInterval } = useRealtime();
  const unread = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: user?.role === "STUDENT",
    refetchInterval: pollInterval,
  });
  if (!user) return null;
  const sections = NAV[user.role];
  const isActive = (item: NavItem) =>
    item.exact
      ? location === item.href
      : location === item.href || location.startsWith(`${item.href}/`);

  return (
    <div className="app-frame">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside
        className={`app-sidebar ${mobileOpen ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="sidebar-top">
          <BrandMark />
          <button
            className="icon-btn mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-pill">
          <span className="live-dot" aria-hidden /> {ROLE_LABEL[user.role]}{" "}
          workspace
        </div>
        <nav className="side-nav-groups">
          {sections.map(section => (
            <div key={section.section}>
              <div className="side-label">{section.section}</div>
              <div className="side-nav">
                {section.items.map(item => {
                  const Icon = item.icon;
                  const active = isActive(item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`side-link ${active ? "active" : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMobileOpen(false)}
                    >
                      <Icon size={18} aria-hidden />
                      <span>{item.label}</span>
                      {item.href === "/notifications" &&
                        (unread.data?.count ?? 0) > 0 && (
                          <span className="nav-count">
                            {unread.data!.count}
                          </span>
                        )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <div className="privacy-icon" aria-hidden>
            <ShieldCheck size={17} />
          </div>
          <div>
            <strong>Privacy by design</strong>
            <p>
              Cameras count people locally. No footage, faces or identities are
              stored.
            </p>
          </div>
        </div>
        <div className="sidebar-footer">
          <span>QueueSense 2.0</span>
          <ConnectionBadge />
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>{ROLE_LABEL[user.role]}</span>
            <span aria-hidden>/</span>
            <strong>{title}</strong>
          </div>
          <div className="top-actions">
            <span className="hide-sm">
              <ConnectionBadge />
            </span>
            {user.role === "STUDENT" && (
              <Link
                href="/notifications"
                className="icon-btn notification-btn"
                aria-label={`Notifications${unread.data?.count ? `, ${unread.data.count} unread` : ""}`}
              >
                <Bell size={18} />
                {(unread.data?.count ?? 0) > 0 && (
                  <span className="bell-count">
                    {unread.data!.count > 9 ? "9+" : unread.data!.count}
                  </span>
                )}
              </Link>
            )}
            <Link
              href="/profile"
              className="user-chip"
              aria-label="Your profile"
            >
              <span className="avatar" aria-hidden>
                {initials(user.name)}
              </span>
              <span className="user-chip-text">
                <strong>{user.name}</strong>
                <small>{ROLE_LABEL[user.role]}</small>
              </span>
            </Link>
            <button
              className="icon-btn"
              onClick={() => void logout()}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <main id="main" className="page-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
