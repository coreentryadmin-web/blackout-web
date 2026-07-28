"use client";

import type { CSSProperties, RefObject } from "react";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import {
  fmtHeatmapExpiry,
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  heatmapCellStyle,
  heatmapCellTextStyle,
} from "@/lib/gex-heatmap-display";
import {
  bandStrikesAroundSpot,
  compactMatrixPeak,
  nearestStrikeIndex,
  resolveCompactExpiries,
  resolveZeroDteExpiry,
} from "@/features/thermal/lib/thermal-compact-matrix";

/** Tall 0DTE heat strips (Bobby-style vertical ladders). */
export const THERMAL_COMPARE_STRIKE_HALF = 40;
/** Fallback when near-term multi-expiry mode is selected. */
export const THERMAL_COMPARE_MAX_EXPIRIES = 8;

export type ThermalCompareMode = "0dte" | "near";

export type ThermalCompactPayload = {
  ticker: string;
  spot?: number | null;
  strikes: number[];
  expiries: string[];
  nearTermExpiries?: string[] | null;
  cells: Record<string, Record<string, number>>;
};

type Props = {
  data: ThermalCompactPayload;
  lens: GexHeatmapLens;
  mode?: ThermalCompareMode;
  pinnedStrikes: number[];
  onTogglePin: (strike: number) => void;
  /** Spot-relative row index shared across SPY|SPX|QQQ for the synced cursor. */
  crosshairIndex?: number | null;
  onCrosshairIndex?: (index: number | null) => void;
  scrollRef?: RefObject<HTMLDivElement>;
  onScrollSync?: (scrollTop: number, scrollLeft: number) => void;
};

function todayEtYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Boost mid-band intensity so the strip reads as a heat ladder, not pale cells. */
function stripCellStyle(
  value: number,
  peak: number,
  lens: GexHeatmapLens,
): CSSProperties {
  const base = heatmapCellStyle(value, peak, lens);
  if (!value || peak <= 0) {
    return { backgroundColor: "rgba(15, 23, 42, 0.85)" };
  }
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = 0.22 + Math.pow(mag, 1.1) * 0.78;
  const bg = String(base.backgroundColor ?? "");
  const boosted = bg.replace(
    /rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/,
    (_, r, g, b) => `rgba(${r},${g},${b},${alpha.toFixed(3)})`,
  );
  return {
    ...base,
    backgroundColor: boosted || base.backgroundColor,
    boxShadow:
      mag > 0.35
        ? `inset 0 0 22px ${boosted.replace(/[\d.]+\)$/, `${(mag * 0.45).toFixed(2)})`)}`
        : base.boxShadow,
  };
}

export default function ThermalCompactMatrix({
  data,
  lens,
  mode = "0dte",
  pinnedStrikes,
  onTogglePin,
  crosshairIndex = null,
  onCrosshairIndex,
  scrollRef,
  onScrollSync,
}: Props) {
  const expiries =
    mode === "0dte"
      ? (() => {
          const zero = resolveZeroDteExpiry(
            data.nearTermExpiries,
            data.expiries,
            todayEtYmd(),
          );
          return zero ? [zero] : [];
        })()
      : resolveCompactExpiries(
          data.nearTermExpiries,
          data.expiries,
          THERMAL_COMPARE_MAX_EXPIRIES,
        );

  const strikes = bandStrikesAroundSpot(
    data.strikes,
    data.spot,
    THERMAL_COMPARE_STRIKE_HALF,
  );
  const spotIdx = nearestStrikeIndex(strikes, data.spot ?? null);
  const pinSet = new Set(pinnedStrikes);
  const peak = compactMatrixPeak(data.cells, strikes, expiries);
  const is0dte = mode === "0dte";

  if (expiries.length === 0 || strikes.length === 0) {
    return (
      <div className="thermal-compact-empty" role="status">
        Matrix empty — waiting for live cells.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={`thermal-compact-scroll${is0dte ? " is-0dte" : ""}`}
      onScroll={(e) => {
        if (!onScrollSync) return;
        const el = e.currentTarget;
        onScrollSync(el.scrollTop, el.scrollLeft);
      }}
      onMouseLeave={() => onCrosshairIndex?.(null)}
    >
      <table
        className={`thermal-compact-table${is0dte ? " is-0dte" : ""}`}
        aria-label={`${data.ticker} ${lens.toUpperCase()} ${is0dte ? "0DTE" : "near-term"} matrix`}
      >
        <thead>
          <tr>
            <th className="thermal-compact-corner" scope="col">
              Strike
            </th>
            {expiries.map((exp) => (
              <th key={exp} className="thermal-compact-exp" scope="col" title={exp}>
                {is0dte ? (
                  <>
                    <span className="thermal-compact-exp-chip">0DTE</span>
                    <span className="thermal-compact-exp-date">{fmtHeatmapExpiry(exp)}</span>
                  </>
                ) : (
                  fmtHeatmapExpiry(exp)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike, si) => {
            const isSpot = si === spotIdx;
            const pinned = pinSet.has(strike);
            const isCross = crosshairIndex === si;
            const row = data.cells[String(strike)] ?? {};
            return (
              <tr
                key={strike}
                className={[
                  "thermal-compact-row",
                  isSpot ? "is-spot" : "",
                  pinned ? "is-pinned" : "",
                  isCross ? "is-crosshair" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => onCrosshairIndex?.(si)}
              >
                <th scope="row" className="thermal-compact-strike">
                  <button
                    type="button"
                    className="thermal-compact-strike-btn"
                    onClick={() => onTogglePin(strike)}
                    title={pinned ? `Unpin ${strike}` : `Pin ${strike}`}
                    aria-pressed={pinned}
                  >
                    <span className="thermal-compact-pin" aria-hidden>
                      {pinned ? "◆" : "◇"}
                    </span>
                    {fmtHeatmapStrike(strike)}
                  </button>
                </th>
                {expiries.map((exp) => {
                  const val = row[exp];
                  const n = typeof val === "number" && Number.isFinite(val) ? val : 0;
                  const style: CSSProperties = {
                    ...(is0dte
                      ? stripCellStyle(n, peak, lens)
                      : heatmapCellStyle(n, peak, lens)),
                    ...heatmapCellTextStyle(n, peak),
                  };
                  return (
                    <td
                      key={`${strike}-${exp}`}
                      className="thermal-compact-cell"
                      style={style}
                      title={`${data.ticker} ${strike} ${exp} · ${lens.toUpperCase()} ${fmtHeatmapMoneySigned(n, { showZero: true })}`}
                    >
                      <span className="thermal-compact-cell-val">
                        {fmtHeatmapMoneySigned(n, { showZero: true })}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
