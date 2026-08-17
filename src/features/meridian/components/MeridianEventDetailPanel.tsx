"use client";

import type { MeridianEventDetail, MeridianTimelineItem } from "@/features/meridian/lib/meridian-types";
import { FreshnessChip } from "@/components/ui";
import { fmtPct } from "./MeridianDesk";
import {
  MeridianActionDock,
  MeridianAnalyticsBanner,
  MeridianDataCard,
  MeridianEmpty,
  MeridianShimmer,
  kindTheme,
} from "./meridian-ui";
import { MeridianEarningsTabs } from "./MeridianEarningsTabs";
import { MeridianMacroReportPanel } from "./MeridianMacroReportPanel";
import { MeridianOpexCrossMarketPanel } from "./MeridianOpexCrossMarketPanel";

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

export function MeridianEventDetailPanel({
  item,
  detail,
  loading,
  error,
  boardTickers = [],
}: Props) {
  const theme = kindTheme(item.kind);

  return (
    <article
      className={`meridian-detail meridian-detail-v2 ${theme.accent}`}
      role="region"
      aria-label="Event structure brief"
    >
      <header className="meridian-detail-head-v2">
        <div className="meridian-detail-head-main">
          <p className="meridian-detail-kicker">
            {theme.label} · {item.impact === "high" ? "High impact" : item.impact === "medium" ? "Medium" : "Scheduled"}
          </p>
          <h2 className="meridian-detail-title-v2">{item.title}</h2>
          <p className="meridian-detail-meta">
            {item.date}
            {item.time ? ` · ${item.time} ET` : ""}
            {item.days_until === 0 ? " · today" : item.days_until === 1 ? " · tomorrow" : ` · ${item.days_until}d`}
          </p>
        </div>
        <FreshnessChip status={loading ? "stale" : "live"} label={loading ? "Loading" : "Structure"} />
      </header>

      {loading && (
        <div className="meridian-detail-loading">
          <MeridianShimmer lines={6} />
        </div>
      )}
      {error && !loading && <MeridianEmpty message={error} />}

      {!loading && !error && detail?.kind === "macro" && (
        <>
          <MeridianMacroReportPanel detail={detail} />

          <div className="meridian-banner-stack">
            <MeridianAnalyticsBanner
              label="Correlation rail"
              headline={detail.correlation_rail.headline}
              sub={
                detail.correlation_rail.regime_tag !== "unknown"
                  ? `Regime · ${detail.correlation_rail.regime_tag.replace("_", " ")}`
                  : null
              }
              tone="macro"
              icon="◎"
            />
            {detail.surprise && detail.surprise.verdict !== "unknown" && (
              <MeridianAnalyticsBanner
                label="Surprise score"
                headline={`${detail.surprise.verdict} · ${fmtPct(detail.surprise.surprise_pct)}`}
                sub={`History ${detail.surprise.historical.beats} beats / ${detail.surprise.historical.misses} misses`}
                tone="macro"
                icon="△"
              />
            )}
          </div>

          <div className="meridian-detail-grid-v2">
            {(detail.estimate || detail.macro_indicator) && (
              <MeridianDataCard label="Macro context" wide tone="macro" delay={0}>
                {detail.estimate && <p className="meridian-card-value">Consensus {detail.estimate}</p>}
                {detail.macro_indicator && (
                  <ul className="meridian-card-list">
                    <li>
                      Last {detail.macro_indicator.label}
                      {detail.macro_indicator.latest_value != null ? `: ${detail.macro_indicator.latest_value}` : ""}
                    </li>
                  </ul>
                )}
              </MeridianDataCard>
            )}

            <MeridianDataCard label="SPX positioning" tone="macro" delay={80}>
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
            </MeridianDataCard>

            <MeridianDataCard label="HELIX flow skew" tone="macro" delay={160}>
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
            </MeridianDataCard>

            {detail.release_history.length > 0 && (
              <MeridianDataCard label="Prior prints · session + 60m" wide tone="macro" delay={240}>
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
                        {row.spx_intraday_60_pct != null ? ` / ${fmtPct(row.spx_intraday_60_pct)} 60m` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}

            {detail.related_headlines.length > 0 && (
              <MeridianDataCard label="Macro headlines" wide tone="macro" delay={320}>
                <HeadlineList items={detail.related_headlines} empty="" />
              </MeridianDataCard>
            )}
          </div>
        </>
      )}

      {!loading && !error && detail?.kind === "opex" && (
        <>
          <MeridianAnalyticsBanner
            label="OpEx pin accuracy"
            headline={detail.pin_accuracy.headline}
            tone="opex"
            icon="◇"
          />
          <MeridianOpexCrossMarketPanel detail={detail} />
          <div className="meridian-detail-grid-v2">
            <MeridianDataCard label="SPX structure" tone="opex" delay={0}>
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
            </MeridianDataCard>

            <MeridianDataCard label="Expiry pin & flow" tone="opex" delay={80}>
              <ul className="meridian-card-list">
                {detail.expiry_read.greek_headline && <li>{detail.expiry_read.greek_headline}</li>}
                {detail.expiry_read.net_flow_label && <li>{detail.expiry_read.net_flow_label}</li>}
              </ul>
            </MeridianDataCard>

            {detail.prior_opex.length > 0 && (
              <MeridianDataCard label="Prior OpEx · pin vs close" wide tone="opex" delay={160}>
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
                        <span className="meridian-history-move"> · SPX {fmtPct(row.spx_session_pct)} session</span>
                      )}
                    </li>
                  ))}
                </ul>
              </MeridianDataCard>
            )}
          </div>
        </>
      )}

      {!loading && !error && detail?.kind === "fda" && (
        <div className="meridian-detail-grid-v2">
          <MeridianDataCard label="Decision window" tone="fda" delay={0}>
            <ul className="meridian-card-list">
              {detail.drug && <li>{detail.drug}</li>}
              {detail.indication && <li>{detail.indication}</li>}
            </ul>
          </MeridianDataCard>

          <MeridianDataCard label={`${detail.ticker} positioning`} tone="fda" delay={80}>
            {detail.positioning.available ? (
              <ul className="meridian-card-list">
                {detail.positioning.gamma_regime && <li>{detail.positioning.gamma_regime}</li>}
                {detail.positioning.spot != null && <li>Spot {detail.positioning.spot}</li>}
              </ul>
            ) : (
              <p className="meridian-card-muted">Positioning unavailable.</p>
            )}
          </MeridianDataCard>

          {(detail.insider_activity.length > 0 || detail.congress_trades.length > 0) && (
            <MeridianDataCard label="Insider & congress" wide tone="fda" delay={160}>
              <ul className="meridian-card-list">
                {detail.insider_activity.slice(0, 4).map((r) => (
                  <li key={r.title}>{r.title}</li>
                ))}
                {detail.congress_trades.slice(0, 3).map((r, i) => (
                  <li key={`${r.politician}-${i}`}>
                    {r.politician ?? "Congress"} · {r.transaction ?? "trade"}
                  </li>
                ))}
              </ul>
            </MeridianDataCard>
          )}

          <MeridianDataCard label="Catalyst headlines" wide tone="fda" delay={240}>
            <HeadlineList items={detail.catalysts} empty="No recent catalyst headlines." />
          </MeridianDataCard>
        </div>
      )}

      {!loading && !error && detail?.kind === "earnings" && (
        <MeridianEarningsTabs detail={detail} />
      )}

      <MeridianActionDock item={item} boardTickers={boardTickers} />
    </article>
  );
}
