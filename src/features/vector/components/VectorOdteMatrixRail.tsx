"use client";

import clsx from "clsx";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import useSWR from "swr";
import {
  fmtHeatmapMoneySigned,
  fmtHeatmapStrike,
  heatmapCellStyle,
  heatmapCellTextStyle,
  type GexHeatmapLens,
} from "@/lib/gex-heatmap-display";
import { matrixScopeExpiries, matrixRailTitle, matrixScopeExpiryNote } from "@/features/vector/lib/vector-matrix-horizon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";
import { matrixShiftForLens } from "@/lib/gex-shift-leaders";
import { vectorWallsScopePollMs } from "@/features/vector/lib/vector-cadence";
import { buildOdteMatrixRows, type OdteMatrixRow } from "@/features/vector/lib/vector-odte-matrix-rows";
import { scrollOffsetForSpot } from "@/features/vector/lib/vector-ladder-align";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { etClock } from "@/lib/et-clock";

type MetricBlock = {
  cells: Record<string, Record<string, number>>;
  strike_totals: Record<string, number>;
};

type MatrixResponse = {
  available: boolean;
  spot?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  near_term_expiries?: string[];
  gex?: MetricBlock;
  vex?: MetricBlock;
  shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
  vex_shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
};

async function fetchMatrix(url: string): Promise<MatrixResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`matrix ${res.status}`);
  return res.json();
}

function fmtAsof(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return etClock(d, { seconds: true });
}

type Props = {
  ticker: string;
  liveSession: boolean;
  initialSpot?: number | null;
  liveSpot?: number | null;
  dteHorizon?: VectorDteHorizon;
  wallsPollMs?: number;
  hoverPrice?: number | null;
  priceBand?: { min: number; max: number } | null;
  /** Click a strike row → flash that level on the chart (same seam as HELIX strike focus). */
  onStrikeFocus?: (strike: number) => void;
};

function scrollSpotIntoView(list: HTMLElement, target: HTMLElement): void {
  const t = target.getBoundingClientRect();
  const l = list.getBoundingClientRect();
  const targetTop = t.top - l.top + list.scrollTop;
  list.scrollTop = scrollOffsetForSpot(targetTop, t.height, list.clientHeight, list.scrollHeight);
}

export function VectorOdteMatrixRail({
  ticker,
  liveSession,
  initialSpot = null,
  liveSpot = null,
  dteHorizon = "0dte",
  wallsPollMs,
  hoverPrice = null,
  priceBand = null,
  onStrikeFocus,
}: Props) {
  const [lens, setLens] = useState<GexHeatmapLens>("gex");
  const pollMs = wallsPollMs ?? vectorWallsScopePollMs(ticker);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spotRowRef = useRef<HTMLTableRowElement>(null);
  const tickerRef = useRef(ticker);

  const matrixKey = `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`;
  const cached = useMemo(() => readGexHeatmapSessionCache<MatrixResponse>(ticker), [ticker]);

  const { data, error, isLoading, isValidating } = useSWR<MatrixResponse>(matrixKey, fetchMatrix, {
    refreshInterval: liveSession ? pollMs : 0,
    revalidateOnFocus: liveSession,
    fallbackData: cached ?? undefined,
    onSuccess: (payload) => writeGexHeatmapSessionCache(ticker, payload),
  });

  useEffect(() => {
    tickerRef.current = ticker;
  }, [ticker]);

  const spot = liveSpot ?? data?.spot ?? initialSpot ?? null;
  const block = lens === "gex" ? data?.gex : data?.vex;
  const cells = block?.cells ?? {};
  const strikesAxis = data?.strikes ?? [];
  const todayYmd = todayEtYmd();
  const scopeExpiries = useMemo(
    () => matrixScopeExpiries(data?.expiries ?? [], dteHorizon, todayYmd),
    [data?.expiries, dteHorizon, todayYmd]
  );
  const matrixTitle = matrixRailTitle(dteHorizon);

  const activeShift = matrixShiftForLens(lens, {
    shift: data?.shift ?? null,
    vex_shift: data?.vex_shift ?? null,
  });

  const built = useMemo(
    () =>
      buildOdteMatrixRows({
        strikes: strikesAxis,
        cells,
        scopeExpiries,
        spot,
        lens,
        shift: activeShift,
        priceBand,
      }),
    [strikesAxis, cells, scopeExpiries, spot, lens, activeShift, priceBand]
  );

  const hoverStrike = useMemo(() => {
    if (hoverPrice == null || !Number.isFinite(hoverPrice)) return null;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const row of built.rows) {
      const d = Math.abs(row.strike - hoverPrice);
      if (d < bestDist) {
        bestDist = d;
        best = row.strike;
      }
    }
    return best;
  }, [built.rows, hoverPrice]);

  const resetToSpot = useCallback(() => {
    const list = scrollRef.current;
    const row = spotRowRef.current;
    if (list && row) scrollSpotIntoView(list, row);
  }, []);

  useLayoutEffect(() => {
    resetToSpot();
  }, [ticker, dteHorizon, scopeExpiries.join(","), resetToSpot]);

  const hasData = Boolean(data?.available && built.rows.length > 0 && scopeExpiries.length > 0);
  const asOf = fmtAsof(data?.asof);
  const scopeNote = matrixScopeExpiryNote(scopeExpiries, dteHorizon, todayYmd);
  const emptyLabel =
    dteHorizon === "0dte" ? "No 0DTE structure near spot" : `No ${matrixTitle.toLowerCase()} structure near spot`;

  return (
    <section className="vector-odte-matrix-rail" aria-label={`${ticker} ${matrixTitle}`}>
      <header className="vector-odte-matrix-head">
        <div className="vector-odte-matrix-head-top">
          <span className="vector-odte-matrix-title">{matrixTitle}</span>
          <button
            type="button"
            className="vector-gex-ladder-reset vector-odte-matrix-reset"
            onClick={resetToSpot}
            title="Scroll matrix back to spot"
            aria-label="Reset matrix to spot"
            data-testid="vector-odte-matrix-reset"
          >
            ⟳ SPOT
          </button>
        </div>
        <div className="vector-odte-matrix-head-meta">
          <span className="vector-odte-matrix-spot">
            {spot != null && spot > 0 ? fmtHeatmapStrike(spot) : "—"}
          </span>
          {asOf ? <span className="vector-odte-matrix-asof">{asOf} ET</span> : null}
          {scopeNote ? (
            <span className="vector-odte-matrix-scope-note" title="0DTE expiry unavailable — showing nearest listed expiry">
              {scopeNote}
            </span>
          ) : null}
        </div>
        <div className="vector-odte-matrix-lens" role="group" aria-label="Matrix lens">
          {(["gex", "vex"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={clsx("vector-odte-matrix-lens-btn", lens === l && "is-active")}
              onClick={() => setLens(l)}
              aria-pressed={lens === l}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {error && !hasData ? (
        <p className="vector-odte-matrix-empty">Matrix unavailable — retrying…</p>
      ) : isLoading && !hasData ? (
        <p className="vector-odte-matrix-empty">Loading {matrixTitle.toLowerCase()}…</p>
      ) : !hasData ? (
        <p className="vector-odte-matrix-empty">{emptyLabel}</p>
      ) : (
        <div
          ref={scrollRef}
          className="vector-odte-matrix-scroll spx-gex-matrix-scroll"
          data-testid="vector-odte-matrix-scroll"
        >
          <table className="vector-odte-matrix-table spx-gex-matrix-table w-full border-collapse font-mono text-[11px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#08080e]">
              <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-sky-300">
                <th className="py-1 pl-1 pr-2 text-left font-semibold">Strike</th>
                {/* Δ% folded into this cell (see MatrixRow) — Vector only ever shows the single
                    0DTE column, so a standalone Δ% column just burned rail width for one number
                    that reads fine as a small inline suffix next to the value it explains. */}
                <th className="py-1 pr-1 text-right font-semibold">{lens.toUpperCase()} · Δ%</th>
              </tr>
            </thead>
            <tbody>
              {built.rows.map((row, si) => (
                <MatrixRow
                  key={row.strike}
                  row={row}
                  si={si}
                  spotIdx={built.spotIdx}
                  peak={built.peak}
                  lens={lens}
                  highlighted={hoverStrike === row.strike}
                  spotRowRef={si === built.spotIdx ? spotRowRef : undefined}
                  onStrikeFocus={onStrikeFocus}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isValidating && hasData ? (
        <p className="vector-odte-matrix-refresh" aria-live="polite">
          Updating…
        </p>
      ) : null}
    </section>
  );
}

const MatrixRow = memo(function MatrixRow({
  row,
  si,
  spotIdx,
  peak,
  lens,
  highlighted,
  spotRowRef,
  onStrikeFocus,
}: {
  row: OdteMatrixRow;
  si: number;
  spotIdx: number;
  peak: number;
  lens: GexHeatmapLens;
  highlighted: boolean;
  spotRowRef?: RefObject<HTMLTableRowElement>;
  onStrikeFocus?: (strike: number) => void;
}) {
  const isSpot = si === spotIdx;
  const hasVal = row.value !== 0;
  const cellStyle = hasVal ? heatmapCellStyle(row.value, peak, lens) : {};
  const textStyle = hasVal ? heatmapCellTextStyle(row.value, peak) : {};
  const pctTone =
    row.driftLabel == null || row.driftLabel === "—"
      ? ""
      : row.shiftDelta != null && row.shiftDelta >= 0
        ? "is-pct-pos"
        : "is-pct-neg";

  return (
    <tr
      ref={spotRowRef}
      className={clsx(
        "vector-odte-matrix-row border-b border-white/[0.04]",
        isSpot && "spx-gex-matrix-spot-row vector-odte-matrix-spot-row",
        row.isKing && "spx-odte-matrix-row--anchor",
        row.isCallWall && "spx-odte-matrix-row--max-pos",
        row.isPutWall && "spx-odte-matrix-row--max-neg",
        highlighted && "vector-odte-matrix-hover",
        onStrikeFocus && "vector-odte-matrix-row-clickable"
      )}
      onClick={onStrikeFocus ? () => onStrikeFocus(row.strike) : undefined}
      onKeyDown={
        onStrikeFocus
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onStrikeFocus(row.strike);
              }
            }
          : undefined
      }
      tabIndex={onStrikeFocus ? 0 : undefined}
      role={onStrikeFocus ? "button" : undefined}
      aria-label={onStrikeFocus ? `Focus chart on strike ${row.strike}` : undefined}
    >
      <th
        scope="row"
        className={clsx(
          "py-0.5 px-1 text-left font-bold",
          isSpot && "text-cyan-300"
        )}
      >
        {fmtHeatmapStrike(row.strike)}
        {row.isKing ? <span className="vector-odte-matrix-crown" aria-hidden> ♛</span> : null}
      </th>
      <td
        className="py-0.5 pr-1 text-right whitespace-nowrap"
        style={{ ...cellStyle, ...textStyle }}
      >
        <span
          className={clsx(row.isKing && "vector-odte-matrix-king-value")}
          title={row.isKing ? "King node — largest |GEX| on the board" : undefined}
        >
          {hasVal ? fmtHeatmapMoneySigned(row.value) : "·"}
        </span>
        {row.driftLabel != null && row.driftLabel !== "—" ? (
          <span className={clsx("vector-odte-matrix-pct-inline", pctTone)}>
            {row.shiftDelta != null && row.shiftDelta >= 0 ? "▲" : "▼"}
            {/* driftLabel already carries its own +/− sign (fmtShiftPercentForStrike) — the arrow
                above is the direction cue, so strip that leading sign glyph rather than show both. */}
            {row.driftLabel.replace(/^[+−-]/, "")}
          </span>
        ) : null}
      </td>
    </tr>
  );
});
