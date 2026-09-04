import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

/* Boot-time error boundary (incident 2026-09-05 b6afb5a): a render crash
   anywhere in the app previously left #root empty — a silent blank screen
   with no error boundary to surface it. This boundary catches the FIRST
   (boot) render failure and shows the message + stack instead, so a broken
   deploy is visible instantly and never unmounts the app silently. */
class FatalBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal-error" role="alert">
          <div className="fatal-error-inner">
            <div className="fatal-error-title">Something went wrong</div>
            <div className="fatal-error-message">{String(this.state.error?.message || this.state.error)}</div>
            {this.state.error?.stack ? <pre className="fatal-error-stack">{this.state.error.stack}</pre> : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(
  <FatalBoundary>
    <App />
  </FatalBoundary>,
);