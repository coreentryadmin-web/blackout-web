"use client";

/**
 * HISTORY — what normally happens when this company reports.
 *
 * This tab was the one blocked by the reaction-data defect: `session_change_pct` was null on
 * every recent print because a fixed 120-bar limit truncated the fetch window, so
 * "how does this name react" and "is the market pricing more than it delivers" were both
 * unanswerable. With that fixed, both are the centrepiece here.
 */

import type {
  MeridianEarningsAnalyticsRow,
  MeridianEarningsEnrichment,
  MeridianEarningsIntel,
} from "@/features/meridian/lib/meridian-types";
import { MeridianBeatHistory, MeridianImpliedVsRealized } from "./meridian-viz";
import { MeridianBeatStreak } from "./MeridianEarningsAnalytics";
import { MeridianDataCard } from "./meridian-ui";

export function MeridianEarningsHistoryPanel({
  ticker,
  enrichment,
  intel,
  analyticsRows,
}: {
  ticker: string;
  enrichment: Pick<MeridianEarningsEnrichment, "print_history" | "beat_rates" | "print_history_summary">;
  intel: Pick<MeridianEarningsIntel, "expected_move_pct">;
  /** Full-window analytics rows — powers the beat/miss streak rail when present. */
  analyticsRows?: readonly MeridianEarningsAnalyticsRow[];
}) {
  const prints = enrichment.print_history ?? [];
  const moves = prints.map((p) => p.session_change_pct);
  const rates = enrichment.beat_rates;
  const graded = prints.filter((p) => p.beat != null).length;

  return (
    <section className="mh" aria-label={`${ticker} earnings history`}>
      <div className="mr-grid">
        <div className="mr-panel mr-panel-wide">
          <MeridianImpliedVsRealized impliedPct={intel.expected_move_pct} moves={moves} />
        </div>

        <div className="mr-panel">
          <MeridianBeatHistory prints={prints} />
        </div>

        {rates && (
          <div className="mr-panel">
            <span className="mr-panel-title">Beat rates</span>
            <div className="mh-rates">
              <RateBar label="EPS" rate={rates.eps_beat_rate} n={graded} />
              <RateBar label="Revenue" rate={rates.revenue_beat_rate} n={graded} />
              <RateBar label="Combined" rate={rates.combined_beat_rate} n={graded} />
            </div>
            {/* Four quarters is a track record, not a distribution — say the n out loud rather
                than letting three bars imply a statistical base they do not have. */}
            <p className="mv-note">over {graded} graded print{graded === 1 ? "" : "s"}</p>
          </div>
        )}

        {enrichment.print_history_summary && (
          <div className="mr-panel">
            <span className="mr-panel-title">Summary</span>
            <p className="mh-summary">{enrichment.print_history_summary}</p>
          </div>
        )}
      </div>

      {(analyticsRows?.length ?? 0) > 0 && (
        <MeridianDataCard label="Quarterly beat / miss streak" wide tone="earnings">
          <MeridianBeatStreak ticker={ticker} rows={analyticsRows!} />
        </MeridianDataCard>
      )}
    </section>
  );
}

function RateBar({ label, rate, n }: { label: string; rate: number | null; n: number }) {
  // A missing rate is not a 0% rate. Rendering an empty bar for "we could not grade this"
  // states a perfect miss record the data never supported.
  if (rate == null || !Number.isFinite(rate) || n === 0) {
    return (
      <div className="mh-rate">
        <span className="mh-rate-label">{label}</span>
        <span className="mh-rate-track" />
        <span className="mh-rate-val">—</span>
      </div>
    );
  }
  const pct = Math.round(rate * 100);
  return (
    <div className="mh-rate">
      <span className="mh-rate-label">{label}</span>
      <span className="mh-rate-track">
        <span
          className={`mh-rate-fill ${pct >= 60 ? "mv-bull" : pct >= 40 ? "mv-neutral" : "mv-bear"}`}
          style={{ transform: `scaleX(${rate})` }}
        />
      </span>
      <span className={`mh-rate-val ${pct >= 60 ? "mv-bull" : pct >= 40 ? "mv-neutral" : "mv-bear"}`}>{pct}%</span>
    </div>
  );
}
