"use client";

import { useState } from "react";
import Link from "next/link";
import type { LargoAction } from "@/lib/largo/largo-actions";
import { updateLargoWatchlist } from "@/lib/api";
import {
  shouldIssueWatchlistRequest,
  watchlistButtonLabel,
  type WatchlistButtonStatus,
} from "@/features/largo/components/largo-watchlist-status";

export function LargoActionsBar({
  actions,
  sessionId,
  onWatchlistSaved,
}: {
  actions?: LargoAction[];
  sessionId?: string;
  onWatchlistSaved?: (ticker: string) => void;
}) {
  // Keyed by ticker (not action id) so the status for "Remember NVDA" is independent of any
  // other watchlist button that might render alongside it.
  const [statusByTicker, setStatusByTicker] = useState<Record<string, WatchlistButtonStatus>>({});

  if (!actions?.length) return null;

  return (
    <div className="largo-actions-bar" role="group" aria-label="Desk actions">
      {actions.map((a) => {
        if (a.href.startsWith("#watchlist:")) {
          const ticker = a.href.slice("#watchlist:".length);
          const status: WatchlistButtonStatus = statusByTicker[ticker] ?? "idle";
          return (
            <button
              key={a.id}
              type="button"
              className="largo-action-btn"
              aria-busy={status === "pending"}
              disabled={status === "pending"}
              onClick={() => {
                // Root cause of the original bug: this handler had no in-flight guard, no
                // `.catch()`, and never surfaced the result — a click fired a fire-and-forget
                // PATCH that could fail with nothing but an unhandled promise rejection in the
                // console, leaving the member believing the ticker was saved when it was not,
                // and a double-click fired two concurrent requests for the same ticker.
                if (!sessionId || !shouldIssueWatchlistRequest(status)) return;
                setStatusByTicker((prev) => ({ ...prev, [ticker]: "pending" }));
                updateLargoWatchlist(sessionId, ticker)
                  .then(() => {
                    setStatusByTicker((prev) => ({ ...prev, [ticker]: "saved" }));
                    onWatchlistSaved?.(ticker);
                  })
                  .catch(() => {
                    setStatusByTicker((prev) => ({ ...prev, [ticker]: "error" }));
                  });
              }}
            >
              {watchlistButtonLabel(a.label, status)}
            </button>
          );
        }
        return (
          <Link key={a.id} href={a.href} className="largo-action-btn">
            {a.label}
          </Link>
        );
      })}
    </div>
  );
}
