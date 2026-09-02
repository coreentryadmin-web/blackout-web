"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { LegacyPlayDetailPanel } from "@/features/nighthawk/command-deck/LegacyPlayDetailPanel";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import type { LegacyBoardTableRow } from "@/features/nighthawk/lib/legacy-board-table-utils";
import { formatPremiumPct, premiumPctTone } from "@/features/nighthawk/lib/vector-board-table-utils";

export function LegacyPlayDetailRail({
  row,
  onClose,
  sheet = false,
}: {
  row: LegacyBoardTableRow | null;
  onClose: () => void;
  sheet?: boolean;
}) {
  if (!row) {
    return (
      <aside className="vector-board-detail vector-board-detail--empty" aria-label="Play detail">
        <p className="vector-board-detail-empty-title">Select a play</p>
        <p className="vector-board-detail-empty-copy">
          Click any row to see why we picked it, what to watch, contract expression, pre-market
          verdict, and gate caveats — full desk reasoning in one scroll. Use ↑/↓ to navigate, / to
          search.
        </p>
      </aside>
    );
  }

  const play: TerminalPlay = row.play;
  const pctTone = premiumPctTone(row.premiumPct);

  return (
    <aside
      className={clsx("vector-board-detail legacy-board-detail", sheet && "vector-board-detail--sheet")}
      aria-label={`${row.ticker} play detail`}
    >
      <div className="vector-board-detail-sticky">
        <div className="vector-board-detail-head">
          <div className="vector-board-detail-titleblock">
            <h2 className="vector-board-detail-ticker">{row.ticker}</h2>
            <p className="vector-board-detail-contract">{row.contractLabel}</p>
            {row.occ ? <p className="vector-board-detail-id">OCC {row.occ}</p> : null}
          </div>
          <button type="button" className="vector-board-detail-close" onClick={onClose} aria-label="Close detail">
            ×
          </button>
        </div>

        <div className="vector-board-detail-status-row">
          <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
          {row.play.tierLabel ? (
            <span className="vector-board-detail-tag">Tier {row.play.tierLabel}</span>
          ) : null}
          {row.rank != null ? <span className="vector-board-detail-tag">Rank #{row.rank}</span> : null}
        </div>

        <div className="vector-board-detail-hero">
          <span className="vector-board-detail-hero-label">Premium vs entry</span>
          <span
            className={clsx(
              "vector-board-detail-hero-value tabular-nums",
              pctTone === "bull" && "is-up",
              pctTone === "bear" && "is-down",
              pctTone === "sky" && "is-flat"
            )}
          >
            {formatPremiumPct(row.premiumPct)}
          </span>
        </div>
      </div>

      {/* Everything below renders unconditionally, in one scroll, on row select — no tab gate.
          Legacy and Vector are DELIBERATELY different here: Vector's own rail
          (VectorPlayDetailPanel.tsx) keeps its tabbed inspector on purpose (its own test,
          VectorPickLogBoard.test.ts, asserts the tabs stay), but Legacy's own test
          (LegacyPickLogBoard.test.ts) asserts the OPPOSITE: reasoning must show immediately,
          "not hide it behind desk/timeline tabs". #3297 changed only this file's EMPTY-STATE
          copy to promise "full desk reasoning in one scroll" but never touched the actual
          selected-row markup below, which still gated LegacyPlayDetailPanel behind a tab click —
          so the promise and the behavior disagreed with each other from the moment it merged. */}
      <div className="vector-board-detail-panel vector-board-detail-panel--overview">
        <div className="vector-board-detail-grid">
          <div className="vector-board-detail-metric">
            <span className="vector-board-detail-metric-label">Stock move</span>
            <span className="vector-board-detail-metric-value tabular-nums is-bold">
              {formatPremiumPct(row.play.stockMovePct ?? null)}
            </span>
          </div>
          <div className="vector-board-detail-metric">
            <span className="vector-board-detail-metric-label">Entry → mark</span>
            <span className="vector-board-detail-metric-value tabular-nums is-bold">
              {row.entryMid != null ? `$${row.entryMid.toFixed(2)}` : "—"} →{" "}
              {row.markMid != null ? `$${row.markMid.toFixed(2)}` : "—"}
            </span>
          </div>
          <div className="vector-board-detail-metric">
            <span className="vector-board-detail-metric-label">Peak</span>
            <span className="vector-board-detail-metric-value tabular-nums">
              {formatPremiumPct(row.peakPct)}
            </span>
          </div>
          <div className="vector-board-detail-metric">
            <span className="vector-board-detail-metric-label">Morning</span>
            <span className="vector-board-detail-metric-value">{row.statusLabel}</span>
          </div>
        </div>
      </div>

      <div className="legacy-board-detail-body">
        <LegacyPlayDetailPanel play={play} />
      </div>

      <div className="vector-board-detail-panel vector-board-detail-panel--path">
        <div className="vector-board-detail-reason">
          <span className="vector-board-detail-reason-label">Target path</span>
          <p className="vector-board-detail-reason-copy">
            {row.progressPct != null
              ? `${row.progressPct}% toward published target — stock and option marks update live during the session.`
              : "Progress toward target will populate once live marks are available."}
          </p>
        </div>
      </div>
    </aside>
  );
}
