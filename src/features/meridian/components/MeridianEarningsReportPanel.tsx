"use client";

import type {
  MeridianCatalystHeadline,
  MeridianEarningsEnrichment,
  MeridianEarningsIntel,
  MeridianEarningsReportSignal,
} from "@/features/meridian/lib/meridian-types";
import { MeridianDataCard } from "./meridian-ui";

function verdictClass(verdict: string): string {
  if (verdict === "bullish") return "meridian-verdict-bull";
  if (verdict === "bearish") return "meridian-verdict-bear";
  return "meridian-verdict-neutral";
}

function signalLeanClass(lean: MeridianEarningsReportSignal["lean"]): string {
  if (lean === "bullish") return "meridian-signal-bull";
  if (lean === "bearish") return "meridian-signal-bear";
  return "meridian-signal-neutral";
}

function HeadlineList({ items, empty }: { items: MeridianCatalystHeadline[]; empty: string }) {
  if (!items.length) return <p className="meridian-card-muted">{empty}</p>;
  return (
    <ul className="meridian-card-list meridian-news-list">
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
  ticker: string;
  intel: MeridianEarningsIntel;
  enrichment: Pick<
    MeridianEarningsEnrichment,
    "earnings_headlines" | "catalysts" | "analyst_revisions" | "insider_activity"
  >;
};

export function MeridianEarningsReportPanel({ ticker, intel, enrichment }: Props) {
  const { report, vector } = intel;
  if (!report.available) return null;

  const newsItems = [...enrichment.earnings_headlines, ...enrichment.catalysts].slice(0, 8);

  return (
    <section className="meridian-earnings-report" aria-label={`${ticker} earnings report`}>
      <div className={`meridian-report-hero ${verdictClass(report.verdict)}`}>
        <div className="meridian-report-hero-glow" aria-hidden="true" />
        <div className="meridian-report-hero-main">
          <p className="meridian-report-kicker">BlackOut earnings report</p>
          <div className="meridian-report-verdict-row">
            <span className={`meridian-report-verdict ${verdictClass(report.verdict)}`}>
              {report.verdict}
            </span>
            <span className="meridian-report-confidence">{report.confidence} confidence</span>
            <span className="meridian-report-score">
              Score {report.score >= 0 ? "+" : ""}
              {report.score}
            </span>
          </div>
          <h3 className="meridian-report-headline">{report.headline}</h3>
          <p className="meridian-report-summary">{report.summary}</p>
        </div>
        <div className="meridian-report-play">
          <p className="meridian-report-play-label">Best play read</p>
          <p className="meridian-report-play-headline">{report.best_play.headline}</p>
          <p className="meridian-report-play-structure">{report.best_play.structure}</p>
          <p className="meridian-report-play-risk">{report.best_play.risk}</p>
        </div>
      </div>

      <div className="meridian-report-signals" aria-label="Signal pillars">
        {report.signals.map((sig) => (
          <div
            key={sig.pillar}
            className={`meridian-report-signal ${signalLeanClass(sig.lean)}`}
          >
            <div className="meridian-report-signal-head">
              <span className="meridian-report-signal-label">{sig.label}</span>
              <span className={`meridian-report-signal-lean ${signalLeanClass(sig.lean)}`}>
                {sig.lean}
              </span>
            </div>
            <p className="meridian-report-signal-detail">{sig.detail}</p>
            {sig.weight > 0 && sig.score !== 0 && (
              <span className="meridian-report-signal-score">
                {sig.score > 0 ? "+" : ""}
                {sig.score}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="meridian-detail-grid-v2 meridian-report-grid">
        {vector.available && (
          <MeridianDataCard label="Vector expected move" tone="earnings" delay={0}>
            {vector.move_pct != null && (
              <p className="meridian-card-value">~{vector.move_pct}% implied</p>
            )}
            {vector.expiry && <p className="meridian-card-muted">Front expiry · {vector.expiry}</p>}
            {vector.bands && vector.bands.length > 0 && (
              <ul className="meridian-card-list">
                {vector.bands.map((b) => (
                  <li key={b.sigma}>
                    {b.sigma}σ {b.low.toLocaleString()} – {b.high.toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </MeridianDataCard>
        )}

        {newsItems.length > 0 && (
          <MeridianDataCard label="News & catalysts" wide tone="earnings" delay={80}>
            <HeadlineList items={newsItems} empty="" />
          </MeridianDataCard>
        )}

        {enrichment.analyst_revisions.length > 0 && (
          <MeridianDataCard label="Analyst revisions" tone="earnings" delay={160}>
            <ul className="meridian-card-list">
              {enrichment.analyst_revisions.slice(0, 5).map((r) => (
                <li key={r.title}>
                  {r.title}
                  {r.action ? ` · ${r.action}` : ""}
                </li>
              ))}
            </ul>
          </MeridianDataCard>
        )}

        {enrichment.insider_activity.length > 0 && (
          <MeridianDataCard label="Insider filings" tone="earnings" delay={240}>
            <ul className="meridian-card-list">
              {enrichment.insider_activity.slice(0, 4).map((r) => (
                <li key={r.title}>{r.title}</li>
              ))}
            </ul>
          </MeridianDataCard>
        )}
      </div>

      <p className="meridian-report-disclaimer">{report.risk_note}</p>
    </section>
  );
}
