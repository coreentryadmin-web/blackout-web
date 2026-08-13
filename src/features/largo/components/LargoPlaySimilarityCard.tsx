"use client";

import type { PlaySimilarityCard } from "@/lib/largo/play-similarity";

export function LargoPlaySimilarityCard({ card }: { card: PlaySimilarityCard }) {
  const dist = card.distribution;
  const totalOutcomes =
    dist.byOutcome.doubled + dist.byOutcome.stopped + dist.byOutcome.time_stop + dist.byOutcome.other;

  return (
    <div className="largo-struct-card largo-sim-card" role="region" aria-label="Play similarity">
      <div className="largo-struct-head">
        <span className="largo-struct-title">
          {card.query_ticker} · past analogs
        </span>
        <span className="largo-struct-meta">k={card.k} · corpus {card.corpus_size}</span>
      </div>
      <p className="largo-struct-summary">{card.query_summary}</p>
      {card.insufficient_neighbors && (
        <p className="largo-struct-note">Fewer than 5 neighbors — treat distribution as directional only.</p>
      )}

      <div className="largo-sim-grid">
        <div className="largo-sim-panel">
          <div className="largo-struct-label">Outcome mix (neighbors)</div>
          <ul className="largo-sim-bars">
            <Bar label="Doubled" count={dist.byOutcome.doubled} total={totalOutcomes} tone="win" />
            <Bar label="Time stop" count={dist.byOutcome.time_stop} total={totalOutcomes} tone="neutral" />
            <Bar label="Stopped" count={dist.byOutcome.stopped} total={totalOutcomes} tone="loss" />
          </ul>
          <p className="largo-struct-meta">
            {dist.wins}W / {dist.losses}L
            {dist.winRateWilson
              ? ` · Wilson ${pct(dist.winRateWilson.lo)}–${pct(dist.winRateWilson.hi)}`
              : ""}
          </p>
        </div>
        <div className="largo-sim-panel">
          <div className="largo-struct-label">P&amp;L buckets</div>
          <ul className="largo-sim-bars">
            <Bar label="&gt; +50%" count={dist.pnlBuckets.big_win} total={card.neighbors.length} tone="win" />
            <Bar label="0 to +50%" count={dist.pnlBuckets.moderate_win} total={card.neighbors.length} tone="neutral" />
            <Bar label="−50 to 0" count={dist.pnlBuckets.moderate_loss} total={card.neighbors.length} tone="neutral" />
            <Bar label="≤ −50%" count={dist.pnlBuckets.stopped_out} total={card.neighbors.length} tone="loss" />
          </ul>
          <p className="largo-struct-meta">
            {dist.avgPnlPct != null ? `Avg ${dist.avgPnlPct.toFixed(1)}%` : "Avg —"}
            {dist.medianPnlPct != null ? ` · Med ${dist.medianPnlPct.toFixed(1)}%` : ""}
          </p>
        </div>
      </div>

      {card.neighbors.length > 0 && (
        <div className="largo-sim-neighbors">
          <div className="largo-struct-label">Nearest sessions</div>
          <div className="largo-sim-neighbor-row largo-sim-neighbor-head">
            <span>Date</span>
            <span>Outcome</span>
            <span>P&amp;L</span>
            <span>Dist</span>
          </div>
          {card.neighbors.slice(0, 6).map((n) => (
            <div key={`${n.sessionDate}-${n.distance}`} className="largo-sim-neighbor-row">
              <span>{n.sessionDate}</span>
              <span className={n.label === "win" ? "largo-sim-win" : "largo-sim-loss"}>
                {n.planOutcome ?? n.label}
              </span>
              <span>{n.pnlPct != null ? `${n.pnlPct.toFixed(0)}%` : "—"}</span>
              <span>{n.distance.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function Bar({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "win" | "loss" | "neutral";
}) {
  const width = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <li className="largo-sim-bar-row">
      <span className="largo-sim-bar-label">{label}</span>
      <span className="largo-sim-bar-track">
        <span className={`largo-sim-bar-fill largo-sim-bar-${tone}`} style={{ width: `${width}%` }} />
      </span>
      <span className="largo-sim-bar-count">{count}</span>
    </li>
  );
}
