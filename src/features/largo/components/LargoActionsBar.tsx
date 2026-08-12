"use client";

import Link from "next/link";
import type { LargoAction } from "@/lib/largo/largo-actions";
import { updateLargoWatchlist } from "@/lib/api";

export function LargoActionsBar({
  actions,
  sessionId,
  onWatchlistSaved,
}: {
  actions?: LargoAction[];
  sessionId?: string;
  onWatchlistSaved?: (ticker: string) => void;
}) {
  if (!actions?.length) return null;

  return (
    <div className="largo-actions-bar" role="group" aria-label="Desk actions">
      {actions.map((a) => {
        if (a.href.startsWith("#watchlist:")) {
          const ticker = a.href.slice("#watchlist:".length);
          return (
            <button
              key={a.id}
              type="button"
              className="largo-action-btn"
              onClick={() => {
                if (!sessionId) return;
                void updateLargoWatchlist(sessionId, ticker).then(() => onWatchlistSaved?.(ticker));
              }}
            >
              {a.label}
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
