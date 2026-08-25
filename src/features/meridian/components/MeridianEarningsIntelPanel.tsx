"use client";

import type { MeridianEarningsIntel, MeridianEarningsPrint } from "@/features/meridian/lib/meridian-types";
import { fmtPct } from "./MeridianDesk";
import { MeridianAnalyticsBanner, MeridianDataCard, ReactionFlag } from "./meridian-ui";

function beatArrow(beat: boolean | null): string {
  if (beat == null) return "→";
  return beat ? "↑" : "↓";
}

function moveArrow(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "→";
  if (pct > 0.25) return "↑";
  if (pct < -0.25) return "↓";
  return "→";
}

function leanTone(lean: MeridianEarningsIntel["play_read"]["lean"]): "earnings" | "default" {
  return lean === "avoid_directional" ? "default" : "earnings";
}

type Props = {
  intel: MeridianEarningsIntel;
  printHistory: MeridianEarningsPrint[];
  tickerExpectedMovePct: number | null;
};

export function MeridianEarningsIntelPanel({ intel, printHistory, tickerExpectedMovePct }: Props) {
  const em = intel.expected_move_pct ?? tickerExpectedMovePct;
  const { play_read, financials, flow_into_print, thermal } = intel;

  return (
    <>
      <div className="meridian-banner-stack">
        {play_read.available && (
          <MeridianAnalyticsBanner
            label="Play read"
            headline={play_read.headline}
            sub={play_read.structure_hint ?? play_read.rationale[0] ?? null}
            tone={leanTone(play_read.lean)}
            icon={play_read.lean === "avoid_directional" ? "⚠" : "◆"}
          />
        )}
        {em != null && (
          <MeridianAnalyticsBanner
            label="Expected move"
            headline={`~${em}% implied band`}
            sub={
              intel.expected_move_band
                ? `${intel.expected_move_band.down.toLocaleString()} – ${intel.expected_move_band.up.toLocaleString()} (${intel.expected_move_source ?? "calendar"})`
                : intel.expected_move_source
                  ? `Source · ${intel.expected_move_source.replace("_", " ")}`
                  : null
            }
            tone="earnings"
            icon="◎"
          />
        )}
      </div>

      <div className="meridian-detail-grid-v2 meridian-earn-intel">
        {financials?.available && (
          <MeridianDataCard label="Financials context" wide tone="earnings" delay={0}>
            {financials.headline && <p className="meridian-card-value">{financials.headline}</p>}
            <ul className="meridian-card-list meridian-fin-grid">
              {financials.pe_ratio != null && <li>P/E {financials.pe_ratio.toFixed(1)}</li>}
              {financials.revenue_yoy_pct != null && (
                <li>Revenue {fmtPct(financials.revenue_yoy_pct)} YoY</li>
              )}
              {financials.net_margin_pct != null && (
                <li>
                  Net margin {financials.net_margin_pct.toFixed(0)}%
                  {financials.margin_trend === "expanding"
                    ? " ↑"
                    : financials.margin_trend === "contracting"
                      ? " ↓"
                      : ""}
                </li>
              )}
              {financials.price_target != null && financials.price_target_upside_pct != null && (
                <li>
                  Street PT {financials.price_target.toFixed(0)} ({fmtPct(financials.price_target_upside_pct)}{" "}
                  upside)
                </li>
              )}
            </ul>
          </MeridianDataCard>
        )}

        {printHistory.length > 0 && (
          <MeridianDataCard label="Print track · est vs actual" wide tone="earnings" delay={80}>
            <ul className="meridian-card-list meridian-history-list meridian-print-track">
              {printHistory.map((row) => (
                <li key={row.report_date ?? "unknown"}>
                  <span className="meridian-history-date">{row.report_date?.slice(5) ?? "—"}</span>
                  {row.eps_estimate != null && row.eps_actual != null ? (
                    <span>
                      {" "}
                      EPS {row.eps_actual} vs {row.eps_estimate}
                      <span className={`meridian-print-arrow meridian-print-arrow-${beatArrow(row.beat)}`}>
                        {" "}
                        {beatArrow(row.beat)}
                      </span>
                    </span>
                  ) : null}
                  {row.expected_move_pct != null && (
                    <span className="meridian-card-muted"> · implied {row.expected_move_pct}%</span>
                  )}
                  {(row.reaction_pct ?? row.session_change_pct) != null && (
                    <span className="meridian-history-move">
                      {" "}
                      · {fmtPct(row.reaction_pct ?? row.session_change_pct)} reaction
                      <span className={`meridian-print-arrow meridian-print-arrow-${moveArrow(row.reaction_pct ?? row.session_change_pct)}`}>
                        {" "}
                        {moveArrow(row.reaction_pct ?? row.session_change_pct)}
                      </span>
                      <ReactionFlag print={row} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </MeridianDataCard>
        )}

        {thermal.available && (
          <MeridianDataCard label="Thermal king nodes" tone="earnings" delay={160}>
            <ul className="meridian-card-list">
              {thermal.gex_king_strike != null && (
                <li>King strike {thermal.gex_king_strike.toLocaleString()}</li>
              )}
              {thermal.call_wall != null && thermal.put_wall != null && (
                <li>
                  Walls {thermal.put_wall.toLocaleString()} – {thermal.call_wall.toLocaleString()}
                </li>
              )}
              {thermal.gamma_regime && <li>{thermal.gamma_regime}</li>}
              {thermal.net_gex_label && <li>Net GEX {thermal.net_gex_label}</li>}
            </ul>
            {thermal.top_strikes.length > 0 && (
              <ul className="meridian-card-list meridian-thermal-strikes">
                {thermal.top_strikes.slice(0, 5).map((s) => (
                  <li key={s.strike}>
                    {s.strike.toLocaleString()} · {s.net_label} ({s.pct_of_total}%)
                  </li>
                ))}
              </ul>
            )}
          </MeridianDataCard>
        )}

        {intel.vector.available && (
          <MeridianDataCard
            label={`Vector structure · ${intel.vector.horizon ?? "weekly"}`}
            tone="earnings"
            delay={200}
          >
            {intel.vector.regime && <p className="meridian-card-value">{intel.vector.regime}</p>}
            <ul className="meridian-card-list">
              {intel.vector.call_wall != null && intel.vector.put_wall != null && (
                <li>
                  Walls {intel.vector.put_wall.toLocaleString()} –{" "}
                  {intel.vector.call_wall.toLocaleString()}
                </li>
              )}
              {intel.vector.gamma_flip != null && (
                <li>Gamma flip {intel.vector.gamma_flip.toLocaleString()}</li>
              )}
              {intel.vector.max_pain != null && (
                <li>Max pain {intel.vector.max_pain.toLocaleString()}</li>
              )}
              {intel.vector.move_pct != null && (
                <li>Expected move ~{intel.vector.move_pct}%</li>
              )}
              {intel.vector.bead_samples > 0 && (
                <li>{intel.vector.bead_samples} wall-history samples today</li>
              )}
            </ul>
            {intel.vector.recent_events.length > 0 && (
              <ul className="meridian-card-list meridian-vector-events">
                {intel.vector.recent_events.map((ev, i) => (
                  <li key={`${ev.message}-${i}`} className={ev.severity === "warn" ? "mv-warn" : undefined}>
                    {ev.time_label ? `${ev.time_label} · ` : ""}
                    {ev.message}
                  </li>
                ))}
              </ul>
            )}
            {intel.vector.recent_flow.length > 0 && (
              <ul className="meridian-card-list meridian-flow-prints">
                {intel.vector.recent_flow.map((row, i) => (
                  <li key={`vflow-${row.strike}-${i}`}>
                    {row.premium_label}
                    {row.option_type ? ` ${row.option_type}` : ""}
                    {row.strike != null ? ` @ ${row.strike}` : ""}
                    {row.executed_at ? ` · ${row.executed_at}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {intel.vector.freshness_note && (
              <p className="meridian-card-muted">{intel.vector.freshness_note}</p>
            )}
          </MeridianDataCard>
        )}

        {flow_into_print.available && (
          <MeridianDataCard
            label={`HELIX flow · ${flow_into_print.window_hours}h window`}
            tone="earnings"
            delay={240}
          >
            {flow_into_print.net_premium_label && (
              <p className="meridian-card-value">
                Net {flow_into_print.net_premium_label} · {flow_into_print.bias}
              </p>
            )}
            {flow_into_print.top_prints.length > 0 && (
              <ul className="meridian-card-list meridian-flow-prints">
                {flow_into_print.top_prints.map((row, i) => (
                  <li key={`${row.strike}-${row.expiry}-${i}`}>
                    {row.premium_label}
                    {row.option_type ? ` ${row.option_type}` : ""}
                    {row.strike != null ? ` @ ${row.strike}` : ""}
                    {row.dte != null ? ` · ${row.dte}d` : ""}
                  </li>
                ))}
              </ul>
            )}
            {flow_into_print.strike_stacks.length > 0 && (
              <ul className="meridian-card-list meridian-strike-stacks">
                {flow_into_print.strike_stacks.map((s) => (
                  <li key={s.strike}>
                    {s.strike} · {s.premium_label} ({s.hit_count} hits
                    {s.dominant_type ? ` · ${s.dominant_type}` : ""})
                  </li>
                ))}
              </ul>
            )}
          </MeridianDataCard>
        )}

        {intel.dark_pool.available && (
          <MeridianDataCard label="Dark pool · today" tone="earnings" delay={280}>
            {intel.dark_pool.total_premium_label && (
              <p className="meridian-card-value">
                {intel.dark_pool.total_premium_label} total · {intel.dark_pool.bias}
                {intel.dark_pool.pcr != null ? ` · P/C ${intel.dark_pool.pcr.toFixed(2)}` : ""}
              </p>
            )}
            {(intel.dark_pool.call_premium_label || intel.dark_pool.put_premium_label) && (
              <p className="meridian-card-muted">
                {intel.dark_pool.call_premium_label ? `Calls ${intel.dark_pool.call_premium_label}` : ""}
                {intel.dark_pool.call_premium_label && intel.dark_pool.put_premium_label ? " · " : ""}
                {intel.dark_pool.put_premium_label ? `Puts ${intel.dark_pool.put_premium_label}` : ""}
              </p>
            )}
            {intel.dark_pool.top_prints.length > 0 && (
              <ul className="meridian-card-list meridian-flow-prints">
                {intel.dark_pool.top_prints.map((row, i) => (
                  <li key={`dp-${row.strike}-${row.executed_at}-${i}`}>
                    {row.premium_label}
                    {row.strike != null ? ` @ ${row.strike}` : ""}
                    {row.side ? ` · ${row.side}` : ""}
                    {row.executed_at ? ` · ${row.executed_at}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </MeridianDataCard>
        )}

        {play_read.rationale.length > 1 && (
          <MeridianDataCard label="Structure rationale" wide tone="earnings" delay={320}>
            <ul className="meridian-card-list">
              {play_read.rationale.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {play_read.risk_note && <p className="meridian-card-muted meridian-risk-note">{play_read.risk_note}</p>}
          </MeridianDataCard>
        )}
      </div>
    </>
  );
}
