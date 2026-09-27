import {
  lazy,
  Suspense,
  useEffect,
  type ComponentType,
  type ReactNode,
} from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { Toaster } from "sonner";
import type { Role } from "@shared/domain";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AppShell } from "./components/AppShell";
import { LoadingBlock } from "./components/ui/primitives";
import { HOME_FOR_ROLE, useAuth } from "./hooks/useAuth";
import { RealtimeProvider } from "./realtime/RealtimeProvider";
import Landing from "./pages/Landing";
import Login from "./pages/auth/Login";
import Activate from "./pages/auth/Activate";
import NotFoundPage from "./pages/NotFoundPage";

// Role areas are split into separate chunks; the camera page pulls in TensorFlow.js only when opened.
const StudentHome = lazy(() => import("./pages/student/StudentHome"));
const ServiceDetail = lazy(() => import("./pages/student/ServiceDetail"));
const TokenDetail = lazy(() => import("./pages/student/TokenDetail"));
const History = lazy(() => import("./pages/student/History"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Profile = lazy(() => import("./pages/Profile"));
const StaffConsole = lazy(() => import("./pages/staff/StaffConsole"));
const CameraStation = lazy(() => import("./pages/staff/CameraStation"));
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminQueues = lazy(() => import("./pages/admin/AdminQueues"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers"));
const AdminImport = lazy(() => import("./pages/admin/AdminImport"));
const AdminCatalog = lazy(() => import("./pages/admin/AdminCatalog"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));

/** UX-only route guard. Every API call is authorised again on the server. */
function Protected({
  roles,
  title,
  children,
}: {
  roles: Role[];
  title: string;
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  useEffect(() => {
    document.title = `${title} · QueueSense`;
  }, [title]);
  if (loading) {
    return (
      <div className="page-loading">
        <LoadingBlock rows={3} />
      </div>
    );
  }
  if (!user)
    return <Redirect to={`/login?next=${encodeURIComponent(location)}`} />;
  if (!roles.includes(user.role))
    return <Redirect to={HOME_FOR_ROLE[user.role]} />;
  return (
    <AppShell title={title}>
      <AppErrorBoundary>
        <Suspense fallback={<LoadingBlock rows={3} />}>{children}</Suspense>
      </AppErrorBoundary>
    </AppShell>
  );
}

// Route params are passed straight through as props (e.g. /app/tokens/:id → { id }).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = (roles: Role[], title: string, Component: ComponentType<any>) =>
  function Guarded(props: { params: Record<string, string> }) {
    return (
      <Protected roles={roles} title={title}>
        <Component {...props.params} />
      </Protected>
    );
  };

const ALL: Role[] = ["STUDENT", "STAFF", "ADMIN"];
const STAFFISH: Role[] = ["STAFF", "ADMIN"];

function Routes() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/activate" component={Activate} />
      <Route
        path="/app"
        component={page(["STUDENT"], "My queues", StudentHome)}
      />
      <Route
        path="/app/services/:slug"
        component={page(["STUDENT"], "Service", ServiceDetail)}
      />
      <Route
        path="/app/tokens/:id"
        component={page(["STUDENT"], "Token", TokenDetail)}
      />
      <Route
        path="/app/history"
        component={page(["STUDENT"], "History", History)}
      />
      <Route
        path="/notifications"
        component={page(ALL, "Notifications", Notifications)}
      />
      <Route path="/profile" component={page(ALL, "Profile", Profile)} />
      <Route
        path="/staff"
        component={page(STAFFISH, "Counter console", StaffConsole)}
      />
      <Route
        path="/staff/:counterId"
        component={page(STAFFISH, "Counter console", StaffConsole)}
      />
      <Route
        path="/camera"
        component={page(STAFFISH, "Camera station", CameraStation)}
      />
      <Route
        path="/admin"
        component={page(["ADMIN"], "Overview", AdminOverview)}
      />
      <Route
        path="/admin/queues"
        component={page(["ADMIN"], "Live queues", AdminQueues)}
      />
      <Route
        path="/admin/users"
        component={page(["ADMIN"], "People", AdminUsers)}
      />
      <Route
        path="/admin/import"
        component={page(["ADMIN"], "Import students", AdminImport)}
      />
      <Route
        path="/admin/services"
        component={page(["ADMIN"], "Services & counters", AdminCatalog)}
      />
      <Route
        path="/admin/audit"
        component={page(["ADMIN"], "Audit log", AdminAudit)}
      />
      <Route
        path="/admin/settings"
        component={page(["ADMIN"], "Settings", AdminSettings)}
      />
      <Route component={NotFoundPage} />
    </Switch>
  );
}

export default function App() {
  const { user } = useAuth();
  return (
    <AppErrorBoundary fullPage>
      <RealtimeProvider enabled={Boolean(user)}>
        <Toaster
          position="top-right"
          closeButton
          richColors={false}
          toastOptions={{ className: "qs-toast" }}
        />
        <Routes />
      </RealtimeProvider>
    </AppErrorBoundary>
  );
}
