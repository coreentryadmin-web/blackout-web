"use client";

import { formatPremiumPct } from "@/features/nighthawk/lib/vector-board-table-utils";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";

export function VectorBoardCompareBar({
  rows,
  onClear,
}: {
  rows: VectorBoardTableRow[];
  onClear: () => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="vector-board-compare-bar" role="status">
      <span className="vector-board-compare-label">Comparing {rows.length}</span>
      <div className="vector-board-compare-items">
        {rows.map((row) => (
          <span key={row.key} className="vector-board-compare-item tabular-nums">
            <strong>{row.ticker}</strong> {formatPremiumPct(row.premiumPct)} · peak{" "}
            {formatPremiumPct(row.peakPct)}
          </span>
        ))}
      </div>
      <button type="button" className="vector-board-compare-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
