import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { children: ReactNode; fullPage?: boolean };
type State = { hasError: boolean };

/** Catches rendering errors so one broken panel never blanks the whole app. No stack traces are shown. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[QueueSense] UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        className={this.props.fullPage ? "fatal-error" : "error-state"}
        role="alert"
      >
        <AlertTriangle size={22} aria-hidden />
        <div>
          <strong>Something went wrong displaying this page.</strong>
          <p>
            Your queue position is safe — it lives on the server. Reload to
            continue.
          </p>
        </div>
        <button
          className="button button-outline button-small"
          onClick={() => window.location.reload()}
        >
          <RotateCcw size={14} aria-hidden /> Reload
        </button>
      </div>
    );
  }
}
