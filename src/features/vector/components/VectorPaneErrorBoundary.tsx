"use client";

import { Component, type ReactNode } from "react";

type Props = {
  /** Shown in the fallback so the member knows which pane broke without losing the others. */
  ticker: string;
  /** Compare mode can drop a broken pane outright; the single-pane desk has nothing to remove. */
  onRemove?: () => void;
  children: ReactNode;
};

type State = { hasError: boolean };

/**
 * Per-pane isolation for Vector's Compare mode. Without this, an uncaught render error thrown by
 * ANY one pane (a bad ticker, a malformed live payload reaching an overlay that assumes a shape) —
 * unmounts the entire `(site)` route segment via the app-level error boundary, taking the other
 * (working) panes and the desk chrome down with it. React error boundaries can only be class
 * components (no hook equivalent), so this mirrors the existing `SpxPanelErrorBoundary` pattern
 * (`SpxDashboard.tsx`) rather than inventing a new one.
 *
 * Deliberately narrow: this catches RENDER errors in the wrapped subtree only (React's own
 * boundary contract — it does not catch async/event-handler throws, which this pane's own
 * `.catch()`-guarded fetches already handle separately). A key remount (Compare mode keys each
 * pane by ticker) resets `hasError` automatically should the same ticker somehow re-render clean.
 */
export class VectorPaneErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console -- surfacing which pane broke is the whole point here
    console.error(`[vector-compare] pane render error for ${this.props.ticker}:`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="vector-pane-error flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center font-mono text-xs text-amber-300/90">
          <span>{this.props.ticker} pane failed to render.</span>
          <span className="text-white/40">The other panes are unaffected.</span>
          {this.props.onRemove ? (
            <button
              type="button"
              onClick={this.props.onRemove}
              className="mt-1 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] uppercase tracking-wide text-amber-300 hover:bg-amber-400/20"
            >
              Remove pane
            </button>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}
