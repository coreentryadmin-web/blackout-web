"use client";

/**
 * Suggested plays card — renders call/put pair derived from GEX walls + expected move.
 * Positioned in the earnings report to offer immediate tactical setup without requiring
 * a full options chain lookup.
 */

import type { SuggestedPlay } from "@/lib/meridian/meridian-play-suggestions";

type Props = {
  play: SuggestedPlay;
};

export function MeridianSuggestedPlays({ play }: Props) {
  return (
    <div className="mr-panel mr-panel-plays">
      <span className="mr-panel-title">Suggested positions</span>

      <div className="mrsp-pair">
        {/* Primary leg (directional thesis). */}
        <div className="mrsp-leg mrsp-leg-primary">
          <div className="mrsp-leg-header">
            <span className="mrsp-leg-label">
              {play.primary_side === "C" ? "Call" : "Put"} · {play.primary_strike}
            </span>
            <span className="mrsp-leg-positioning">{play.positioning_pct}%</span>
          </div>
          <p className="mrsp-leg-thesis">{play.thesis}</p>
          <p className="mrsp-leg-expiry">Exp: {play.expiry}</p>
        </div>

        {/* Hedge leg (cross-directional). */}
        <div className="mrsp-leg mrsp-leg-hedge">
          <div className="mrsp-leg-header">
            <span className="mrsp-leg-label">
              {play.hedge_side === "C" ? "Call" : "Put"} · {play.hedge_strike}
            </span>
            <span className="mrsp-leg-type">Hedge</span>
          </div>
          <p className="mrsp-leg-note">Cross-directional insurance</p>
          <p className="mrsp-leg-expiry">Exp: {play.expiry}</p>
        </div>
      </div>

      <div className="mrsp-note">
        ◈ Strikes sourced from GEX wall positioning. Sizing and management pending your market view.
      </div>
    </div>
  );
}
