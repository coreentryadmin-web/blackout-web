"use client";

import Link from "next/link";
import type { MeridianEventDetail, MeridianTimelineItem } from "@/features/meridian/lib/meridian-types";
import { LargoPreEarningsPackCard } from "@/features/largo/components/LargoPreEarningsPackCard";
import { FreshnessChip } from "@/components/ui";

function impactLabel(impact: string): string {
  if (impact === "high") return "High impact";
  if (impact === "medium") return "Medium impact";
  return "Scheduled";
}

function kindChip(kind: MeridianTimelineItem["kind"]): string {
  if (kind === "macro") return "Macro";
  if (kind === "opex") return "OpEx";
  return "Earnings";
}

function fmtPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

type Props = {
  item: MeridianTimelineItem;
  detail: MeridianEventDetail | null;
  loading: boolean;
  error: string | null;
};

export function MeridianEventDetailPanel({ item, detail, loading, error }: Props) {
  return (
    <div className="meridian-detail" role="region" aria-label="Event structure brief">
      <header className="meridian-detail-head">
        <div>
          <p className="meridian-detail-kicker">{kindChip(item.kind)} · {impactLabel(item.impact)}</p>
          <h2 className="meridian-detail-title">{item.title}</h2>
          <p className="meridian-detail-meta">
            {item.date}
            {item.time ? ` · ${item.time} ET` : ""}
            {item.days_until === 0 ? " · today" : item.days_until === 1 ? " · tomorrow" : ` · ${item.days_until}d`}
          </p>
        </div>
        <FreshnessChip status={loading ? "stale" : "live"} label={loading ? "Loading" : "Structure"} />
      </header>

      {loading && <p className="meridian-detail-empty">Loading structure brief…</p>}
      {error && !loading && <p className="meridian-detail-empty">{error}</p>}

      {!loading && !error && detail?.kind === "macro" && (
        <div className="meridian-detail-grid">
          <section className="meridian-card">
            <h3 className="meridian-card-label">SPX positioning into event</h3>
            {detail.spx_positioning.available ? (
              <>
                <p className="meridian-card-value">
                  {detail.spx_positioning.gamma_regime ?? "Regime forming"}
                </p>
                <ul className="meridian-card-list">
                  {detail.spx_positioning.spot != null && (
                    <li>Spot {detail.spx_positioning.spot.toLocaleString()}</li>
                  )}
                  {detail.spx_positioning.flip_distance_pts != null && (
                    <li>Flip distance {detail.spx_positioning.flip_distance_pts} pts</li>
                  )}
                  {detail.spx_positioning.flip != null && (
                    <li>Gamma flip {detail.spx_positioning.flip.toLocaleString()}</li>
                  )}
                  {detail.spx_positioning.call_wall != null && (
                    <li>King call {detail.spx_positioning.call_wall.toLocaleString()}</li>
                  )}
                  {detail.spx_positioning.put_wall != null && (
                    <li>King put {detail.spx_positioning.put_wall.toLocaleString()}</li>
                  )}
                  {detail.spx_positioning.net_gex_label && (
                    <li>Net GEX {detail.spx_positioning.net_gex_label}</li>
                  )}
                </ul>
              </>
            ) : (
              <p className="meridian-card-muted">SPX positioning unavailable — check Thermal or SPX desk.</p>
            )}
          </section>

          <section className="meridian-card">
            <h3 className="meridian-card-label">HELIX flow skew</h3>
            {detail.flow.available ? (
              <>
                {detail.flow.call_put_ratio != null && (
                  <p className="meridian-card-value">Call/put ratio {detail.flow.call_put_ratio.toFixed(2)}</p>
                )}
                <p className="meridian-card-muted">{detail.flow.summary}</p>
                {detail.flow.net_premium != null && (
                  <p className="meridian-card-muted">Net premium {fmtPrem(detail.flow.net_premium)}</p>
                )}
              </>
            ) : (
              <p className="meridian-card-muted">Flow skew unavailable in lookback window.</p>
            )}
          </section>

          {detail.event_window && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Event window</h3>
              <p className="meridian-card-muted">{detail.event_window}</p>
            </section>
          )}
        </div>
      )}

      {!loading && !error && detail?.kind === "opex" && (
        <div className="meridian-detail-grid">
          <section className="meridian-card meridian-card-wide">
            <h3 className="meridian-card-label">SPX structure into OpEx</h3>
            {detail.spx_positioning.available ? (
              <ul className="meridian-card-list">
                {detail.spx_positioning.gamma_regime && <li>{detail.spx_positioning.gamma_regime}</li>}
                {detail.spx_positioning.flip != null && (
                  <li>Flip {detail.spx_positioning.flip.toLocaleString()}</li>
                )}
                {detail.spx_positioning.call_wall != null && (
                  <li>Call wall {detail.spx_positioning.call_wall.toLocaleString()}</li>
                )}
                {detail.spx_positioning.put_wall != null && (
                  <li>Put wall {detail.spx_positioning.put_wall.toLocaleString()}</li>
                )}
              </ul>
            ) : (
              <p className="meridian-card-muted">SPX positioning unavailable.</p>
            )}
          </section>
        </div>
      )}

      {!loading && !error && detail?.kind === "earnings" && (
        <div className="meridian-earn-wrap">
          <LargoPreEarningsPackCard card={detail.pack} />
        </div>
      )}

      <footer className="meridian-detail-actions">
        <Link href="/dashboard" className="meridian-action">
          Open SPX desk
        </Link>
        <Link href="/heatmap?ticker=SPX" className="meridian-action">
          Open Thermal
        </Link>
        <Link href="/flows?ticker=SPX" className="meridian-action">
          Open HELIX
        </Link>
        {item.kind === "earnings" && item.ticker && (
          <Link href={`/vector?ticker=${encodeURIComponent(item.ticker)}`} className="meridian-action">
            Open Vector · {item.ticker}
          </Link>
        )}
      </footer>
    </div>
  );
}
