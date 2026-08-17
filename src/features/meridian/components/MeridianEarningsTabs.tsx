"use client";

import { useState } from "react";
import type { MeridianEarningsDetail } from "@/features/meridian/lib/meridian-types";
import { LargoPreEarningsPackCard } from "@/features/largo/components/LargoPreEarningsPackCard";
import { fmtPct } from "./MeridianDesk";
import {
  MeridianAnalyticsBanner,
  MeridianDataCard,
} from "./meridian-ui";
import { MeridianEarningsIntelPanel } from "./MeridianEarningsIntelPanel";
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

function fmtSurprise(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
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
  const [tab, setTab] = useState<EarningsTab>("report");
  const { enrichment, intel, pack } = detail;
  const cal = enrichment.earnings_calendar;

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
            }}
          />
          <div className="meridian-banner-stack">
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
          </div>
        </div>
      )}

      {tab === "estimates" && (
        <div role="tabpanel" className="meridian-earnings-tabpanel">
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
                  ? `${cal.fiscal_period} FY${String(cal.fiscal_year).slice(-2)}${cal.time ? ` · ${cal.time.slice(0, 5)} ET` : ""}`
                  : cal.time
                    ? `${cal.time.slice(0, 5)} ET`
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
                    <li>EPS surprise {fmtSurprise(cal.eps_surprise_pct)}</li>
                  )}
                  {cal.estimated_revenue != null && (
                    <li>Revenue est {fmtRev(cal.estimated_revenue)}</li>
                  )}
                  {cal.actual_revenue != null && <li>Revenue actual {fmtRev(cal.actual_revenue)}</li>}
                  {cal.previous_eps != null && <li>Prior EPS {cal.previous_eps.toFixed(2)}</li>}
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
