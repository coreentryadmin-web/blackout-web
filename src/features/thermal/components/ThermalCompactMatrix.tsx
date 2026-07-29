"use client";

import type { CSSProperties, RefObject } from "react";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import {
  fmtHeatmapExpiry,
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  heatmapCellStyle,
  heatmapCellTextStyle,
  heatmapMatrixExtremeCellStyle,
} from "@/lib/gex-heatmap-display";
import {
  bandStrikesAroundSpot,
  compactMatrixPeak,
  compactPerExpiryExtremes,
  nearestStrikeIndex,
  resolveCompactExpiries,
  resolveZeroDteExpiry,
} from "@/features/thermal/lib/thermal-compact-matrix";

/** Tall heat strips — readable like the major matrix. */
export const THERMAL_COMPARE_STRIKE_HALF = 36;
/** Near-term mode: five session days per ticker (SPY|SPX|QQQ), close cells. */
export const THERMAL_COMPARE_MAX_EXPIRIES = 5;

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

/**
 * Green (+) / red (−) heat — same lens RGB as the major matrix, boosted alpha
 * so the 0DTE strip reads as a ladder (never viridis / purple-yellow scale).
 */
function signedHeatStyle(
  value: number,
  peak: number,
  lens: GexHeatmapLens,
  boost: boolean,
): CSSProperties {
  const base = heatmapCellStyle(value, peak, lens);
  if (!value || peak <= 0) {
    return boost ? { backgroundColor: "rgba(8, 12, 22, 0.9)" } : {};
  }
  if (!boost) return base;
  const mag = Math.min(1, Math.abs(value) / peak);
  const alpha = 0.18 + Math.pow(mag, 1.15) * 0.8;
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
        ? `inset 0 0 22px ${boosted.replace(/[\d.]+\)$/, `${(mag * 0.42).toFixed(2)})`)}`
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
  const extremes = compactPerExpiryExtremes(data.cells, strikes, expiries);
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
        className={`thermal-compact-table${is0dte ? " is-0dte" : ""} font-mono text-[13px] tabular-nums`}
        aria-label={`${data.ticker} ${lens.toUpperCase()} ${is0dte ? "0DTE" : "near-term"} matrix`}
      >
        <thead>
          <tr>
            <th className="thermal-compact-corner text-[11px]" scope="col">
              Strike
            </th>
            {expiries.map((exp) => (
              <th
                key={exp}
                className="thermal-compact-exp text-[11px]"
                scope="col"
                title={exp}
              >
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
                    className="thermal-compact-strike-btn text-[13px] font-bold"
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
                  const has = typeof val === "number" && Number.isFinite(val);
                  const n = has ? val : 0;
                  const day = extremes[exp];
                  const isPosNode = has && day?.callWall === strike;
                  const isNegNode = has && day?.putWall === strike;
                  const isKing = has && n !== 0 && day?.king === strike;

                  const style: CSSProperties = has
                    ? isPosNode
                      ? heatmapMatrixExtremeCellStyle("positive")
                      : isNegNode
                        ? heatmapMatrixExtremeCellStyle("negative")
                        : {
                            ...signedHeatStyle(n, peak, lens, is0dte),
                            ...heatmapCellTextStyle(n, peak),
                          }
                    : {};

                  return (
                    <td
                      key={`${strike}-${exp}`}
                      className={[
                        "thermal-compact-cell whitespace-nowrap px-1 py-1 text-center font-bold",
                        isPosNode || isNegNode ? "gex-heatmap-extreme-pop" : "",
                        !isPosNode && !isNegNode && n > 0 ? "text-emerald-300" : "",
                        !isPosNode && !isNegNode && n < 0 ? "text-rose-300" : "",
                        !has || n === 0 ? "text-sky-300/40" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={style}
                      title={
                        isPosNode
                          ? `+ node (call wall) · ${fmtHeatmapMoneySigned(n, { showZero: true })}`
                          : isNegNode
                            ? `− node (put wall) · ${fmtHeatmapMoneySigned(n, { showZero: true })}`
                            : isKing
                              ? `King node · ${fmtHeatmapMoneySigned(n, { showZero: true })}`
                              : `${data.ticker} ${strike} ${exp} · ${lens.toUpperCase()} ${fmtHeatmapMoneySigned(n, { showZero: true })}`
                      }
                    >
                      <span className="thermal-compact-cell-val text-[13px] font-bold">
                        {fmtHeatmapMoneySigned(n, { showZero: true })}
                        {isKing ? (
                          <span
                            aria-hidden
                            className="ml-0.5 inline-block text-[13px] leading-none text-amber-400 [text-shadow:0_0_6px_rgba(251,191,36,0.9)]"
                          >
                            ★
                          </span>
                        ) : null}
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
