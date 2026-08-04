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
import { formatReturnPct } from "./play-card-display";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { StatusPill } from "./DeckStatusBadges";

/** Compact single-row play card — status, symbol+strike, grade, times, return %. */
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

  const signClass = (n: number | null | undefined) =>
    n != null && n > 0 ? "nh-deck-pos" : n != null && n < 0 ? "nh-deck-neg" : undefined;

  const retLabel =
    phase === "watch" ? "Track" : phase === "closed" ? "Peak" : play.peak != null ? "Peak" : "P&L";

  return (
    <div className={clsx("nh-deck-lc-strip", `is-${phase}`, markFlash && "is-flash")}>
      {rank > 0 && (
        <span className="nh-deck-lc-strip-rank" aria-label={`Rank ${rank}`}>
          #{rank}
        </span>
      )}
      <StatusPill label={status.label} tone={status.tone} />
      <span className="nh-deck-lc-strip-symbol" title={playSymbolLine(play)}>
        {playSymbolLine(play)}
      </span>
      <ConfidenceBadge play={play} inline />
      <span className="nh-deck-lc-strip-time" title="Event time (ET)">
        {times ?? "—"}
      </span>
      <span className={clsx("nh-deck-lc-strip-ret", signClass(ret))} title={retLabel}>
        <span className="nh-deck-lc-strip-ret-lab">{retLabel}</span>
        <span className={clsx("nh-deck-lc-strip-ret-val", markFlash && ret != null && "neon")}>
          {ret != null ? formatReturnPct(ret) : "—"}
        </span>
      </span>
    </div>
  );
}
