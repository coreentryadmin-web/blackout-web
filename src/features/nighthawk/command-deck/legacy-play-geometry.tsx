"use client";

import { clsx } from "clsx";
import type { DeckStatus, TerminalPlay } from "./types";

/**
 * Pure zone-label logic for the progress gauge, extracted so the WATCH/SKIP framing can be unit
 * tested without rendering the component (see legacy-play-geometry.test.ts).
 *
 * `progress` is computed unconditionally by `overlayLegacyQuotes` for every status — WATCH/SKIP
 * included — because the stock-vs-[stop,target] gauge is legitimately useful context even before
 * a position exists. But the two EXTREME-zone labels ("cut the position" / "take profit") are
 * live-position command language: they instruct closing or trimming a trade. That instruction is
 * only correct once a position actually exists to act on (OPEN/HOLD/TRIM/CLOSED). For a WATCH or
 * SKIP play there is no open position — the stock merely sits beyond where a hypothetical entry's
 * stop/target band would put it — so those two branches are reworded to describe the setup's own
 * standing instead of issuing a trade instruction. The three middle-zone labels describe the gauge
 * itself, not an action, so they apply unchanged regardless of status.
 */
export function legacyZoneLabel(progress: number | null | undefined, status: DeckStatus): string | null {
  if (progress == null) return null;
  const hasLivePosition = status !== "WATCH" && status !== "SKIP";
  if (progress <= 0) {
    return hasLivePosition ? "below stop — cut the position" : "already below stop — would be invalidated";
  }
  if (progress >= 1) {
    return hasLivePosition ? "at/above target — take profit" : "already at/above target before entry";
  }
  if (progress < 0.3) return "near stop — elevated risk";
  if (progress > 0.7) return "nearing target — watch for exit";
  return "mid-range — hold per plan";
}

/** Legacy entry geometry — structured levels + live stock-price progress track. */
export function LegacyManageGeometry({ play }: { play: TerminalPlay }) {
  const target = play.targetLevel ? parseFloat(play.targetLevel.replace(/[^0-9.]/g, "")) : null;
  const stop = play.stopLevel ? parseFloat(play.stopLevel.replace(/[^0-9.]/g, "")) : null;
  const spot = play.stockPrice;

  const distTarget =
    spot != null && target != null && Number.isFinite(target) && spot > 0
      ? { pct: ((target - spot) / spot) * 100, dollars: target - spot }
      : null;
  const distStop =
    spot != null && stop != null && Number.isFinite(stop) && spot > 0
      ? { pct: ((stop - spot) / spot) * 100, dollars: stop - spot }
      : null;

  const entryNums = play.entryRange?.match(/[\d.]+/g)?.map(Number).filter(Number.isFinite) ?? [];
  const entryMid =
    entryNums.length >= 2
      ? (entryNums[0]! + entryNums[entryNums.length - 1]!) / 2
      : entryNums.length === 1
        ? entryNums[0]!
        : null;
  const isLong = play.direction === "LONG";
  const entryFrac =
    stop != null && target != null && target !== stop && entryMid != null
      ? isLong
        ? Math.max(0, Math.min(1, (entryMid - stop) / (target - stop)))
        : Math.max(0, Math.min(1, (stop - entryMid) / (stop - target)))
      : null;

  const zoneLabel = spot != null ? legacyZoneLabel(play.progress, play.status) : null;

  return (
    <>
      {(play.entryRange || play.targetLevel || play.stopLevel) && (
        <div className="nh-deck-grid" style={{ marginBottom: 8 }}>
          {play.stopLevel && (
            <div>
              <span className="k">Stop</span>
              <span className="v nh-deck-neg">
                {play.stopLevel}
                {distStop && (
                  <span className="nh-deck-dist">
                    {" "}
                    ({distStop.dollars >= 0 ? "+" : ""}
                    {distStop.dollars.toFixed(2)} / {distStop.pct >= 0 ? "+" : ""}
                    {distStop.pct.toFixed(1)}%)
                  </span>
                )}
              </span>
            </div>
          )}
          {play.entryRange && (
            <div>
              <span className="k">Entry zone</span>
              <span className="v">{play.entryRange}</span>
            </div>
          )}
          {play.targetLevel && (
            <div>
              <span className="k">Target</span>
              <span className="v nh-deck-pos">
                {play.targetLevel}
                {distTarget && (
                  <span className="nh-deck-dist">
                    {" "}
                    ({distTarget.dollars >= 0 ? "+" : ""}
                    {distTarget.dollars.toFixed(2)} / {distTarget.pct >= 0 ? "+" : ""}
                    {distTarget.pct.toFixed(1)}%)
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
      {play.progress != null && (
        <>
          <div className="nh-deck-track">
            <span className="lo">STOP</span>
            <span className="hi">TARGET</span>
            {entryFrac != null && (
              <span
                className="nh-deck-entry-zone"
                style={{ left: `${Math.round(entryFrac * 100)}%` }}
                title="Entry zone midpoint"
              />
            )}
            <span className="mk" style={{ left: `${Math.round(play.progress * 100)}%` }} />
          </div>
          <div className="nh-deck-recnote">
            {spot != null ? `${play.ticker} $${spot.toFixed(2)} — ` : ""}
            {zoneLabel ?? "stock position vs your stop and target levels."}
          </div>
        </>
      )}
    </>
  );
}
