"use client";

import type { MeridianOpexDetail } from "@/features/meridian/lib/meridian-types";
import { MeridianDataCard } from "./meridian-ui";

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function pctClass(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "meridian-pct-flat";
  if (n >= 0.15) return "meridian-pct-up";
  if (n <= -0.15) return "meridian-pct-down";
  return "meridian-pct-flat";
}

function outlookClass(lean: string): string {
  if (lean === "risk_on") return "meridian-verdict-bull";
  if (lean === "risk_off") return "meridian-verdict-bear";
  return "meridian-verdict-neutral";
}

type Props = {
  detail: MeridianOpexDetail;
};

export function MeridianOpexCrossMarketPanel({ detail }: Props) {
  const { cross_market: cm, report } = detail;
  if (!cm.available) return null;

  return (
    <section className="meridian-opex-cross-market" aria-label="OpEx cross-market history">
      {report.available && (
        <div className={`meridian-report-hero ${outlookClass(report.outlook.lean)}`}>
          <div className="meridian-report-hero-glow" aria-hidden="true" />
          <div className="meridian-report-hero-main">
            <p className="meridian-report-kicker">BlackOut OpEx report</p>
            <div className="meridian-report-verdict-row">
              <span className={`meridian-report-verdict ${outlookClass(report.outlook.lean)}`}>
                {report.outlook.lean.replace("_", " ")}
              </span>
              <span className="meridian-report-score">{cm.sample_size} prior sessions</span>
            </div>
            <h3 className="meridian-report-headline">{report.outlook.headline}</h3>
            <p className="meridian-report-summary">{report.outlook.summary}</p>
          </div>
          {cm.headline && (
            <div className="meridian-report-play">
              <p className="meridian-report-play-label">Cross-market avg</p>
              <p className="meridian-report-play-headline">{cm.headline}</p>
              {cm.aggregates.divergence_headline && (
                <p className="meridian-report-play-structure">{cm.aggregates.divergence_headline}</p>
              )}
            </div>
          )}
        </div>
      )}

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
        <MeridianDataCard label="Prior OpEx · cross-market" wide tone="opex" delay={0}>
          <div className="meridian-opex-table-wrap">
            <table className="meridian-opex-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">SPX</th>
                  <th scope="col">QQQ</th>
                  <th scope="col">SPY</th>
                  <th scope="col">Mag 7</th>
                  <th scope="col">Top +</th>
                  <th scope="col">Top −</th>
                </tr>
              </thead>
              <tbody>
                {cm.rows.map((row) => (
                  <tr key={row.date}>
                    <td className="meridian-opex-date">{row.date.slice(5)}</td>
                    <td className={pctClass(row.spx_session_pct)}>{fmtPct(row.spx_session_pct)}</td>
                    <td className={pctClass(row.qqq_session_pct)}>{fmtPct(row.qqq_session_pct)}</td>
                    <td className={pctClass(row.spy_session_pct)}>{fmtPct(row.spy_session_pct)}</td>
                    <td className={pctClass(row.mag7.avg_session_pct)}>
                      {fmtPct(row.mag7.avg_session_pct)}
                      {row.mag7.best ? (
                        <span className="meridian-opex-sub">
                          {" "}
                          · {row.mag7.best.ticker} {fmtPct(row.mag7.best.session_pct)}
                        </span>
                      ) : null}
                    </td>
                    <td className={pctClass(row.top_gainer?.session_pct ?? null)}>
                      {row.top_gainer ? (
                        <>
                          {row.top_gainer.ticker}{" "}
                          <span className="meridian-opex-move">{fmtPct(row.top_gainer.session_pct)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={pctClass(row.top_loser?.session_pct ?? null)}>
                      {row.top_loser ? (
                        <>
                          {row.top_loser.ticker}{" "}
                          <span className="meridian-opex-move">{fmtPct(row.top_loser.session_pct)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MeridianDataCard>

        {report.watch_list.length > 0 && (
          <MeridianDataCard label="What to watch" wide tone="opex" delay={80}>
            <ul className="meridian-card-list meridian-watch-list">
              {report.watch_list.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </MeridianDataCard>
        )}

        {cm.rows[0]?.mag7.members.some((m) => m.session_pct != null) && (
          <MeridianDataCard label={`Last OpEx · Mag 7 (${cm.rows[0].date.slice(5)})`} tone="opex" delay={160}>
            <ul className="meridian-card-list meridian-mag7-list">
              {[...cm.rows[0].mag7.members]
                .sort((a, b) => (b.session_pct ?? -999) - (a.session_pct ?? -999))
                .map((m) => (
                  <li key={m.ticker}>
                    <span className="meridian-mag7-ticker">{m.ticker}</span>
                    <span className={`meridian-mag7-pct ${pctClass(m.session_pct)}`}>{fmtPct(m.session_pct)}</span>
                  </li>
                ))}
            </ul>
          </MeridianDataCard>
        )}
      </div>
    </section>
  );
}
