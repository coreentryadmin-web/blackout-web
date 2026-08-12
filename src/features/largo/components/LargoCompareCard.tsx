"use client";

import { clsx } from "clsx";
import type { HelixThermalCompareCard } from "@/lib/largo/helix-thermal-compare";

const BIAS_CLASS: Record<string, string> = {
  bullish: "largo-compare-bull",
  bearish: "largo-compare-bear",
  neutral: "largo-compare-neutral",
  mixed: "largo-compare-mixed",
  unknown: "largo-compare-neutral",
};

export function LargoCompareCard({ card }: { card: HelixThermalCompareCard }) {
  return (
    <div
      className={clsx("largo-compare-card", card.conflict && "largo-compare-card-conflict")}
      role="region"
      aria-label="HELIX vs Thermal compare"
    >
      <div className="largo-compare-head">
        <span className="largo-compare-title">{card.ticker} · HELIX vs Thermal</span>
        {card.conflict && (
          <span className="largo-compare-conflict-pill" title={card.conflict_note ?? undefined}>
            Conflict
          </span>
        )}
      </div>
      <div className="largo-compare-grid">
        <div className="largo-compare-col">
          <div className="largo-compare-label">HELIX flow</div>
          <div className={clsx("largo-compare-bias", BIAS_CLASS[card.helix.bias] ?? "")}>
            {card.helix.bias}
          </div>
          <p className="largo-compare-summary">{card.helix.summary}</p>
          {card.helix.net_premium != null && (
            <p className="largo-compare-meta">Net premium {formatPrem(card.helix.net_premium)}</p>
          )}
        </div>
        <div className="largo-compare-col">
          <div className="largo-compare-label">Thermal GEX</div>
          <div className={clsx("largo-compare-bias", BIAS_CLASS[card.thermal.bias] ?? "")}>
            {card.thermal.bias}
          </div>
          <p className="largo-compare-summary">{card.thermal.summary}</p>
          {card.thermal.flip != null && (
            <p className="largo-compare-meta">Flip {card.thermal.flip}</p>
          )}
        </div>
      </div>
      {card.conflict_note && <p className="largo-compare-note">{card.conflict_note}</p>}
    </div>
  );
}

function formatPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
