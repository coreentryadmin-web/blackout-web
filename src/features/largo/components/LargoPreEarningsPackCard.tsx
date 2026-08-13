"use client";

import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";

export function LargoPreEarningsPackCard({ card }: { card: PreEarningsPackCard }) {
  return (
    <div className="largo-struct-card largo-earn-card" role="region" aria-label="Pre-earnings desk pack">
      <div className="largo-struct-head">
        <span className="largo-struct-title">{card.ticker} · pre-earnings pack</span>
        {card.earnings_date && (
          <span className="largo-struct-meta">
            {card.earnings_date}
            {card.days_until != null ? ` · ${card.days_until}d` : ""}
            {card.report_time ? ` · ${card.report_time}` : ""}
          </span>
        )}
      </div>

      <div className="largo-earn-grid">
        <section className="largo-earn-section">
          <div className="largo-struct-label">Event</div>
          <p className="largo-struct-summary">
            {card.expected_move_pct != null
              ? `Options-implied move ~${card.expected_move_pct}%`
              : "Expected move unavailable"}
            {card.is_confirmed === true ? " · date confirmed" : card.is_confirmed === false ? " · estimated date" : ""}
          </p>
          {card.history_summary && <p className="largo-struct-meta">{card.history_summary}</p>}
        </section>

        <section className="largo-earn-section">
          <div className="largo-struct-label">Positioning</div>
          {card.positioning.available ? (
            <>
              <p className="largo-struct-summary">
                {card.positioning.gamma_regime ?? "Regime forming"}
              </p>
              <p className="largo-struct-meta">
                {card.positioning.spot != null ? `Spot ${card.positioning.spot}` : "Spot —"}
                {card.positioning.flip != null ? ` · Flip ${card.positioning.flip}` : ""}
                {card.positioning.call_wall != null ? ` · Call ${card.positioning.call_wall}` : ""}
                {card.positioning.put_wall != null ? ` · Put ${card.positioning.put_wall}` : ""}
              </p>
            </>
          ) : (
            <p className="largo-struct-summary">Positioning unavailable</p>
          )}
        </section>

        <section className="largo-earn-section">
          <div className="largo-struct-label">Flow into print</div>
          <p className="largo-struct-summary">{card.flow.summary}</p>
          <p className="largo-struct-meta">
            Bias {card.flow.bias}
            {card.flow.net_premium != null ? ` · Net ${formatPrem(card.flow.net_premium)}` : ""}
          </p>
        </section>

        <section className="largo-earn-section">
          <div className="largo-struct-label">0DTE exposure</div>
          {card.zerodte ? (
            <>
              <p className="largo-struct-summary">
                {card.zerodte.on_board ? "On the board" : "Not committed"}
                {card.zerodte.status ? ` · ${card.zerodte.status}` : ""}
              </p>
              <p className="largo-struct-meta">
                {card.zerodte.headline ?? "—"}
                {card.zerodte.pnl_pct != null ? ` · P&amp;L ${card.zerodte.pnl_pct.toFixed(1)}%` : ""}
              </p>
            </>
          ) : (
            <p className="largo-struct-summary">No 0DTE board read</p>
          )}
        </section>
      </div>

      {card.history.length > 0 && (
        <div className="largo-earn-history">
          <div className="largo-struct-label">Recent prints</div>
          {card.history.slice(0, 4).map((h, i) => (
            <p key={`${h.report_date ?? "row"}-${i}`} className="largo-struct-meta">
              {h.report_date ?? "—"}
              {h.surprise_pct != null ? ` · surprise ${h.surprise_pct >= 0 ? "+" : ""}${h.surprise_pct}%` : ""}
              {h.beat === true ? " · beat" : h.beat === false ? " · miss" : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
