"use client";

import clsx from "clsx";
import { memo, useEffect, useRef, useState, useCallback } from "react";
import { buildGexLadder, type GexLadder, type GexLadderRow } from "@/features/vector/lib/vector-gex-ladder";
import { vectorWallsScopePollMs } from "@/features/vector/lib/vector-cadence";
import { vectorGexScopeLabel } from "@/lib/gex-scope-labels";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { nearestStrike } from "@/features/vector/lib/vector-chart-view";
import { rowsInBand, scrollOffsetForSpot } from "@/features/vector/lib/vector-ladder-align";

// Match the chart's bead colours exactly (VectorChart CALL_WALL_COLOR / PUT_WALL_COLOR) so the
// ladder and the beads read as the same object: gold = call/resistance, purple = put/support.
const CALL_COLOR = "#ffd60a";
const PUT_COLOR = "#d97bff";

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Signed, compact net-GEX label: `+$1.2M` (call) / `-$820K` (put). */
function fmtGex(gex: number): string {
  const sign = gex >= 0 ? "+" : "-";
  return `${sign}$${USD_COMPACT.format(Math.abs(gex))}`;
}

type Props = {
  ticker: string;
  liveSession: boolean;
  /** SSR-seeded spot so the header + empty state aren't blank before the first fetch. */
  initialSpot?: number | null;
  /** Live spot price from the chart's SSE stream (updates every second during live session). */
  liveSpot?: number | null;
  /** DTE horizon from the chart's toggle — the ladder re-scopes to the SAME expiries so it matches
   *  the walls on the chart. "all" = near-term aggregate (default). */
  dteHorizon?: VectorDteHorizon;
  /** Price under the chart crosshair, so the ladder can highlight the strike a member is reading
   *  at that level. The two panels sit side by side and were otherwise unlinked. */
  hoverPrice?: number | null;
  /** The chart's visible price range. Scopes the rail to what the chart is actually showing so the
   *  two panels read as one instrument — see vector-ladder-align.ts for the measured mismatch. */
  priceBand?: { min: number; max: number } | null;
};

type LadderResponse = { spot: number | null; asOf: string | null; ladder: GexLadder };

/**
 * Strike-ladder side panel — the dense per-strike net-GEX column a member scans alongside the
 * chart (Skylit-Atlas parity). The chart collapses each strike to one bead; this shows the whole
 * near-spot gamma structure at once: every strike, its signed net GEX as a magnitude bar (gold
 * call / purple put), and the single dominant "king" per side. Polls /api/market/vector/gex-ladder
 * on its own cadence (off the per-second SSE payload), passing `dteHorizon` through so the ladder
 * re-scopes to the SAME expiries as the chart's walls/flip/max-pain (see the route's
 * `getHorizonStrikeTotals` scoped path; falls back to the near-term aggregate on "all" or when a
 * narrow horizon yields no structure).
 */
/** Scroll `list` so `target` sits in the upper third rather than dead centre — see
 *  scrollOffsetForSpot for why the bias exists. Reads offsets off the elements; all the arithmetic
 *  (and its clamping) lives in the pure helper so it is unit-tested. */
function scrollSpotIntoView(list: HTMLElement, target: HTMLElement): void {
  const t = target.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  const targetTop = t.top - l.top + list.scrollTop;
  list.scrollTop = scrollOffsetForSpot(targetTop, t.height, list.clientHeight, list.scrollHeight);
}

export function VectorGexLadder({
  hoverPrice = null,
  priceBand = null,
  ticker,
  liveSession,
  initialSpot = null,
  liveSpot = null,
  dteHorizon = "all",
}: Props) {
  const [ladder, setLadder] = useState<GexLadder>(() => buildGexLadder(null, initialSpot));
  const [spot, setSpot] = useState<number | null>(initialSpot);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // Guard against a slow response for a PREVIOUS ticker landing after a switch and overwriting the
  // new ticker's ladder (same staleness class the chart's fetches guard with a ref check).
  const tickerRef = useRef(ticker);
  // Track last successful ladder fetch to avoid re-fetching on every spot tick.
  const lastFetchTimeRef = useRef<number>(0);

  // Live spot from chart SSE updates the display without re-fetching the ladder.
  useEffect(() => {
    if (liveSpot != null) {
      setSpot(liveSpot);
    }
  }, [liveSpot]);

  useEffect(() => {
    tickerRef.current = ticker;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/gex-ladder?ticker=${encodeURIComponent(ticker)}&dte=${encodeURIComponent(dteHorizon)}`
        );
        if (cancelled || tickerRef.current !== ticker) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = (await res.json()) as LadderResponse;
        if (cancelled || tickerRef.current !== ticker) return;
        setLadder(data.ladder ?? buildGexLadder(null, data.spot ?? null));
        // Only update spot from fetch if liveSpot is not available (off-hours or initial load).
        if (!liveSpot) {
          setSpot(data.spot ?? null);
        }
        setAsOf(data.asOf ?? null);
        setState("ready");
        lastFetchTimeRef.current = Date.now();
      } catch {
        if (!cancelled && tickerRef.current === ticker) setState("error");
      }
    };

    void load();
    // Live: refresh ladder structure every 15s. Spot updates come from chart SSE every tick.
    // Off-hours: one fetch — the ladder is static. Pre-warm on ticker/horizon change for faster navigation.
    const pollMs = vectorWallsScopePollMs(ticker);
    const id =
      liveSession && (Date.now() - lastFetchTimeRef.current > 10_000)
        ? setInterval(load, pollMs)
        : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ticker, liveSession, dteHorizon, liveSpot]);

  // Scope to the chart's visible band. Falls through to the full rail when no band is known or the
  // band excludes everything — a narrower rail is an improvement, a blank one is a regression.
  const rows = rowsInBand(ladder.rows, priceBand);
  // Index of the first row at/below spot — the spot marker slots ABOVE it (rows are strike-desc, so
  // this is the boundary between strikes above spot and strikes at/below it).
  const spotIdx =
    spot != null ? rows.findIndex((r) => r.strike <= spot) : -1;

  // Resolve the crosshair to at most ONE strike here rather than per row, so the comparison runs
  // once per hover instead of once per row per hover (the ladder renders ~40 rows).
  const highlightStrike = nearestStrike(hoverPrice, rows.map((r) => r.strike));

  // Auto-centre the ladder on spot once per ticker: the rows are strike-descending, so without this
  // the panel opens scrolled to the highest strikes (all calls) and a member has to scroll down to
  // see spot and the puts below it. Centre the spot marker in the viewport on the first ready load
  // (and again when the ticker changes) — but NOT on the 15s live refresh, which would yank the
  // scroll back if the member has scrolled away.
  const listRef = useRef<HTMLOListElement>(null);
  const centeredTickerRef = useRef<string | null>(null);
  // Re-centre on ticker OR horizon change — a narrowed DTE shifts the strike set, so the panel must
  // re-anchor on spot instead of holding the previous horizon's scroll position.
  const centerKey = `${ticker}:${dteHorizon}`;
  useEffect(() => {
    if (state !== "ready" || spot == null || rows.length === 0) return;
    if (centeredTickerRef.current === centerKey) return;
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLElement>(".vector-gex-ladder-spot") ??
      list.querySelector<HTMLElement>(".vector-gex-ladder-row");
    if (!target) return;
    scrollSpotIntoView(list, target);
    centeredTickerRef.current = centerKey;
  }, [state, spot, rows, centerKey]);

  /** Re-anchor on spot. Bound to the header button so a member who has scrolled away — or whose
   *  live spot has since moved off-screen — has a one-click way back, matching the SPX desk. */
  const resetToSpot = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const target =
      list.querySelector<HTMLElement>(".vector-gex-ladder-spot") ??
      list.querySelector<HTMLElement>(".vector-gex-ladder-row");
    if (target) scrollSpotIntoView(list, target);
  }, []);

  return (
    <section className="vector-gex-ladder" aria-label={`${ticker} GEX strike ladder`}>
      <header className="vector-gex-ladder-head">
        <span className="vector-gex-ladder-title">GEX Ladder</span>
        <span className="vector-gex-ladder-sub">
          {spot != null ? `spot ${spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}
          <span className="vector-gex-ladder-scope"> · {vectorGexScopeLabel(dteHorizon)}</span>
        </span>
        <button
          type="button"
          className="vector-gex-ladder-reset"
          onClick={resetToSpot}
          title="Scroll the ladder back to spot"
          aria-label="Reset ladder to spot"
          data-testid="vector-gex-ladder-reset"
        >
          ⟳ spot
        </button>
      </header>

      {state === "error" ? (
        <div className="vector-gex-ladder-empty">GEX ladder unavailable</div>
      ) : rows.length === 0 ? (
        <div className="vector-gex-ladder-empty">
          {state === "loading" ? "Loading GEX ladder…" : "No GEX structure near spot"}
        </div>
      ) : (
        <ol className="vector-gex-ladder-rows" ref={listRef}>
          {rows.map((r, i) => {
            const showSpotAbove = i === spotIdx;
            return (
              <LadderRow
                key={r.strike}
                row={r}
                showSpotAbove={showSpotAbove}
                // Only the spot-adjacent row needs the live price — every other row gets a
                // stable `null` so its props never change between spot ticks (see LadderRow's
                // memo comment below for why this matters).
                spot={showSpotAbove ? spot : null}
                // Only the matching row gets `true`; every other row keeps a stable `false` so
                // its props do not change on hover. Same reason the spot price is passed to a
                // single row — otherwise every crosshair move re-renders all ~40 rows.
                highlighted={highlightStrike != null && r.strike === highlightStrike}
              />
            );
          })}
        </ol>
      )}
    </section>
  );
}

// Root cause (2026-08-01 audit, finding #19): `liveSpot` ticks every ~1s from the chart's SSE
// stream (see the `useEffect` above that calls `setSpot(liveSpot)`), and that state lives on the
// PARENT (VectorGexLadder), so every tick re-rendered every row in this list — 30-60+ <li>s just
// to update the ONE row showing the live spot marker/price. memo() + only feeding a changing
// `spot` prop to that one row (see the map() call site above) means every other row's props are
// referentially stable between ticks (same `row` object — `rows` only changes on the 15s ladder
// poll — and a constant `spot={null}`), so React skips re-rendering them entirely.
const LadderRow = memo(function LadderRow({
  row,
  showSpotAbove,
  spot,
  highlighted,
}: {
  row: GexLadderRow;
  showSpotAbove: boolean;
  spot: number | null;
  highlighted: boolean;
}) {
  const color = row.side === "call" ? CALL_COLOR : PUT_COLOR;
  return (
    <>
      {showSpotAbove && spot != null ? (
        <li className="vector-gex-ladder-spot" aria-hidden="true">
          <span className="vector-gex-ladder-spot-label">
            spot {spot.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
        </li>
      ) : null}
      <li
        className={clsx(
          "vector-gex-ladder-row",
          `vector-gex-ladder-${row.side}`,
          row.isKing && "vector-gex-ladder-king",
          highlighted && "vector-gex-ladder-hover"
        )}
      >
        <span className="vector-gex-ladder-strike">{row.strike.toLocaleString("en-US")}</span>
        <span className="vector-gex-ladder-bar-track">
          <span
            className="vector-gex-ladder-bar"
            style={{ width: `${Math.max(2, Math.round(row.magnitude * 100))}%`, backgroundColor: color }}
          />
        </span>
        {/* Always occupies its grid column (even when empty) so the strike/bar/value columns stay
            aligned between rows that do and don't have a migration reading — a conditionally
            omitted 4th grid item would shift the value column left on rows without one. Small
            (<1%) or missing (no shift data yet, or a narrowed DTE horizon) migrations render
            nothing inside, same column. */}
        <span
          className={clsx(
            "vector-gex-ladder-migration",
            row.migration != null &&
              (row.migration.built ? "vector-gex-ladder-migration-up" : "vector-gex-ladder-migration-down")
          )}
          title={
            row.migration != null
              ? `Wall ${row.migration.built ? "built" : "faded"} ${Math.abs(Math.round(row.migration.pct))}% over the shift window`
              : undefined
          }
        >
          {row.migration != null && Math.abs(row.migration.pct) >= 1
            ? `${row.migration.built ? "▲" : "▼"}${Math.abs(Math.round(row.migration.pct))}%`
            : null}
        </span>
        <span className="vector-gex-ladder-val" style={{ color }}>
          {row.isKing ? <span className="vector-gex-ladder-crown" aria-hidden="true">♛</span> : null}
          {fmtGex(row.gex)}
        </span>
      </li>
    </>
  );
});
