"use client";

import Link from "next/link";
import type { MeridianEventDetail, MeridianTimelineItem } from "@/features/meridian/lib/meridian-types";
import { LargoPreEarningsPackCard } from "@/features/largo/components/LargoPreEarningsPackCard";
import { FreshnessChip } from "@/components/ui";
import { fmtPct } from "./MeridianDesk";

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

type Props = {
  item: MeridianTimelineItem;
  detail: MeridianEventDetail | null;
  loading: boolean;
  error: string | null;
  boardTickers?: string[];
};

function HeadlineList({
  items,
  empty,
}: {
  items: Array<{ title: string; channel: string | null; published: string | null }>;
  empty: string;
}) {
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

function AnalyticsHero({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="meridian-analytics-tile">
      <p className="meridian-analytics-label">{label}</p>
      <p className="meridian-analytics-value">{value}</p>
      {sub && <p className="meridian-analytics-sub">{sub}</p>}
    </div>
  );
}

function DeepLinks({
  item,
  boardTickers,
}: {
  item: MeridianTimelineItem;
  boardTickers: string[];
}) {
  const ticker = item.ticker?.toUpperCase();
  const onBoard = ticker ? boardTickers.includes(ticker) : false;
  return (
    <footer className="meridian-detail-actions">
      <Link href="/dashboard" className="meridian-action meridian-action-primary">
        SPX desk
      </Link>
      <Link href="/heatmap?ticker=SPX" className="meridian-action">
        Thermal · SPX
      </Link>
      <Link href="/flows?ticker=SPX" className="meridian-action">
        HELIX · SPX
      </Link>
      {ticker && (
        <>
          <Link href={`/vector?ticker=${encodeURIComponent(ticker)}`} className="meridian-action">
            Vector · {ticker}
          </Link>
          <Link href={`/heatmap?ticker=${encodeURIComponent(ticker)}`} className="meridian-action">
            Thermal · {ticker}
          </Link>
          <Link href={`/flows?ticker=${encodeURIComponent(ticker)}`} className="meridian-action">
            HELIX · {ticker}
          </Link>
          {onBoard && (
            <Link href="/nighthawk" className="meridian-action meridian-action-accent">
              Night Hawk · {ticker} on board
            </Link>
          )}
        </>
      )}
    </footer>
  );
}

export function MeridianEventDetailPanel({ item, detail, loading, error, boardTickers = [] }: Props) {
  return (
    <div className="meridian-detail" role="region" aria-label="Event structure brief">
      <header className="meridian-detail-head">
        <div>
          <p className="meridian-detail-kicker">
            {kindChip(item.kind)} · {impactLabel(item.impact)}
          </p>
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
        <>
          <div className="meridian-analytics-row">
            <AnalyticsHero
              label="Event correlation"
              value={detail.correlation_rail.headline}
              sub={
                detail.correlation_rail.regime_tag !== "unknown"
                  ? `Regime · ${detail.correlation_rail.regime_tag.replace("_", " ")}`
                  : undefined
              }
            />
            {detail.surprise && detail.surprise.verdict !== "unknown" && (
              <AnalyticsHero
                label="Surprise vs consensus"
                value={`${detail.surprise.verdict} · ${fmtPct(detail.surprise.surprise_pct)}`}
                sub={`History ${detail.surprise.historical.beats} beats / ${detail.surprise.historical.misses} misses`}
              />
            )}
          </div>

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
                  </ul>
                )}
              </section>
            )}

            <section className="meridian-card">
              <h3 className="meridian-card-label">SPX positioning</h3>
              {detail.spx_positioning.available ? (
                <ul className="meridian-card-list">
                  {detail.spx_positioning.gamma_regime && <li>{detail.spx_positioning.gamma_regime}</li>}
                  {detail.spx_positioning.spot != null && (
                    <li>Spot {detail.spx_positioning.spot.toLocaleString()}</li>
                  )}
                  {detail.spx_positioning.flip_distance_pts != null && (
                    <li>Flip distance {detail.spx_positioning.flip_distance_pts} pts</li>
                  )}
                </ul>
              ) : (
                <p className="meridian-card-muted">SPX positioning unavailable.</p>
              )}
            </section>

            <section className="meridian-card">
              <h3 className="meridian-card-label">HELIX flow skew</h3>
              {detail.flow.available ? (
                <>
                  {detail.flow.call_put_ratio != null && (
                    <p className="meridian-card-value">C/P {detail.flow.call_put_ratio.toFixed(2)}</p>
                  )}
                  <p className="meridian-card-muted">{detail.flow.summary}</p>
                </>
              ) : (
                <p className="meridian-card-muted">Flow skew unavailable.</p>
              )}
            </section>

            {detail.release_history.length > 0 && (
              <section className="meridian-card meridian-card-wide">
                <h3 className="meridian-card-label">Prior prints · session + 60m reaction</h3>
                <ul className="meridian-card-list meridian-history-list">
                  {detail.release_history.map((row) => (
                    <li key={row.date}>
                      <span className="meridian-history-date">{row.date.slice(5)}</span>
                      {row.actual != null && row.estimate != null ? (
                        <span> actual {row.actual} vs est {row.estimate}</span>
                      ) : null}
                      <span className="meridian-history-move">
                        {" "}
                        · SPX {fmtPct(row.spx_session_pct)} session
                        {row.spx_intraday_60_pct != null
                          ? ` / ${fmtPct(row.spx_intraday_60_pct)} 60m`
                          : ""}
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
        </>
      )}

      {!loading && !error && detail?.kind === "opex" && (
        <>
          <div className="meridian-analytics-row">
            <AnalyticsHero label="OpEx pin accuracy" value={detail.pin_accuracy.headline} />
          </div>
          <div className="meridian-detail-grid">
            <section className="meridian-card">
              <h3 className="meridian-card-label">SPX structure</h3>
              {detail.spx_positioning.available ? (
                <ul className="meridian-card-list">
                  {detail.spx_positioning.gamma_regime && <li>{detail.spx_positioning.gamma_regime}</li>}
                  {detail.expiry_read.max_pain != null && (
                    <li>Max pain {detail.expiry_read.max_pain.toLocaleString()}</li>
                  )}
                </ul>
              ) : (
                <p className="meridian-card-muted">SPX positioning unavailable.</p>
              )}
            </section>

            <section className="meridian-card">
              <h3 className="meridian-card-label">Expiry pin & flow</h3>
              <ul className="meridian-card-list">
                {detail.expiry_read.greek_headline && <li>{detail.expiry_read.greek_headline}</li>}
                {detail.expiry_read.net_flow_label && <li>{detail.expiry_read.net_flow_label}</li>}
              </ul>
            </section>

            {detail.prior_opex.length > 0 && (
              <section className="meridian-card meridian-card-wide">
                <h3 className="meridian-card-label">Prior OpEx · pin vs close</h3>
                <ul className="meridian-card-list meridian-history-list">
                  {detail.prior_opex.map((row) => (
                    <li key={row.date}>
                      <span className="meridian-history-date">{row.date.slice(5)}</span>
                      {row.max_pain != null && row.spx_close != null ? (
                        <span>
                          {" "}
                          close {row.spx_close.toLocaleString()} vs max pain {row.max_pain.toLocaleString()}
                          {row.pin_held != null ? (row.pin_held ? " · held" : " · missed") : ""}
                        </span>
                      ) : (
                        <span className="meridian-history-move">
                          {" "}
                          · SPX {fmtPct(row.spx_session_pct)} session
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}

      {!loading && !error && detail?.kind === "fda" && (
        <div className="meridian-detail-grid">
          <section className="meridian-card">
            <h3 className="meridian-card-label">Decision window</h3>
            <ul className="meridian-card-list">
              {detail.drug && <li>{detail.drug}</li>}
              {detail.indication && <li>{detail.indication}</li>}
            </ul>
          </section>

          <section className="meridian-card">
            <h3 className="meridian-card-label">{detail.ticker} positioning</h3>
            {detail.positioning.available ? (
              <ul className="meridian-card-list">
                {detail.positioning.gamma_regime && <li>{detail.positioning.gamma_regime}</li>}
                {detail.positioning.spot != null && <li>Spot {detail.positioning.spot}</li>}
              </ul>
            ) : (
              <p className="meridian-card-muted">Positioning unavailable.</p>
            )}
          </section>

          {(detail.insider_activity.length > 0 || detail.congress_trades.length > 0) && (
            <section className="meridian-card meridian-card-wide">
              <h3 className="meridian-card-label">Insider & congress</h3>
              <ul className="meridian-card-list">
                {detail.insider_activity.slice(0, 4).map((r) => (
                  <li key={r.title}>{r.title}</li>
                ))}
                {detail.congress_trades.slice(0, 3).map((r, i) => (
                  <li key={`${r.politician}-${i}`}>
                    {r.politician ?? "Congress"} · {r.transaction ?? "trade"}
                    {r.published ? ` · ${r.published}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="meridian-card meridian-card-wide">
            <h3 className="meridian-card-label">Catalyst headlines</h3>
            <HeadlineList items={detail.catalysts} empty="No recent catalyst headlines." />
          </section>
        </div>
      )}

      {!loading && !error && detail?.kind === "earnings" && (
        <>
          {(detail.enrichment.expected_vs_realized?.headline ||
            detail.enrichment.analyst_revisions.length > 0) && (
            <div className="meridian-analytics-row">
              {detail.enrichment.expected_vs_realized?.headline && (
                <AnalyticsHero
                  label="Expected vs realized"
                  value={detail.enrichment.expected_vs_realized.headline}
                  sub={
                    detail.pack.expected_move_pct != null
                      ? `Implied ~${detail.pack.expected_move_pct}% into print`
                      : undefined
                  }
                />
              )}
              {detail.enrichment.analyst_revisions.length > 0 && (
                <AnalyticsHero
                  label="Analyst cluster"
                  value={`${detail.enrichment.analyst_revisions.length} recent revisions`}
                  sub={detail.enrichment.analyst_revisions[0]?.title.slice(0, 80)}
                />
              )}
            </div>
          )}

          <div className="meridian-detail-grid meridian-earn-enrich">
            {detail.enrichment.print_history_summary && (
              <section className="meridian-card meridian-card-wide">
                <h3 className="meridian-card-label">Earnings track record</h3>
                <p className="meridian-card-value">{detail.enrichment.print_history_summary}</p>
              </section>
            )}
            {detail.enrichment.print_history.length > 0 && (
              <section className="meridian-card meridian-card-wide">
                <h3 className="meridian-card-label">Prior prints</h3>
                <ul className="meridian-card-list meridian-history-list">
                  {detail.enrichment.print_history.map((row) => (
                    <li key={row.report_date ?? "unknown"}>
                      <span className="meridian-history-date">{row.report_date?.slice(5) ?? "—"}</span>
                      {row.eps_estimate != null && row.eps_actual != null ? (
                        <span> EPS {row.eps_actual} vs est {row.eps_estimate}</span>
                      ) : null}
                      {row.session_change_pct != null && (
                        <span className="meridian-history-move"> · {fmtPct(row.session_change_pct)} session</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {detail.enrichment.analyst_revisions.length > 0 && (
              <section className="meridian-card">
                <h3 className="meridian-card-label">Analyst revisions</h3>
                <ul className="meridian-card-list">
                  {detail.enrichment.analyst_revisions.slice(0, 5).map((r) => (
                    <li key={r.title}>
                      {r.title}
                      {r.action ? ` · ${r.action}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(detail.enrichment.insider_activity.length > 0 ||
              detail.enrichment.congress_trades.length > 0) && (
              <section className="meridian-card">
                <h3 className="meridian-card-label">Insider & congress</h3>
                <ul className="meridian-card-list">
                  {detail.enrichment.insider_activity.slice(0, 3).map((r) => (
                    <li key={r.title}>{r.title}</li>
                  ))}
                  {detail.enrichment.congress_trades.slice(0, 2).map((r, i) => (
                    <li key={`c-${i}`}>
                      {r.politician ?? "Congress"} · {r.ticker ?? item.ticker}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <div className="meridian-earn-wrap">
            <LargoPreEarningsPackCard card={detail.pack} />
          </div>
        </>
      )}

      <DeepLinks item={item} boardTickers={boardTickers} />
    </div>
  );
}
