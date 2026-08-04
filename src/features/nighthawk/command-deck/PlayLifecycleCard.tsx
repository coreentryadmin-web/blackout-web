"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import {
  playLifecyclePhase,
  playListReturnPct,
  playStatusDisplay,
  playSymbolLine,
  playTimeRangeCompact,
} from "./play-card-lifecycle";
import { formatReturnPct, playGradeLabel, playQualityPct, tierStars } from "./play-card-display";
import { StatusPill } from "./DeckStatusBadges";

/** Table-row play card — columns align under DeckPlayTableHeader. */
export function PlayLifecycleCardBody({
  play,
  rank,
  nowMs: _nowMs,
  hero: _hero = false,
  markFlash = false,
}: {
  play: TerminalPlay;
  rank: number;
  nowMs: number;
  hero?: boolean;
  markFlash?: boolean;
}) {
  const phase = playLifecyclePhase(play.status);
  const status = playStatusDisplay(play.status);
  const ret = playListReturnPct(play);
  const times = playTimeRangeCompact(play);
  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  const stars = tierStars(play.tierLabel);

  const signClass = (n: number | null | undefined) =>
    n != null && n > 0 ? "nh-deck-pos" : n != null && n < 0 ? "nh-deck-neg" : undefined;

  return (
    <div
      className={clsx("nh-deck-lc-strip nh-deck-play-grid", `is-${phase}`, markFlash && "is-flash")}
      role="row"
    >
      <span className="nh-deck-play-cell nh-deck-play-cell--rank" aria-label={`Rank ${rank}`} role="cell">
        {rank > 0 ? `#${rank}` : "—"}
      </span>
      <span className="nh-deck-play-cell nh-deck-play-cell--status" role="cell">
        <StatusPill label={status.label} tone={status.tone} />
      </span>
      <span className="nh-deck-play-cell nh-deck-play-cell--play" title={playSymbolLine(play)} role="cell">
        {playSymbolLine(play)}
      </span>
      <span className="nh-deck-play-cell nh-deck-play-cell--rating" role="cell">
        {grade != null && (
          <span className="nh-deck-play-grade" aria-label={`Grade ${grade}`}>
            {grade}
          </span>
        )}
        {stars.length > 0 && (
          <span className="nh-deck-play-stars" aria-hidden>
            {stars}
          </span>
        )}
        {quality != null && (
          <span className="nh-deck-play-score" aria-label={`Score ${quality}`}>
            {quality}
          </span>
        )}
        {grade == null && quality == null && <span className="nh-deck-play-empty">—</span>}
      </span>
      <span className="nh-deck-play-cell nh-deck-play-cell--time" title="Event time (ET)" role="cell">
        {times ?? "—"}
      </span>
      <span
        className={clsx("nh-deck-play-cell nh-deck-play-cell--pnl", signClass(ret))}
        role="cell"
      >
        <span className={clsx("nh-deck-play-pnl", markFlash && ret != null && "neon")}>
          {ret != null ? formatReturnPct(ret) : "—"}
        </span>
      </span>
    </div>
  );
}
