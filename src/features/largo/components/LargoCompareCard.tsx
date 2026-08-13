"use client";

import { clsx } from "clsx";
import type { LargoCompareCard as LargoCompareCardPayload } from "@/lib/largo/helix-thermal-compare";
import {
  isHelixThermalCompareCard,
  isPeerTickerCompareCard,
} from "@/lib/largo/helix-thermal-compare";

const BIAS_CLASS: Record<string, string> = {
  bullish: "largo-compare-bull",
  bearish: "largo-compare-bear",
  neutral: "largo-compare-neutral",
  mixed: "largo-compare-mixed",
  unknown: "largo-compare-neutral",
};

export function LargoCompareCard({ card }: { card: LargoCompareCardPayload }) {
  if (isPeerTickerCompareCard(card)) {
    return <PeerTickerCompareView card={card} />;
  }
  if (isHelixThermalCompareCard(card)) {
    return <HelixThermalCompareView card={card} />;
  }
  return null;
}

function HelixThermalCompareView({
  card,
}: {
  card: Extract<LargoCompareCardPayload, { kind: "helix_thermal" }>;
}) {
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
        <CompareSide label="HELIX flow" side={card.helix} showNetPremium />
        <CompareSide label="Thermal GEX" side={card.thermal} showFlip />
      </div>
      {card.conflict_note && <p className="largo-compare-note">{card.conflict_note}</p>}
    </div>
  );
}

function PeerTickerCompareView({
  card,
}: {
  card: Extract<LargoCompareCardPayload, { kind: "peer_tickers" }>;
}) {
  return (
    <div
      className={clsx(
        "largo-compare-card largo-compare-card-peer",
        card.peer_divergence && "largo-compare-card-conflict"
      )}
      role="region"
      aria-label="Peer ticker compare"
    >
      <div className="largo-compare-head">
        <span className="largo-compare-title">{card.tickers.join(" · ")} · Flow + Gamma</span>
        {card.peer_divergence && (
          <span className="largo-compare-conflict-pill" title={card.peer_divergence_note ?? undefined}>
            Divergence
          </span>
        )}
      </div>
      <div className="largo-compare-peer-table" role="table">
        <div className="largo-compare-peer-row largo-compare-peer-head" role="row">
          <span role="columnheader">Ticker</span>
          <span role="columnheader">Flow</span>
          <span role="columnheader">Gamma</span>
        </div>
        {card.rows.map((row) => (
          <div
            key={row.ticker}
            className={clsx("largo-compare-peer-row", row.conflict && "largo-compare-peer-row-conflict")}
            role="row"
          >
            <span className="largo-compare-peer-ticker" role="cell">
              {row.ticker}
              {row.conflict && (
                <span className="largo-compare-peer-conflict-dot" title={row.conflict_note ?? undefined}>
                  ≠
                </span>
              )}
            </span>
            <span role="cell">
              <span className={clsx("largo-compare-bias", BIAS_CLASS[row.flow.bias] ?? "")}>
                {row.flow.bias}
              </span>
              <p className="largo-compare-summary">{row.flow.summary}</p>
              {row.flow.net_premium != null && (
                <p className="largo-compare-meta">Net {formatPrem(row.flow.net_premium)}</p>
              )}
            </span>
            <span role="cell">
              <span className={clsx("largo-compare-bias", BIAS_CLASS[row.gamma.bias] ?? "")}>
                {row.gamma.bias}
              </span>
              <p className="largo-compare-summary">{row.gamma.summary}</p>
              {row.gamma.flip != null && (
                <p className="largo-compare-meta">Flip {row.gamma.flip}</p>
              )}
            </span>
          </div>
        ))}
      </div>
      {card.peer_divergence_note && <p className="largo-compare-note">{card.peer_divergence_note}</p>}
    </div>
  );
}

function CompareSide({
  label,
  side,
  showNetPremium,
  showFlip,
}: {
  label: string;
  side: { bias: string; summary: string; net_premium?: number | null; flip?: number | null };
  showNetPremium?: boolean;
  showFlip?: boolean;
}) {
  return (
    <div className="largo-compare-col">
      <div className="largo-compare-label">{label}</div>
      <div className={clsx("largo-compare-bias", BIAS_CLASS[side.bias] ?? "")}>{side.bias}</div>
      <p className="largo-compare-summary">{side.summary}</p>
      {showNetPremium && side.net_premium != null && (
        <p className="largo-compare-meta">Net premium {formatPrem(side.net_premium)}</p>
      )}
      {showFlip && side.flip != null && <p className="largo-compare-meta">Flip {side.flip}</p>}
    </div>
  );
}

function formatPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
