import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import * as RadixDialog from "@radix-ui/react-dialog";
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
  Ticket,
  Upload,
  UserRound,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@shared/domain";
import { useAuth } from "@/hooks/useAuth";
import { initials } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { BrandMark } from "./BrandMark";
import { ConnectionBadge } from "./ui/primitives";

type NavItem = {
  href: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  exact?: boolean;
};

const NAV: Record<Role, Array<{ section: string; items: NavItem[] }>> = {
  STUDENT: [
    {
      section: "Queues",
      items: [
        {
          href: "/app",
          label: "My queues",
          short: "Queues",
          icon: Ticket,
          exact: true,
        },
        { href: "/app/history", label: "History", icon: History },
      ],
    },
    {
      section: "Account",
      items: [
        {
          href: "/notifications",
          label: "Notifications",
          short: "Alerts",
          icon: Bell,
        },
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
          label: "Services and counters",
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

function NavLinks({
  role,
  unread,
  onNavigate,
}: {
  role: Role;
  unread: number;
  onNavigate?: () => void;
}) {
  const [location] = useLocation();
  const isActive = (item: NavItem) =>
    item.exact
      ? location === item.href
      : location === item.href || location.startsWith(`${item.href}/`);
  return (
    <nav className="side-nav-groups" aria-label="Main">
      {NAV[role].map(section => (
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
                  onClick={onNavigate}
                >
                  <Icon size={18} aria-hidden />
                  <span>{item.label}</span>
                  {item.href === "/notifications" && unread > 0 && (
                    <span className="nav-count" aria-label={`${unread} unread`}>
                      {unread}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function BottomNav({ unread }: { unread: number }) {
  const [location] = useLocation();
  const items = NAV.STUDENT.flatMap(section => section.items);
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map(item => {
        const Icon = item.icon;
        const active = item.exact
          ? location === item.href
          : location.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} aria-hidden />
            {item.short ?? item.label}
            {item.href === "/notifications" && unread > 0 && (
              <span className="nav-count" aria-label={`${unread} unread`}>
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pollInterval } = useRealtime();
  const unreadQuery = trpc.notifications.unreadCount.useQuery(undefined, {
    enabled: user?.role === "STUDENT",
    refetchInterval: pollInterval,
  });
  if (!user) return null;
  const unread = unreadQuery.data?.count ?? 0;
  const student = user.role === "STUDENT";

  return (
    <div className={`app-frame ${student ? "has-bottom-nav" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="app-sidebar" aria-label="Sidebar">
        <BrandMark />
        <NavLinks role={user.role} unread={unread} />
        <div className="sidebar-footer">
          Signed in as {ROLE_LABEL[user.role].toLowerCase()}
        </div>
      </aside>

      <RadixDialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="drawer-overlay" />
          <RadixDialog.Content className="drawer" aria-describedby={undefined}>
            <div className="drawer-head">
              <BrandMark />
              <RadixDialog.Close className="icon-btn" aria-label="Close menu">
                <X size={18} />
              </RadixDialog.Close>
            </div>
            <RadixDialog.Title className="sr-only">Menu</RadixDialog.Title>
            <NavLinks
              role={user.role}
              unread={unread}
              onNavigate={() => setDrawerOpen(false)}
            />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>

      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-expanded={drawerOpen}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-title">{title}</div>
          <ConnectionBadge />
          {student && (
            <Link
              href="/notifications"
              className="icon-btn notification-btn hide-sm"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
            >
              <Bell size={18} />
              {unread > 0 && (
                <span className="bell-count" aria-hidden>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          )}
          {/* Named by its text (name, role) so the accessible name matches what's on screen.
              The initials are drawn by CSS and the text is only visually hidden on phones. */}
          <Link href="/profile" className="user-chip">
            <span
              className="avatar"
              data-initials={initials(user.name)}
              aria-hidden
            />
            <span className="user-chip-text">
              <strong>{user.name}</strong>
              <small>{ROLE_LABEL[user.role]}</small>
              <span className="sr-only">(your profile)</span>
            </span>
          </Link>
          <button
            className="icon-btn"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={17} />
          </button>
        </header>
        <main id="main" className="page-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      {student && <BottomNav unread={unread} />}
    </div>
  );
}
