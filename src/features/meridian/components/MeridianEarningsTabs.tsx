"use client";

import { useMemo } from "react";
import type { MeridianEarningsDetail } from "@/features/meridian/lib/meridian-types";
import { LargoPreEarningsPackCard } from "@/features/largo/components/LargoPreEarningsPackCard";
import { fmtPct } from "./MeridianDesk";
import {
  MeridianAnalyticsBanner,
  MeridianDataCard,
  MeridianKV,
} from "./meridian-ui";
import { MeridianEarningsIntelPanel } from "./MeridianEarningsIntelPanel";
import { etWallClockToIso } from "@/lib/meridian/meridian-viz-core";
import { MeridianEarningsReportPanel } from "./MeridianEarningsReportPanel";
import { MeridianEarningsEstimatesPanel } from "./MeridianEarningsEstimatesPanel";
import { MeridianEarningsPositioningPanel } from "./MeridianEarningsPositioningPanel";
import { MeridianEarningsHistoryPanel } from "./MeridianEarningsHistoryPanel";

export type EarningsTab = "report" | "estimates" | "positioning" | "history";

export const EARNINGS_TABS: Array<{ id: EarningsTab; label: string }> = [
  { id: "report", label: "Report" },
  { id: "estimates", label: "Estimates" },
  { id: "positioning", label: "Positioning" },
  { id: "history", label: "History" },
];

function fmtRev(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtSurprisePct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function methodLabel(method: string | null): string | null {
  if (!method) return null;
  if (method === "gaap") return "GAAP";
  if (method === "adj") return "Adj";
  if (method === "ffo") return "FFO";
  return method.toUpperCase();
}

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

/**
 * The tab strip, on its own so the detail panel can mount it in the HEADER BAR rather than
 * above the panel body. Presentational: the selection lives with whoever owns the panel, which
 * is what lets one control sit in the chrome while the content it switches sits below.
 */
export function MeridianEarningsTablist({
  tab,
  onTabChange,
}: {
  tab: EarningsTab;
  onTabChange: (t: EarningsTab) => void;
}) {
  return (
    <div className="meridian-earnings-tablist" role="tablist" aria-label="Earnings brief sections">
      {EARNINGS_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={`meridian-earnings-tab meridian-earnings-tab-${t.id}${tab === t.id ? " is-active" : ""}`}
          onClick={() => onTabChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

type Props = {
  detail: MeridianEarningsDetail;
  /** Controlled by the detail panel, which renders the tablist up in the header. */
  tab: EarningsTab;
};

export function MeridianEarningsTabs({ detail, tab }: Props) {
  const { enrichment, intel, pack } = detail;
  const cal = enrichment.earnings_calendar;
  // The print instant for the countdown. The feed reports an ET WALL CLOCK date + time, so it
  // has to be composed through the DST-aware converter — a hardcoded offset is wrong for
  // roughly half the calendar and reads as a real scheduling error on an event clock.
  const eventAt = etWallClockToIso(cal?.date ?? null, cal?.report_time_et ?? cal?.time ?? null);
  return (
    <div className="meridian-earnings-tabs" data-tab={tab}>
      {/* An outage renders as an explanation, never as an empty panel. Measured 2026-08-18:
          every Benzinga-derived field was empty on 8/8 mega-caps while the same payload's pack
          carried four prints — a reader saw blank tabs and concluded the company had no
          earnings history. Blank is a claim; this is the truth. */}
      {enrichment.calendar_error && (
        <p className="meridian-feed-error" role="status">
          Earnings calendar feed did not respond — estimates and print history are unavailable
          for this refresh. Everything else on this page is live.
        </p>
      )}
      {tab === "report" && (
        <div role="tabpanel" className="meridian-earnings-tabpanel">
          <MeridianEarningsReportPanel
            ticker={pack.ticker}
            intel={intel}
            enrichment={{
              earnings_headlines: enrichment.earnings_headlines,
              catalysts: enrichment.catalysts,
              analyst_revisions: enrichment.analyst_revisions,
              insider_activity: enrichment.insider_activity,
              print_history: enrichment.print_history,
              price_targets: enrichment.price_targets,
              street_skew: enrichment.street_skew,
            }}
            eventAt={eventAt}
          />
          <div className="meridian-banner-stack">
            {enrichment.post_print?.headline && (
              <MeridianAnalyticsBanner
                label="Latest print"
                headline={enrichment.post_print.headline}
                tone="earnings"
                icon={enrichment.post_print.lean === "miss" ? "▼" : "▲"}
              />
            )}
            {enrichment.expected_vs_realized?.headline && (
              <MeridianAnalyticsBanner
                label="Expected vs realized"
                headline={enrichment.expected_vs_realized.headline}
                sub={
                  pack.expected_move_pct != null
                    ? `Implied ~${pack.expected_move_pct}% into print`
                    : null
                }
                tone="earnings"
                icon="◆"
              />
            )}
            {enrichment.analyst_revisions.length > 0 && (
              <MeridianAnalyticsBanner
                label="Analyst cluster"
                headline={`${enrichment.analyst_revisions.length} recent revisions`}
                sub={enrichment.analyst_revisions[0]?.title.slice(0, 90) ?? null}
                tone="earnings"
                icon="✦"
              />
            )}
            {enrichment.catalyst_briefs.length > 0 && (
              <MeridianDataCard label="Catalyst briefs" wide tone="earnings" delay={320}>
                <ul className="meridian-card-list">
                  {enrichment.catalyst_briefs.map((c) => (
                    <li key={`${c.type}-${c.title}`}>
                      {c.type.toUpperCase()} · {c.title}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
          </div>
        </div>
      )}

      {tab === "estimates" && (
        <div role="tabpanel" className="meridian-earnings-tabpanel">
          <MeridianEarningsEstimatesPanel
            ticker={pack.ticker}
            enrichment={enrichment}
            spot={intel.thermal?.spot ?? null}
          />
          {enrichment.street_skew && (
            <MeridianAnalyticsBanner
              label="Street skew (news-derived)"
              headline={enrichment.street_skew.headline}
              sub={
                enrichment.street_skew.latest_target != null
                  ? `${enrichment.street_skew.skew} · latest PT $${enrichment.street_skew.latest_target}${enrichment.street_skew.latest_firm ? ` · ${enrichment.street_skew.latest_firm}` : ""}`
                  : enrichment.street_skew.skew
              }
              tone="earnings"
              icon={enrichment.street_skew.skew === "bullish" ? "▲" : enrichment.street_skew.skew === "bearish" ? "▼" : "◆"}
            />
          )}
          {cal && (
            <MeridianAnalyticsBanner
              label="Earnings calendar"
              headline={
                cal.date_status === "confirmed"
                  ? "Confirmed print date"
                  : cal.date_status === "projected"
                    ? "Projected print date"
                    : "Scheduled print"
              }
              sub={
                cal.fiscal_period && cal.fiscal_year != null
                  ? `${cal.fiscal_period} FY${String(cal.fiscal_year).slice(-2)}${cal.report_time_et ? ` · ${cal.report_time_et} ET` : ""}`
                  : cal.report_time_et
                    ? `${cal.report_time_et} ET`
                    : null
              }
              tone="earnings"
              icon="◈"
            />
          )}
          <div className="meridian-detail-grid-v2 meridian-earn-enrich">
            {cal && (
              <MeridianDataCard label="Calendar print" wide tone="earnings" delay={0}>
                <ul className="meridian-card-list meridian-fin-grid">
                  {cal.estimated_eps != null && <MeridianKV label="EPS est" value={cal.estimated_eps.toFixed(2)} />}
                  {cal.actual_eps != null && <MeridianKV label="EPS actual" value={cal.actual_eps.toFixed(2)} />}
                  {cal.eps_surprise_pct != null && (
                    <MeridianKV
                      label="EPS surprise"
                      value={fmtSurprisePct(cal.eps_surprise_pct)}
                      tone={cal.eps_surprise_pct >= 0 ? "bull" : "bear"}
                    />
                  )}
                  {cal.revenue_surprise_pct != null && (
                    <MeridianKV
                      label="Rev surprise"
                      value={fmtSurprisePct(cal.revenue_surprise_pct)}
                      tone={cal.revenue_surprise_pct >= 0 ? "bull" : "bear"}
                    />
                  )}
                  {(cal.eps_method || cal.revenue_method) && (
                    <li>
                      Methodology
                      {cal.eps_method ? ` · EPS ${methodLabel(cal.eps_method)}` : ""}
                      {cal.revenue_method ? ` · Rev ${methodLabel(cal.revenue_method)}` : ""}
                    </li>
                  )}
                  {cal.estimated_revenue != null && (
                    <MeridianKV label="Revenue est" value={fmtRev(cal.estimated_revenue)} />
                  )}
                  {cal.actual_revenue != null && (
                    <MeridianKV label="Revenue actual" value={fmtRev(cal.actual_revenue)} />
                  )}
                  {cal.previous_eps != null && (
                    <MeridianKV label="Prior EPS" value={cal.previous_eps.toFixed(2)} />
                  )}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.earnings_yoy && (
              <MeridianDataCard label="YoY estimate trajectory" tone="earnings" delay={40}>
                <ul className="meridian-card-list meridian-fin-grid">
                  {enrichment.earnings_yoy.eps_yoy_pct != null && (
                    <MeridianKV
                      label="EPS est YoY"
                      value={fmtPct(enrichment.earnings_yoy.eps_yoy_pct)}
                      tone={enrichment.earnings_yoy.eps_yoy_pct >= 0 ? "bull" : "bear"}
                    />
                  )}
                  {enrichment.earnings_yoy.revenue_yoy_pct != null && (
                    <MeridianKV
                      label="Revenue est YoY"
                      value={fmtPct(enrichment.earnings_yoy.revenue_yoy_pct)}
                      tone={enrichment.earnings_yoy.revenue_yoy_pct >= 0 ? "bull" : "bear"}
                    />
                  )}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.corporate_guidance && (
              <MeridianDataCard label="Management guidance" wide tone="earnings" delay={120}>
                <ul className="meridian-card-list meridian-fin-grid">
                  {enrichment.corporate_guidance.min_eps != null &&
                    enrichment.corporate_guidance.max_eps != null && (
                      <li>
                        EPS guide {enrichment.corporate_guidance.min_eps} – {enrichment.corporate_guidance.max_eps}
                      </li>
                    )}
                  {enrichment.corporate_guidance.min_revenue != null &&
                    enrichment.corporate_guidance.max_revenue != null && (
                      <li>
                        Rev guide {fmtRev(enrichment.corporate_guidance.min_revenue)} –{" "}
                        {fmtRev(enrichment.corporate_guidance.max_revenue)}
                      </li>
                    )}
                  {enrichment.corporate_guidance.notes && (
                    <li>{enrichment.corporate_guidance.notes}</li>
                  )}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.beat_rates && (
              <MeridianDataCard label="Historical beat rates" tone="earnings" delay={160}>
                <ul className="meridian-card-list meridian-fin-grid">
                  {enrichment.beat_rates.eps_beat_rate != null && (
                    <MeridianKV
                      label="EPS beats"
                      value={`${Math.round(enrichment.beat_rates.eps_beat_rate * 100)}%`}
                      tone={enrichment.beat_rates.eps_beat_rate >= 0.5 ? "bull" : "bear"}
                    />
                  )}
                  {enrichment.beat_rates.revenue_beat_rate != null && (
                    <MeridianKV
                      label="Revenue beats"
                      value={`${Math.round(enrichment.beat_rates.revenue_beat_rate * 100)}%`}
                      tone={enrichment.beat_rates.revenue_beat_rate >= 0.5 ? "bull" : "bear"}
                    />
                  )}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.street_estimates.length > 0 && (
              <MeridianDataCard label="Street estimates" wide tone="earnings" delay={80}>
                <ul className="meridian-card-list">
                  {enrichment.street_estimates.map((row) => (
                    <MeridianKV
                      key={row.period ?? "unknown"}
                      label={
                        <>
                          {row.period ?? "Next"}
                          {row.source === "earnings_calendar" ? (
                            <span className="meridian-kv-note"> calendar</span>
                          ) : null}
                        </>
                      }
                      value={
                        <>
                          {row.eps_estimate != null ? `EPS ${row.eps_estimate}` : ""}
                          {row.eps_estimate != null && row.revenue_estimate != null ? " · " : ""}
                          {row.revenue_estimate != null ? fmtRev(row.revenue_estimate) : ""}
                        </>
                      }
                    />
                  ))}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.price_targets.length > 0 && (
              <MeridianDataCard label="Price targets" wide tone="earnings" delay={100}>
                <ul className="meridian-card-list">
                  {enrichment.price_targets.map((pt) => (
                    <MeridianKV
                      key={`${pt.firm}-${pt.published}-${pt.price_target}`}
                      label={
                        <>
                          {pt.firm ?? "Analyst"}
                          {pt.action ? <span className="meridian-kv-note"> {pt.action}</span> : null}
                        </>
                      }
                      value={`$${pt.price_target}`}
                      tone={pt.action === "raised" ? "bull" : pt.action === "lowered" ? "bear" : undefined}
                    />
                  ))}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.estimate_revisions.length > 0 && (
              <MeridianDataCard label="Estimate revision timeline" wide tone="earnings" delay={140}>
                <ul className="meridian-card-list">
                  {enrichment.estimate_revisions.map((r) => (
                    <li key={`${r.last_updated}-${r.change_kind}`}>
                      {r.headline}
                      {r.eps_delta != null ? ` · EPS Δ ${r.eps_delta >= 0 ? "+" : ""}${r.eps_delta}` : ""}
                      {r.revenue_delta_pct != null
                        ? ` · Rev ${r.revenue_delta_pct >= 0 ? "+" : ""}${r.revenue_delta_pct}%`
                        : ""}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
          </div>
          <div className="meridian-earn-wrap">
            <LargoPreEarningsPackCard card={pack} />
          </div>
        </div>
      )}

      {tab === "positioning" && (
        <div role="tabpanel" className="meridian-earnings-tabpanel">
          <MeridianEarningsPositioningPanel ticker={pack.ticker} intel={intel} />
          <MeridianEarningsIntelPanel
            intel={intel}
            printHistory={[]}
            tickerExpectedMovePct={pack.expected_move_pct}
          />
        </div>
      )}

      {tab === "history" && (
        <div role="tabpanel" className="meridian-earnings-tabpanel">
          <MeridianEarningsHistoryPanel ticker={pack.ticker} enrichment={enrichment} intel={intel} />
          {enrichment.print_history_summary && (
            <MeridianAnalyticsBanner
              label="Track record"
              headline={enrichment.print_history_summary}
              tone="earnings"
              icon="▣"
            />
          )}
          <div className="meridian-detail-grid-v2 meridian-earn-enrich">
            {enrichment.print_history.length > 0 && (
              <MeridianDataCard label="Print track · est vs actual" wide tone="earnings" delay={0}>
                <ul className="meridian-card-list meridian-history-list meridian-print-track">
                  {enrichment.print_history.map((row) => (
                    <li key={row.report_date ?? "unknown"}>
                      <span className="meridian-history-date">{row.report_date?.slice(5) ?? "—"}</span>
                      {row.eps_estimate != null && row.eps_actual != null ? (
                        <span>
                          {" "}
                          EPS {row.eps_actual} vs {row.eps_estimate}
                        </span>
                      ) : null}
                      {row.session_change_pct != null && (
                        <span className="meridian-history-move">
                          {" "}
                          · {fmtPct(row.session_change_pct)} session
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.analyst_revisions.length > 0 && (
              <MeridianDataCard label="Analyst revisions" wide tone="earnings" delay={80}>
                <ul className="meridian-card-list">
                  {enrichment.analyst_revisions.map((r) => (
                    <li key={`${r.title}-${r.published ?? ""}`}>
                      {r.title}
                      {r.firm ? ` · ${r.firm}` : ""}
                      {r.action ? ` · ${r.action}` : ""}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
            {(enrichment.insider_activity.length > 0 || enrichment.congress_trades.length > 0) && (
              <MeridianDataCard label="Insider & congress" wide tone="earnings" delay={160}>
                <ul className="meridian-card-list">
                  {enrichment.insider_activity.slice(0, 5).map((r) => (
                    <li key={r.title}>{r.title}</li>
                  ))}
                  {enrichment.congress_trades.slice(0, 4).map((r, i) => (
                    <li key={`${r.politician}-${i}`}>
                      {r.politician ?? "Congress"} · {r.transaction ?? "trade"}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
            {(enrichment.earnings_headlines.length > 0 || enrichment.catalysts.length > 0) && (
              <MeridianDataCard label="Earnings headlines" wide tone="earnings" delay={240}>
                <HeadlineList
                  items={[...enrichment.earnings_headlines, ...enrichment.catalysts].slice(0, 8)}
                  empty="No recent earnings headlines."
                />
              </MeridianDataCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
