"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import {
  fmtHeatmapExpiry,
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  fmtStrikeDistancePct,
  heatmapCellStyle,
  heatmapCellTextStyle,
  heatmapMatrixExtremeCellStyle,
} from "@/lib/gex-heatmap-display";
import { scrollRowIntoViewCenter } from "@/features/spx/lib/spx-matrix-scroll";
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
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScrollSync?: (scrollTop: number, scrollLeft: number) => void;
  /**
   * Desk-level flag: while true, skip scroll-sync so each panel can center on its
   * own spot without yanking the other two to the wrong scrollTop.
   */
  suppressScrollSyncRef?: MutableRefObject<boolean>;
  /** Desk-level: user scrolled any panel — don't auto-yank until spot strike moves or refresh. */
  userPinnedScrollRef?: MutableRefObject<boolean>;
  /** Bumped by the rail Refresh control to force recenter after revalidate. */
  recenterEpoch?: number;
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

function centerSpotInBox(
  box: HTMLElement,
  row: HTMLElement,
  behavior: ScrollBehavior,
  suppressRef?: MutableRefObject<boolean>,
) {
  if (suppressRef) suppressRef.current = true;
  if (behavior === "smooth") {
    const scrollRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const target =
      box.scrollTop +
      (rowRect.top - scrollRect.top - (scrollRect.height - rowRect.height) / 2);
    const max = Math.max(0, box.scrollHeight - box.clientHeight);
    box.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior: "smooth" });
  } else {
    scrollRowIntoViewCenter(box, row);
  }
  // Keep sync suppressed through the scroll event + a layout frame so the
  // other panels keep their own spot-centered scrollTop.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (suppressRef) suppressRef.current = false;
    });
  });
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
  suppressScrollSyncRef,
  userPinnedScrollRef,
  recenterEpoch = 0,
}: Props) {
  const localScrollRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLTableRowElement | null>(null);
  const lastCenteredStrikeRef = useRef<number | null>(null);
  const lastRecenterEpochRef = useRef(recenterEpoch);

  const setScrollEl = (el: HTMLDivElement | null) => {
    localScrollRef.current = el;
    if (scrollRef) {
      (scrollRef as MutableRefObject<HTMLDivElement | null>).current = el;
    }
  };

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
  const spotStrike = spotIdx >= 0 ? strikes[spotIdx]! : null;
  const pinSet = new Set(pinnedStrikes);
  const peak = compactMatrixPeak(data.cells, strikes, expiries);
  const extremes = compactPerExpiryExtremes(data.cells, strikes, expiries);
  const is0dte = mode === "0dte";
  const hasData = expiries.length > 0 && strikes.length > 0;

  const centerSpotRow = (behavior: ScrollBehavior = "auto") => {
    const box = localScrollRef.current;
    const row = spotRowRef.current;
    if (box == null || row == null) return;
    centerSpotInBox(box, row, behavior, suppressScrollSyncRef);
  };

  // Mark desk scroll as user-pinned so quiet matrix refreshes don't yank the ladder.
  useEffect(() => {
    const box = localScrollRef.current;
    if (!box || !userPinnedScrollRef) return;
    const markPinned = () => {
      userPinnedScrollRef.current = true;
    };
    box.addEventListener("wheel", markPinned, { passive: true });
    box.addEventListener("touchmove", markPinned, { passive: true });
    box.addEventListener("pointerdown", markPinned, { passive: true });
    return () => {
      box.removeEventListener("wheel", markPinned);
      box.removeEventListener("touchmove", markPinned);
      box.removeEventListener("pointerdown", markPinned);
    };
  }, [hasData, userPinnedScrollRef]);

  // Auto-link to spot on visit / when the spot strike moves (Slayer parity).
  useLayoutEffect(() => {
    if (spotStrike == null || !hasData) return;

    const forced = lastRecenterEpochRef.current !== recenterEpoch;
    if (forced) lastRecenterEpochRef.current = recenterEpoch;

    const strikeMoved = lastCenteredStrikeRef.current !== spotStrike;
    if (strikeMoved) {
      if (userPinnedScrollRef) userPinnedScrollRef.current = false;
      lastCenteredStrikeRef.current = spotStrike;
    }

    if (!forced && userPinnedScrollRef?.current && !strikeMoved) return;

    const behavior: ScrollBehavior = forced || strikeMoved ? "smooth" : "auto";
    const run = () => centerSpotRow(behavior);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(run);
    });
    const t = window.setTimeout(run, 120);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
    // centerSpotRow closes over current refs; deps are the data that change centering.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: spot/mode/lens/epoch
  }, [spotStrike, hasData, lens, mode, strikes.length, recenterEpoch]);

  useEffect(() => {
    const box = localScrollRef.current;
    if (!box || spotStrike == null) return;
    const ro = new ResizeObserver(() => {
      if (userPinnedScrollRef?.current) return;
      centerSpotRow("auto");
    });
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotStrike, hasData]);

  if (!hasData) {
    return (
      <div className="thermal-compact-empty" role="status">
        Matrix empty — waiting for live cells.
      </div>
    );
  }

  return (
    <div
      ref={setScrollEl}
      className={`thermal-compact-scroll${is0dte ? " is-0dte" : ""}`}
      onScroll={(e) => {
        if (suppressScrollSyncRef?.current) return;
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
              <span className="thermal-compact-corner-strike">Strike</span>
              <span className="thermal-compact-corner-pct">%</span>
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
                ref={isSpot ? spotRowRef : undefined}
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
                    <span className="thermal-compact-strike-label">{fmtHeatmapStrike(strike)}</span>
                    {!isSpot ? (
                      <span className="thermal-compact-strike-pct" title="Distance from spot">
                        {fmtStrikeDistancePct(data.spot, strike)}
                      </span>
                    ) : null}
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
                        "thermal-compact-cell",
                        // Never reuse the major-matrix extreme pop class here —
                        // it is display:inline-block + scale(1.16), which tears
                        // table cells apart in the 5-column near-term desk.
                        isPosNode || isNegNode ? "thermal-compact-cell--extreme" : "",
                        isPosNode ? "is-pos-node" : "",
                        isNegNode ? "is-neg-node" : "",
                        isKing ? "is-king" : "",
                        !isPosNode && !isNegNode && n > 0 ? "is-pos" : "",
                        !isPosNode && !isNegNode && n < 0 ? "is-neg" : "",
                        !has || n === 0 ? "is-zero" : "",
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
                      <span className="thermal-compact-cell-val">
                        {fmtHeatmapMoneySigned(n, { showZero: true })}
                      </span>
                      {isKing ? (
                        <span
                          aria-hidden
                          className="thermal-compact-king"
                          title="King node"
                        >
                          ★
                        </span>
                      ) : null}
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
