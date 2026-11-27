import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { loneText, primaryButton, secondaryButton } from "./ui";

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
        <div className="px-4 py-16 max-w-xl mx-auto text-center animate-in fade-in">
          <AlertTriangle className="w-7 h-7 text-negative mx-auto mb-4" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="font-display text-xl md:text-2xl font-semibold text-main break-words">
            {this.props.fallbackTitle || "Something went wrong in this view"}
          </h2>
          <p className={`${loneText} mt-3 max-w-md mx-auto break-words`}>
            {this.state.error?.message || "An unexpected error occurred while rendering this view."}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className={secondaryButton}
            >
              Try again
            </button>
            <button
              onClick={this.handleReset}
              className={primaryButton}
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
