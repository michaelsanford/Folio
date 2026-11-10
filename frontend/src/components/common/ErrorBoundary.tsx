import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-xl mx-auto my-12 rounded-xl bg-surface border border-default text-center animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-negative mx-auto mb-3" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="text-base font-medium text-main">
            {this.props.fallbackTitle || "Something went wrong in this view"}
          </h2>
          <p className="text-sm text-muted mt-2 max-w-md mx-auto">
            {this.state.error?.message || "An unexpected error occurred while rendering this view."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="h-9 px-4 rounded-lg border border-default bg-surface bg-surface-hover text-main text-sm font-medium transition-colors cursor-pointer"
            >
              Try again
            </button>
            <button
              onClick={this.handleReset}
              className="h-9 px-4 flex items-center gap-2 rounded-lg bg-accent-main hover:bg-accent-main text-accent-contrast text-sm font-medium transition-colors active:scale-[0.98] cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" strokeWidth={1.5} />
              <span>Reload app</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
