"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type RefObject,
} from "react";
import {
  fmtHeatmapExpiry,
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  fmtStrikeDistancePct,
  shouldShowStrikeDistancePct,
  isHeatmapTopHighlightRank,
  resolveHeatmapTopHighlightCellStyle,
  type GexHeatmapLens,
} from "@/lib/gex-heatmap-display";
import { scrollRowIntoViewCenter } from "@/features/spx/lib/spx-matrix-scroll";
import {
  bandStrikesAroundSpot,
  compactMatrixPeak,
  compactPerExpiryExtremes,
  compactPerExpiryTopHighlights,
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
  /** Matrix snapshot spot — drives ATM row highlight + scroll (5s cadence). */
  spot?: number | null;
  /**
   * Spot for % distance labels — defaults to `spot`. Compare grid passes the
   * live header quote (push ?? matrix) so % drifts with the visible price
   * between matrix refreshes; GEX cells still update on the matrix cadence.
   */
  labelSpot?: number | null;
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
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Per-column: user scrolled this panel — skip auto-recenter until spot moves or refresh. */
  userPinnedScrollRef?: MutableRefObject<boolean>;
  /** Bumped by the toolbar Refresh control to force recenter after revalidate. */
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

function centerSpotInBox(box: HTMLElement, row: HTMLElement, behavior: ScrollBehavior) {
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
}

export default function ThermalCompactMatrix({
  data,
  lens,
  mode = "0dte",
  pinnedStrikes,
  onTogglePin,
  scrollRef,
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
  const pctSpot = data.labelSpot ?? data.spot ?? null;
  const pctSpotIdx = nearestStrikeIndex(strikes, pctSpot);
  const spotStrike = spotIdx >= 0 ? strikes[spotIdx]! : null;
  const pinSet = new Set(pinnedStrikes);
  const peak = compactMatrixPeak(data.cells, strikes, expiries);
  const extremes = compactPerExpiryExtremes(data.cells, strikes, expiries);
  const topHighlights = compactPerExpiryTopHighlights(data.cells, strikes, expiries);
  const is0dte = mode === "0dte";
  const hasData = expiries.length > 0 && strikes.length > 0;

  const centerSpotRow = (behavior: ScrollBehavior = "auto") => {
    const box = localScrollRef.current;
    const row = spotRowRef.current;
    if (box == null || row == null) return;
    centerSpotInBox(box, row, behavior);
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
            {is0dte ? (
              <th className="thermal-compact-exp is-0dte-spacer" scope="col" aria-hidden />
            ) : (
              expiries.map((exp) => (
                <th
                  key={exp}
                  className="thermal-compact-exp text-[11px]"
                  scope="col"
                  title={exp}
                >
                  {fmtHeatmapExpiry(exp)}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike, si) => {
            const isSpot = si === spotIdx;
            const pinned = pinSet.has(strike);
            const row = data.cells[String(strike)] ?? {};
            return (
              <tr
                key={strike}
                ref={isSpot ? spotRowRef : undefined}
                className={[
                  "thermal-compact-row",
                  isSpot ? "is-spot" : "",
                  pinned ? "is-pinned" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
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
                  </button>
                </th>
                {expiries.map((exp) => {
                  const val = row[exp];
                  const has = typeof val === "number" && Number.isFinite(val);
                  const n = has ? val : 0;
                  const day = extremes[exp];
                  const hl = topHighlights[exp];
                  const posRank = hl?.topPositive[strike];
                  const negRank = hl?.topNegative[strike];
                  const isKing = has && n !== 0 && day?.king === strike;
                  const showPct =
                    !isSpot && shouldShowStrikeDistancePct(si, pctSpotIdx);

                  let style: CSSProperties = {};
                  if (has && n !== 0) {
                    const rank1Pos =
                      day?.callWall != null
                        ? (data.cells[String(day.callWall)]?.[exp] ?? 0)
                        : 0;
                    const rank1Neg =
                      day?.putWall != null
                        ? (data.cells[String(day.putWall)]?.[exp] ?? 0)
                        : 0;
                    style = resolveHeatmapTopHighlightCellStyle(
                      n,
                      posRank,
                      negRank,
                      lens,
                      rank1Pos,
                      rank1Neg,
                      peak,
                    );
                  }

                  const isHighlighted = isHeatmapTopHighlightRank(posRank, negRank);
                  const isPosNode = posRank === 1;
                  const isNegNode = negRank === 1;

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
                        isHighlighted && !isPosNode && !isNegNode && n > 0 ? "is-pos" : "",
                        isHighlighted && !isPosNode && !isNegNode && n < 0 ? "is-neg" : "",
                        !has || n === 0 ? "is-zero" : "",
                        has && n !== 0 && !isHighlighted ? "is-neutral" : "",
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
                      <span className="thermal-compact-cell-inner">
                        {showPct ? (
                          <span className="thermal-compact-cell-pct" title="Distance from spot">
                            {fmtStrikeDistancePct(pctSpot, strike)}
                          </span>
                        ) : null}
                        <span className="thermal-compact-cell-val">
                          {fmtHeatmapMoneySigned(n, { showZero: true })}
                        </span>
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
