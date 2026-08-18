"use client";

import { useEffect, useRef, useState } from "react";
import type { MeridianEarningsDetail } from "@/features/meridian/lib/meridian-types";
import { LargoPreEarningsPackCard } from "@/features/largo/components/LargoPreEarningsPackCard";
import { fmtPct } from "./MeridianDesk";
import {
  MeridianAnalyticsBanner,
  MeridianDataCard,
} from "./meridian-ui";
import { MeridianEarningsIntelPanel } from "./MeridianEarningsIntelPanel";
import { etWallClockToIso } from "@/lib/meridian/meridian-viz-core";
import { MeridianEarningsReportPanel } from "./MeridianEarningsReportPanel";

type EarningsTab = "report" | "estimates" | "positioning" | "history";

const TABS: Array<{ id: EarningsTab; label: string }> = [
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

type Props = {
  detail: MeridianEarningsDetail;
};

export function MeridianEarningsTabs({ detail }: Props) {
  const { enrichment, intel, pack } = detail;
  const cal = enrichment.earnings_calendar;
  // The print instant for the countdown. The feed reports an ET WALL CLOCK date + time, so it
  // has to be composed through the DST-aware converter — a hardcoded offset is wrong for
  // roughly half the calendar and reads as a real scheduling error on an event clock.
  const eventAt = etWallClockToIso(cal?.date ?? null, cal?.report_time_et ?? cal?.time ?? null);
  const defaultTab: EarningsTab = enrichment.post_print?.headline ? "estimates" : "report";
  const [tab, setTab] = useState<EarningsTab>(defaultTab);
  const hadActualRef = useRef(Boolean(cal?.actual_eps != null));

  useEffect(() => {
    const hasActual = cal?.actual_eps != null;
    if (hasActual && !hadActualRef.current) {
      setTab("estimates");
    }
    hadActualRef.current = hasActual;
  }, [cal?.actual_eps]);

  useEffect(() => {
    if (enrichment.post_print?.headline) setTab("estimates");
  }, [enrichment.post_print?.headline]);

  return (
    <div className="meridian-earnings-tabs">
      <div className="meridian-earnings-tablist" role="tablist" aria-label="Earnings brief sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`meridian-earnings-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                  {cal.estimated_eps != null && <li>EPS est {cal.estimated_eps.toFixed(2)}</li>}
                  {cal.actual_eps != null && <li>EPS actual {cal.actual_eps.toFixed(2)}</li>}
                  {cal.eps_surprise_pct != null && (
                    <li>EPS surprise {fmtSurprisePct(cal.eps_surprise_pct)}</li>
                  )}
                  {cal.revenue_surprise_pct != null && (
                    <li>Rev surprise {fmtSurprisePct(cal.revenue_surprise_pct)}</li>
                  )}
                  {(cal.eps_method || cal.revenue_method) && (
                    <li>
                      Methodology
                      {cal.eps_method ? ` · EPS ${methodLabel(cal.eps_method)}` : ""}
                      {cal.revenue_method ? ` · Rev ${methodLabel(cal.revenue_method)}` : ""}
                    </li>
                  )}
                  {cal.estimated_revenue != null && (
                    <li>Revenue est {fmtRev(cal.estimated_revenue)}</li>
                  )}
                  {cal.actual_revenue != null && <li>Revenue actual {fmtRev(cal.actual_revenue)}</li>}
                  {cal.previous_eps != null && <li>Prior EPS {cal.previous_eps.toFixed(2)}</li>}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.earnings_yoy && (
              <MeridianDataCard label="YoY estimate trajectory" tone="earnings" delay={40}>
                <ul className="meridian-card-list meridian-fin-grid">
                  {enrichment.earnings_yoy.eps_yoy_pct != null && (
                    <li>EPS est {fmtPct(enrichment.earnings_yoy.eps_yoy_pct)} YoY</li>
                  )}
                  {enrichment.earnings_yoy.revenue_yoy_pct != null && (
                    <li>Revenue est {fmtPct(enrichment.earnings_yoy.revenue_yoy_pct)} YoY</li>
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
            {!enrichment.guidance_entitled && !enrichment.corporate_guidance && (
              <MeridianDataCard label="Management guidance" tone="earnings" delay={120}>
                <p className="meridian-card-muted">
                  Corporate guidance feed not enabled on this plan — earnings calendar still live.
                </p>
              </MeridianDataCard>
            )}
            {enrichment.beat_rates && (
              <MeridianDataCard label="Historical beat rates" tone="earnings" delay={160}>
                <ul className="meridian-card-list meridian-fin-grid">
                  {enrichment.beat_rates.eps_beat_rate != null && (
                    <li>EPS beats {Math.round(enrichment.beat_rates.eps_beat_rate * 100)}%</li>
                  )}
                  {enrichment.beat_rates.revenue_beat_rate != null && (
                    <li>Revenue beats {Math.round(enrichment.beat_rates.revenue_beat_rate * 100)}%</li>
                  )}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.street_estimates.length > 0 && (
              <MeridianDataCard label="Street estimates" wide tone="earnings" delay={80}>
                <ul className="meridian-card-list">
                  {enrichment.street_estimates.map((row) => (
                    <li key={row.period ?? "unknown"}>
                      {row.period ?? "Next"}
                      {row.eps_estimate != null ? ` · EPS est ${row.eps_estimate}` : ""}
                      {row.revenue_estimate != null
                        ? ` · Rev est ${fmtRev(row.revenue_estimate)}`
                        : ""}
                      {row.source === "earnings_calendar" ? " · calendar" : ""}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
            {enrichment.price_targets.length > 0 && (
              <MeridianDataCard label="Price targets" wide tone="earnings" delay={100}>
                <ul className="meridian-card-list">
                  {enrichment.price_targets.map((pt) => (
                    <li key={`${pt.firm}-${pt.published}-${pt.price_target}`}>
                      ${pt.price_target}
                      {pt.firm ? ` · ${pt.firm}` : ""}
                      {pt.action ? ` · ${pt.action}` : ""}
                      {pt.summary ? ` — ${pt.summary.slice(0, 80)}` : ""}
                    </li>
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
          <MeridianEarningsIntelPanel
            intel={intel}
            printHistory={[]}
            tickerExpectedMovePct={pack.expected_move_pct}
          />
        </div>
      )}

      {tab === "history" && (
        <div role="tabpanel" className="meridian-earnings-tabpanel">
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
