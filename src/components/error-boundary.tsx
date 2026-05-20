/**
 * React Error Boundary
 * 
 * Catches unhandled errors in the component tree and displays a fallback UI.
 * Prevents the entire app from crashing due to component errors.
 * 
 * Usage: Wrap your app or route components
 * <ErrorBoundary>
 *   <YourApp />
 * </ErrorBoundary>
 */

import React from "react";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console in development
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);

    // Call optional error handler (e.g., for logging to Sentry)
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // TODO: Add error logging service integration (Sentry, LogRocket, etc.)
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md space-y-6 text-center">
            {/* Error icon */}
            <div className="flex justify-center">
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
              </div>
            </div>

            {/* Error message */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">
                Something went wrong
              </h1>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred. You can try reloading the page or return to the home screen.
              </p>
            </div>

            {/* Error details (development only) */}
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details className="rounded-lg border border-border bg-muted p-4 text-left">
                <summary className="cursor-pointer text-sm font-medium">
                  Error details (dev only)
                </summary>
                <pre className="mt-3 overflow-auto text-xs text-muted-foreground">
                  {this.state.error.name}: {this.state.error.message}
                  {"\n\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                onClick={this.handleReset}
                variant="outline"
                className="flex-1"
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Try again
              </Button>
              <Button
                onClick={this.handleGoHome}
                variant="default"
                className="flex-1"
              >
                <Home className="mr-2 h-4 w-4" />
                Go home
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
