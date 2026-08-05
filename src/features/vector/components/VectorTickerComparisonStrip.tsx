"use client";

import { clsx } from "clsx";
import { useVectorUniverseSnapshot } from "@/features/vector/lib/vector-universe-client";
import { buildTickerComparisonRows } from "@/features/vector/lib/vector-ticker-comparison";

type Props = {
  activeTicker: string;
  /** Optional: clicking a comparison chip jumps the desk to that ticker. Omitted → chips are
   *  read-only (e.g. an embed that doesn't own ticker navigation). */
  onSelect?: (ticker: string) => void;
  className?: string;
};

function fmtDist(pct: number | null): string {
  if (pct == null) return "—";
  const s = pct >= 0 ? "+" : "";
  return `${s}${pct.toFixed(1)}%`;
}

/**
 * Cross-ticker wall-structure comparison strip (P2, 2026-08-05 CTO audit) — SPY vs sector ETF vs
 * a couple of peers, each showing regime (above/below gamma flip), flip-distance %, and
 * wall-strength, so a member can eyeball relative positioning without leaving the active chart.
 *
 * Reuses the SAME universe snapshot the scanner already polls (`useVectorUniverseSnapshot`, one
 * shared SWR key) and the SAME pure screener math (`screenerRegimeOf`/`flipDistancePct`/
 * `wallStrength` via `buildTickerComparisonRows`) — no new fetch, no new math.
 *
 * Honest-absence: renders nothing (not a skeleton, not an error banner) until the snapshot has
 * loaded, and a comparison ticker with no row in the snapshot is silently skipped rather than
 * shown as a placeholder — same convention the rest of Vector's overlays follow.
 */
export function VectorTickerComparisonStrip({ activeTicker, onSelect, className }: Props) {
  const { data } = useVectorUniverseSnapshot();
  if (!data?.rows?.length) return null;

  const rows = buildTickerComparisonRows(activeTicker, data.rows);
  if (!rows.length) return null;

  return (
    <div
      className={clsx("vector-comparison-strip", className)}
      role="group"
      aria-label="Cross-ticker wall comparison"
    >
      {rows.map((row) => (
        <button
          key={row.ticker}
          type="button"
          className={clsx(
            "vector-comparison-chip",
            `vs-regime-${row.regime}`,
            row.isActive && "is-active"
          )}
          onClick={onSelect ? () => onSelect(row.ticker) : undefined}
          disabled={!onSelect}
          aria-current={row.isActive ? "true" : undefined}
        >
          <span className="vector-comparison-chip-ticker">
            <span className="vs-regime-dot" aria-hidden="true" />
            {row.ticker}
          </span>
          <span className={clsx("vector-comparison-chip-regime", `vs-regime-tag-${row.regime}`)}>
            {row.regime === "above" ? "▲" : row.regime === "below" ? "▼" : "—"}
          </span>
          <span className="vector-comparison-chip-dist">{fmtDist(row.flipDistancePct)}</span>
          <span className="vector-comparison-chip-strength" title="Wall strength (0–100)">
            {row.wallStrength.toFixed(0)}
          </span>
        </button>
      ))}
    </div>
  );
}
