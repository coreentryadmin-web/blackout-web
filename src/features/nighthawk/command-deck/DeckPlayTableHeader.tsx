"use client";

/** Column header row — aligns with lifecycle play grid cells below. */
export function DeckPlayTableHeader() {
  return (
    <div className="nh-deck-play-table-head nh-deck-play-grid" role="row">
      <span className="nh-deck-play-th nh-deck-play-cell--rank" role="columnheader">
        #
      </span>
      <span className="nh-deck-play-th nh-deck-play-cell--status" role="columnheader">
        Status
      </span>
      <span className="nh-deck-play-th nh-deck-play-cell--play" role="columnheader">
        Play
      </span>
      <span className="nh-deck-play-th nh-deck-play-cell--rating" role="columnheader">
        Rating
      </span>
      <span className="nh-deck-play-th nh-deck-play-cell--time" role="columnheader">
        Time
      </span>
      <span className="nh-deck-play-th nh-deck-play-cell--pnl" role="columnheader">
        PnL
      </span>
    </div>
  );
}
