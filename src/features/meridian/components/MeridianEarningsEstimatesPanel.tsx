"use client";

/**
 * ESTIMATES — the expectations engine. It answers: what does the street expect, and how are
 * those expectations CHANGING?
 *
 * Built on the fill rates measured live (scripts/audit/meridian-earnings-data-inventory.mjs),
 * so nothing here is a panel waiting for data that never arrives:
 *   print_history est/actual  100% / 90%   → EPS + revenue trajectories
 *   street_skew counts        100%         → revision momentum
 *   price_targets             100% (6 rows)→ target rail + dispersion
 *   earnings_yoy              present      → YoY deltas
 *   corporate_guidance        0%, PLAN-GATED → rendered as gated, never as empty
 */

import { useMemo } from "react";
import type {
  MeridianEarningsEnrichment,
  MeridianStreetEstimate,
} from "@/features/meridian/lib/meridian-types";
import {
  MeridianDispersion,
  MeridianRevisionMomentum,
  MeridianTargetRail,
  MeridianTrajectory,
} from "./meridian-viz";

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}
function fmtEps(n: number): string {
  return n.toFixed(2);
}
function period(row: { fiscal_period?: string | null; fiscal_year?: number | null; report_date?: string | null }): string {
  if (row.fiscal_period) {
    return row.fiscal_year ? `${row.fiscal_period} '${String(row.fiscal_year).slice(-2)}` : row.fiscal_period;
  }
  return row.report_date?.slice(2) ?? "—";
}

type Props = {
  ticker: string;
  enrichment: Pick<
    MeridianEarningsEnrichment,
    | "print_history"
    | "street_estimates"
    | "street_skew"
    | "price_targets"
    | "earnings_calendar"
    | "earnings_yoy"
    | "analyst_revisions"
  >;
  spot?: number | null;
};

export function MeridianEarningsEstimatesPanel({ ticker, enrichment, spot }: Props) {
  const cal = enrichment.earnings_calendar;

  // Oldest → newest, then the upcoming period appended so the trajectory reads left-to-right
  // as time. print_history arrives newest-first.
  const epsRows = useMemo(() => {
    const past = [...(enrichment.print_history ?? [])]
      .reverse()
      .map((p) => ({ period: period(p), estimate: p.eps_estimate ?? null, actual: p.eps_actual ?? null }));
    if (cal && cal.estimated_eps != null && cal.actual_eps == null) {
      past.push({ period: period(cal), estimate: cal.estimated_eps, actual: null });
    }
    return past;
  }, [enrichment.print_history, cal]);

  const revRows = useMemo(() => {
    const past = [...(enrichment.print_history ?? [])]
      .reverse()
      .map((p) => ({ period: period(p), estimate: p.revenue_estimate ?? null, actual: p.revenue_actual ?? null }));
    if (cal && cal.estimated_revenue != null && cal.actual_revenue == null) {
      past.push({ period: period(cal), estimate: cal.estimated_revenue, actual: null });
    }
    return past;
  }, [enrichment.print_history, cal]);

  const forwardEps = useMemo(
    () => (enrichment.street_estimates ?? []).map((e: MeridianStreetEstimate) => e.eps_estimate),
    [enrichment.street_estimates]
  );

  const yoy = enrichment.earnings_yoy;

  return (
    <section className="me" aria-label={`${ticker} estimates`}>
      <div className="mr-grid">
        <div className="mr-panel">
          <MeridianTrajectory rows={epsRows} title="EPS trajectory" format={fmtEps} />
        </div>
        <div className="mr-panel">
          <MeridianTrajectory rows={revRows} title="Revenue trajectory" format={fmtMoney} />
        </div>

        {yoy && (yoy.eps_yoy_pct != null || yoy.revenue_yoy_pct != null) && (
          <div className="mr-panel me-yoy">
            <span className="mr-panel-title">Year over year</span>
            <div className="me-yoy-rows">
              {yoy.eps_yoy_pct != null && <YoYBar label="EPS" pct={yoy.eps_yoy_pct} />}
              {yoy.revenue_yoy_pct != null && <YoYBar label="Revenue" pct={yoy.revenue_yoy_pct} />}
            </div>
          </div>
        )}

        <div className="mr-panel">
          <MeridianRevisionMomentum skew={enrichment.street_skew} />
          <MeridianDispersion values={forwardEps} label="Forward EPS dispersion" format={fmtEps} />
        </div>

        <div className="mr-panel mr-panel-wide">
          <MeridianTargetRail targets={enrichment.price_targets} spot={spot} />
        </div>

      </div>
    </section>
  );
}

/**
 * A YoY delta as a centre-anchored bar. Zero sits in the MIDDLE so growth and contraction
 * extend in opposite directions — a left-anchored bar would render -30% and +30% identically
 * apart from colour, which is the whole thing the reader is trying to see.
 */
function YoYBar({ label, pct }: { label: string; pct: number }) {
  // Capped at ±100% for the bar only; the printed number stays exact. An outlier of +2,400%
  // (routine when a loss-making name turns a profit) would otherwise flatten every other bar.
  const capped = Math.max(-100, Math.min(100, pct));
  const half = Math.abs(capped) / 2;
  const positive = pct >= 0;
  return (
    <div className="me-yoy-row">
      <span className="me-yoy-label">{label}</span>
      <span className="me-yoy-track">
        <span className="me-yoy-zero" />
        <span
          className={`me-yoy-bar ${positive ? "mv-bull" : "mv-bear"}`}
          style={positive ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }}
        />
      </span>
      <span className={`me-yoy-val ${positive ? "mv-bull" : "mv-bear"}`}>
        {positive ? "+" : ""}
        {pct.toFixed(1)}%{Math.abs(pct) > 100 ? <span className="me-yoy-cap" title="bar capped at ±100%"> ▸</span> : null}
      </span>
    </div>
  );
}
