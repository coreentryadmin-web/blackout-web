"use client";

import { clsx } from "clsx";
import type { DeckSortMode } from "./deck-sort";

/** Column header row — sortable Status / Rating / Time / PnL align with play grid below. */
export function DeckPlayTableHeader({
  sortMode,
  setSortMode,
}: {
  sortMode: DeckSortMode;
  setSortMode: (mode: DeckSortMode) => void;
}) {
  const sortBtn = (mode: DeckSortMode, label: string, className: string, title?: string) => (
    <button
      type="button"
      role="columnheader"
      className={clsx("nh-deck-play-th nh-deck-play-th--sort", sortMode === mode && "is-on", className)}
      aria-sort={sortMode === mode ? "descending" : "none"}
      aria-label={title ?? `Sort by ${label}`}
      onClick={() => setSortMode(mode)}
    >
      {label}
    </button>
  );

  return (
    <div className="nh-deck-play-table-head nh-deck-play-grid" role="row">
      <span className="nh-deck-play-th nh-deck-play-cell--rank" role="columnheader">
        #
      </span>
      {sortBtn("status", "Status", "nh-deck-play-cell--status", "Sort by status band")}
      <span className="nh-deck-play-th nh-deck-play-cell--play" role="columnheader">
        Play
      </span>
      {sortBtn("rating", "Rating", "nh-deck-play-cell--rating", "Sort by rating")}
      {sortBtn("time", "Time", "nh-deck-play-cell--time", "Sort by triggered time")}
      {sortBtn("peak", "PnL", "nh-deck-play-cell--pnl", "Sort by peak return")}
    </div>
  );
}
