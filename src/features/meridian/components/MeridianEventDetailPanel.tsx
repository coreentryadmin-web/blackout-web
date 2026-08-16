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
  if (kind === "fda") return "FDA";
  return "Earnings";
}

function fmtPrem(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

type Props = {
  item: MeridianTimelineItem;
  detail: MeridianEventDetail | null;
  loading: boolean;
  error: string | null;
};

function HeadlineList({ items, empty }: { items: Array<{ title: string; channel: string | null; published: string | null }>; empty: string }) {
  if (!items.length) return <p className="meridian-card-muted">{empty}</p>;
  return (
    <ul className="meridian-card-list">
      {items.map((row) => (
        <li key={`${row.title}-${row.published ?? ""}`}>
          {row.title}
          {row.channel ? ` · ${row.channel}` : ""}
        </li>
      ))}
    </ul>
  );
}

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
          {(detail.estimate || detail.macro_indicator) && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Macro context</h3>
              {detail.estimate && <p className="meridian-card-value">Consensus {detail.estimate}</p>}
              {detail.macro_indicator && (
                <ul className="meridian-card-list">
                  <li>
                    Last {detail.macro_indicator.label}
                    {detail.macro_indicator.latest_value != null
                      ? `: ${detail.macro_indicator.latest_value}`
                      : ""}
                    {detail.macro_indicator.change_pct != null
                      ? ` (${detail.macro_indicator.change_pct >= 0 ? "+" : ""}${detail.macro_indicator.change_pct}% vs prior)`
                      : ""}
                  </li>
                  {detail.macro_indicator.as_of && <li>As of {detail.macro_indicator.as_of}</li>}
                </ul>
              )}
            </section>
          )}

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

          {detail.release_history.length > 0 && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Prior prints · SPX reaction</h3>
              <ul className="meridian-card-list meridian-history-list">
                {detail.release_history.map((row) => (
                  <li key={row.date}>
                    <span className="meridian-history-date">{row.date.slice(5)}</span>
                    {row.actual != null && row.estimate != null ? (
                      <span>
                        {" "}
                        actual {row.actual} vs est {row.estimate}
                      </span>
                    ) : row.actual != null ? (
                      <span> actual {row.actual}</span>
                    ) : null}
                    <span className="meridian-history-move">
                      {" "}
                      · SPX {fmtPct(row.spx_session_pct)} session
                      {row.spx_next_day_pct != null ? ` / ${fmtPct(row.spx_next_day_pct)} next` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.related_headlines.length > 0 && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Macro headlines</h3>
              <HeadlineList items={detail.related_headlines} empty="" />
            </section>
          )}
        </div>
      )}

      {!loading && !error && detail?.kind === "opex" && (
        <div className="meridian-detail-grid">
          <section className="meridian-card">
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

          <section className="meridian-card">
            <h3 className="meridian-card-label">Expiry pin & flow</h3>
            <ul className="meridian-card-list">
              {detail.expiry_read.max_pain != null && (
                <li>Max pain {detail.expiry_read.max_pain.toLocaleString()}</li>
              )}
              {detail.expiry_read.greek_headline && <li>{detail.expiry_read.greek_headline}</li>}
              {detail.expiry_read.net_flow_label && <li>{detail.expiry_read.net_flow_label}</li>}
              {!detail.expiry_read.max_pain &&
                !detail.expiry_read.greek_headline &&
                !detail.expiry_read.net_flow_label && (
                  <li className="meridian-card-muted">Expiry flow unavailable.</li>
                )}
            </ul>
          </section>

          {detail.prior_opex.length > 0 && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Prior OpEx · SPX reaction</h3>
              <ul className="meridian-card-list meridian-history-list">
                {detail.prior_opex.map((row) => (
                  <li key={row.date}>
                    <span className="meridian-history-date">{row.date.slice(5)}</span>
                    <span className="meridian-history-move">
                      {" "}
                      · SPX {fmtPct(row.spx_session_pct)} session
                      {row.spx_next_day_pct != null ? ` / ${fmtPct(row.spx_next_day_pct)} next` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {!loading && !error && detail?.kind === "fda" && (
        <div className="meridian-detail-grid">
          <section className="meridian-card">
            <h3 className="meridian-card-label">Decision window</h3>
            <ul className="meridian-card-list">
              {detail.drug && <li>{detail.drug}</li>}
              {detail.indication && <li>{detail.indication}</li>}
              {!detail.drug && !detail.indication && <li>FDA decision date on calendar</li>}
            </ul>
          </section>

          <section className="meridian-card">
            <h3 className="meridian-card-label">{detail.ticker} positioning</h3>
            {detail.positioning.available ? (
              <ul className="meridian-card-list">
                {detail.positioning.gamma_regime && <li>{detail.positioning.gamma_regime}</li>}
                {detail.positioning.spot != null && <li>Spot {detail.positioning.spot}</li>}
                {detail.positioning.flip != null && <li>Flip {detail.positioning.flip}</li>}
              </ul>
            ) : (
              <p className="meridian-card-muted">Positioning unavailable.</p>
            )}
          </section>

          <section className="meridian-card meridian-card-wide">
            <h3 className="meridian-card-label">Recent catalyst headlines</h3>
            <HeadlineList items={detail.catalysts} empty="No recent catalyst headlines." />
          </section>

          {detail.prior_decisions.length > 0 && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Prior FDA windows · {detail.ticker}</h3>
              <ul className="meridian-card-list meridian-history-list">
                {detail.prior_decisions.map((row) => (
                  <li key={row.date}>
                    <span className="meridian-history-date">{row.date.slice(5)}</span>
                    {row.drug ? ` · ${row.drug}` : ""}
                    {row.headline ? ` · ${row.headline}` : ""}
                    <span className="meridian-history-move">
                      {" "}
                      · {fmtPct(row.session_change_pct)} session
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {!loading && !error && detail?.kind === "earnings" && (
        <>
          {(detail.enrichment.print_history_summary ||
            detail.enrichment.street_estimates.length > 0 ||
            detail.enrichment.catalysts.length > 0 ||
            detail.enrichment.earnings_headlines.length > 0 ||
            detail.enrichment.print_history.length > 0) && (
            <div className="meridian-detail-grid meridian-earn-enrich">
              {detail.enrichment.print_history_summary && (
                <section className="meridian-card meridian-card-wide">
                  <h3 className="meridian-card-label">Earnings track record</h3>
                  <p className="meridian-card-value">{detail.enrichment.print_history_summary}</p>
                </section>
              )}
              {detail.enrichment.print_history.length > 0 && (
                <section className="meridian-card meridian-card-wide">
                  <h3 className="meridian-card-label">Prior prints · estimate vs actual</h3>
                  <ul className="meridian-card-list meridian-history-list">
                    {detail.enrichment.print_history.map((row) => (
                      <li key={row.report_date ?? "unknown"}>
                        <span className="meridian-history-date">{row.report_date?.slice(5) ?? "—"}</span>
                        {row.eps_estimate != null && row.eps_actual != null ? (
                          <span>
                            {" "}
                            EPS {row.eps_actual} vs est {row.eps_estimate}
                            {row.surprise_pct != null ? ` (${fmtPct(row.surprise_pct)} surprise)` : ""}
                          </span>
                        ) : null}
                        {row.beat != null && (
                          <span className="meridian-history-move">
                            {" "}
                            · {row.beat ? "beat" : "miss"}
                          </span>
                        )}
                        {row.session_change_pct != null && (
                          <span className="meridian-history-move">
                            {" "}
                            · {fmtPct(row.session_change_pct)} session
                            {row.next_day_change_pct != null
                              ? ` / ${fmtPct(row.next_day_change_pct)} next`
                              : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.enrichment.street_estimates.length > 0 && (
                <section className="meridian-card">
                  <h3 className="meridian-card-label">Street estimates</h3>
                  <ul className="meridian-card-list">
                    {detail.enrichment.street_estimates.map((row) => (
                      <li key={row.period ?? `${row.eps_estimate}`}>
                        {row.period ?? "Next print"}
                        {row.eps_estimate != null ? ` · EPS ${row.eps_estimate}` : ""}
                        {row.revenue_estimate != null
                          ? ` · Rev ${row.revenue_estimate.toLocaleString()}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {detail.enrichment.catalysts.length > 0 && (
                <section className="meridian-card">
                  <h3 className="meridian-card-label">Catalyst headlines</h3>
                  <HeadlineList items={detail.enrichment.catalysts} empty="" />
                </section>
              )}
              {detail.enrichment.earnings_headlines.length > 0 && (
                <section className="meridian-card meridian-card-wide">
                  <h3 className="meridian-card-label">Earnings headlines</h3>
                  <HeadlineList items={detail.enrichment.earnings_headlines} empty="" />
                </section>
              )}
            </div>
          )}
          <div className="meridian-earn-wrap">
            <LargoPreEarningsPackCard card={detail.pack} />
          </div>
        </>
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
        {(item.kind === "fda" || item.kind === "earnings") && item.ticker && (
          <Link href={`/heatmap?ticker=${encodeURIComponent(item.ticker)}`} className="meridian-action">
            Open Thermal · {item.ticker}
          </Link>
        )}
      </footer>
    </div>
  );
}
