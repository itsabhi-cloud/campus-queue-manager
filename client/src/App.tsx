import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Landing from "./pages/Landing";
import StudentDashboard from "./pages/StudentDashboard";
import StaffDashboard from "./pages/StaffDashboard";
import CameraStation from "./pages/CameraStation";
import AdminDashboard from "./pages/AdminDashboard";

function Router() {
  return <Switch>
    <Route path="/" component={Landing} />
    <Route path="/student" component={StudentDashboard} />
    <Route path="/staff" component={StaffDashboard} />
    <Route path="/camera" component={CameraStation} />
    <Route path="/admin" component={AdminDashboard} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster position="top-right" /><Router /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
