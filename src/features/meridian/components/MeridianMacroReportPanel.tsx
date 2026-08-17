"use client";

import type { MeridianMacroBrief } from "@/features/meridian/lib/meridian-types";
import { MeridianDataCard } from "./meridian-ui";

function outlookClass(lean: string): string {
  if (lean === "risk_on") return "meridian-verdict-bull";
  if (lean === "risk_off") return "meridian-verdict-bear";
  return "meridian-verdict-neutral";
}

type Props = {
  detail: MeridianMacroBrief;
};

export function MeridianMacroReportPanel({ detail }: Props) {
  const { report } = detail;
  if (!report.available) return null;

  return (
    <section className="meridian-macro-report" aria-label={`${detail.event} macro report`}>
      <div className={`meridian-report-hero ${outlookClass(report.outlook.lean)}`}>
        <div className="meridian-report-hero-glow" aria-hidden="true" />
        <div className="meridian-report-hero-main">
          <p className="meridian-report-kicker">BlackOut macro report</p>
          <div className="meridian-report-verdict-row">
            <span className={`meridian-report-verdict ${outlookClass(report.outlook.lean)}`}>
              {report.outlook.lean.replace("_", " ")}
            </span>
            {detail.impact === "high" && (
              <span className="meridian-report-confidence meridian-macro-impact-high">High impact</span>
            )}
          </div>
          <h3 className="meridian-report-headline">{report.outlook.headline}</h3>
          <p className="meridian-report-summary">{report.outlook.summary}</p>
        </div>
        <div className="meridian-report-play">
          <p className="meridian-report-play-label">Expectations</p>
          <p className="meridian-report-play-headline">{report.expectations.headline}</p>
          {report.expected_move.headline && (
            <p className="meridian-report-play-structure">{report.expected_move.headline}</p>
          )}
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="meridian-macro-warnings" role="note">
          <p className="meridian-macro-warnings-label">Warnings</p>
          <ul className="meridian-macro-warnings-list">
            {report.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="meridian-detail-grid-v2 meridian-report-grid">
        {report.watch_list.length > 0 && (
          <MeridianDataCard label="What to watch" wide tone="macro" delay={0}>
            <ul className="meridian-card-list meridian-watch-list">
              {report.watch_list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </MeridianDataCard>
        )}

        {report.scenarios.length > 0 && (
          <MeridianDataCard label="What could happen" wide tone="macro" delay={80}>
            <ul className="meridian-card-list">
              {report.scenarios.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </MeridianDataCard>
        )}

        {report.news_context.length > 0 && (
          <MeridianDataCard label="News context" wide tone="macro" delay={160}>
            <ul className="meridian-card-list meridian-news-list">
              {report.news_context.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ul>
          </MeridianDataCard>
        )}

        {report.expected_move.available && (
          <MeridianDataCard label="Historical SPX move" tone="macro" delay={240}>
            <ul className="meridian-card-list">
              {report.expected_move.session_pct != null && (
                <li>Session avg {report.expected_move.session_pct >= 0 ? "+" : ""}{report.expected_move.session_pct}%</li>
              )}
              {report.expected_move.intraday_60_pct != null && (
                <li>60m avg {report.expected_move.intraday_60_pct >= 0 ? "+" : ""}{report.expected_move.intraday_60_pct}%</li>
              )}
            </ul>
          </MeridianDataCard>
        )}
      </div>

      <p className="meridian-report-disclaimer">{report.disclaimer}</p>
    </section>
  );
}
