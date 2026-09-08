"use client";

import type { LegacyMacroContext } from "@/features/nighthawk/lib/legacy-macro-types";

export function LegacyMacroStrip({ macro }: { macro: LegacyMacroContext | null }) {
  if (!macro) return null;

  const items: string[] = [];
  if (macro.overnightGapPts != null && macro.priorClose != null) {
    const pct = ((macro.overnightGapPts / macro.priorClose) * 100).toFixed(2);
    items.push(`SPX gap ${macro.overnightGapPts >= 0 ? "+" : ""}${macro.overnightGapPts.toFixed(2)} (${pct}%)`);
  } else if (macro.spxPremarket != null) {
    items.push(`SPX pre ${macro.spxPremarket.toFixed(2)}`);
  }
  if (macro.regime) items.push(`Regime ${macro.regime}`);
  if (macro.gexBias) items.push(`GEX ${macro.gexBias}`);
  if (macro.callWall != null) items.push(`Call wall ${macro.callWall.toFixed(0)}`);
  if (macro.putWall != null) items.push(`Put wall ${macro.putWall.toFixed(0)}`);
  if (macro.summary) {
    items.push(
      `Confirm ${macro.summary.confirmed}C · ${macro.summary.degraded}D · ${macro.summary.invalidated}X`
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="legacy-board-macro" role="status" aria-label="Edition macro context">
      <span className="legacy-board-macro-label">Macro</span>
      <ul className="legacy-board-macro-bullets">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
