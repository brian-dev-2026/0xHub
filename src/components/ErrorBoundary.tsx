import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Catches render crashes anywhere below it and shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="app-bg" />
        <div className="glass max-w-md rounded-3xl p-8">
          <div className="text-4xl">🧱💥</div>
          <h1 className="mt-4 text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-400">
            The page hit an unexpected error. Your account and saved progress are safe on the server.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
            <button className="btn btn-ghost" onClick={() => location.assign("/")}>Go to dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
