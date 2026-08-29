"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import {
  playLifecyclePhase,
  playListReturnPct,
  playStatusDisplay,
  playSymbolLine,
  playTimeRangeCompact,
  zeroDteActionDisplay,
} from "./play-card-lifecycle";
import { formatReturnPct, playGradeLabel, playQualityPct, tierStars } from "./play-card-display";
import { StatusPill } from "./DeckStatusBadges";

/** L/S direction chip — omitted on a condor row, where "direction" doesn't apply (a credit
 *  spread profits from decay/range, not a directional move — see CondorCardChip). */
function DirectionChip({ play }: { play: TerminalPlay }) {
  if (play.isCondor) return null;
  const long = play.direction === "LONG";
  return (
    <span className={clsx("nh-deck-dir-chip", long ? "long" : "short")} aria-label={long ? "Long" : "Short"}>
      {long ? "L" : "S"}
    </span>
  );
}

/** Discovery-origin dot — which scan surfaced this play (FLOW/BREAKOUT/PIN). Shows only the
 *  FIRST origin as a compact dot (the full list is in the detail panel's badge row on click —
 *  the row stays scannable, the detail stays complete); omitted when the play carries none. */
function OriginDot({ play }: { play: TerminalPlay }) {
  const origins = play.discoveryOrigin;
  if (!origins || origins.length === 0) return null;
  const primary = origins[0]!.toLowerCase();
  return (
    <span
      className={clsx("nh-deck-origin-dot", `is-${primary}`)}
      title={`Discovered via ${origins.join(", ")}`}
      aria-hidden
    />
  );
}

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
  // ACTION vocabulary ("what should I do?") when real fields support it — HOLD/TRIM {%}/EXIT/
  // RUNNER on OPEN 0DTE rows, TARGET/STOPPED/EOD EXIT on CLOSED ones — else the honest coarse
  // ACTIVE/WATCH/CLOSED/PASSED lifecycle pill (see zeroDteActionDisplay's own doc for why WATCH
  // and 3 of the 6 CLOSED labels are deliberately never fabricated here).
  const status = zeroDteActionDisplay(play) ?? playStatusDisplay(play.status);
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
        <DirectionChip play={play} />
        {playSymbolLine(play)}
        <OriginDot play={play} />
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
