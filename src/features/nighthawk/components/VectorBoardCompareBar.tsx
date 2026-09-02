"use client";

import { clsx } from "clsx";
import { formatPremiumPct } from "@/features/nighthawk/lib/vector-board-table-utils";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import { vectorBoardRowGivebackPct } from "@/features/nighthawk/lib/vector-board-row-utils";

function fmtMid(v: number | null): string {
  return v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : "—";
}

function toneClass(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "is-flat";
  if (pct > 0) return "is-up";
  if (pct < 0) return "is-down";
  return "is-flat";
}

export function VectorBoardCompareBar({
  rows,
  onClear,
  limitHit,
}: {
  rows: VectorBoardTableRow[];
  onClear: () => void;
  limitHit?: boolean;
}) {
  if (rows.length === 0 && !limitHit) return null;

  return (
    <div className="vector-board-compare-bar" role="status">
      <div className="vector-board-compare-head">
        <span className="vector-board-compare-label">
          {limitHit ? "Max 3 picks" : `Comparing ${rows.length}`}
        </span>
        {rows.length > 0 ? (
          <button type="button" className="vector-board-compare-clear" onClick={onClear}>
            Clear
          </button>
        ) : (
          <span className="vector-board-compare-hint">Uncheck a row to add another</span>
        )}
      </div>
      {rows.length > 0 ? (
        <div className="vector-board-compare-grid">
          <div className="vector-board-compare-grid-head" aria-hidden>
            <span>Pick</span>
            <span>Premium</span>
            <span>Peak</span>
            <span>Giveback</span>
            <span>Entry → mark</span>
          </div>
          {rows.map((row) => {
            const giveback = vectorBoardRowGivebackPct(row);
            return (
              <div key={row.key} className="vector-board-compare-grid-row">
                <span className="vector-board-compare-grid-ticker">
                  <strong>{row.ticker}</strong>
                  <span className="vector-board-compare-grid-sub">{row.contractLabel}</span>
                </span>
                <span className={clsx("vector-board-compare-grid-val tabular-nums", toneClass(row.premiumPct))}>
                  {formatPremiumPct(row.premiumPct)}
                </span>
                <span className={clsx("vector-board-compare-grid-val tabular-nums", toneClass(row.peakPct))}>
                  {formatPremiumPct(row.peakPct)}
                </span>
                <span
                  className={clsx(
                    "vector-board-compare-grid-val tabular-nums",
                    giveback != null && giveback > 20 ? "is-down" : "is-flat"
                  )}
                >
                  {giveback != null ? `${giveback}%` : "—"}
                </span>
                <span className="vector-board-compare-grid-val tabular-nums vector-board-compare-grid-mid">
                  {fmtMid(row.entryMid)} → {fmtMid(row.markMid)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
