"use client";

/**
 * SUMMARY — the tab that answers "so what do I do?" without pretending to know more than we do.
 *
 * Two ideas are ALWAYS shown, one call and one put. That is not indecision: on an event with a
 * split book, promoting one side would be a claim about certainty we do not have, and the split
 * itself is the finding a reader needs. When the evidence is genuinely one-sided the panel says
 * so and the losing side visibly recedes — but it stays on screen, because "the other side is
 * weak" and "there is no other side" are different statements.
 *
 * Every percentage on this panel is traceable. The big number is P(close beyond a level) under
 * the market's own implied move — real math on a real input — and it is labelled as a
 * distribution, not as a chance of profit, because nothing here carries a contract price. The
 * base rate underneath it always ships with its sample size. See meridian-summary-core.
 */

import { useMemo } from "react";
import {
  buildMeridianSummary,
  type MeridianSummary,
  type PlayIdea,
} from "@/lib/meridian/meridian-summary-core";
import type { MeridianEarningsDetail } from "@/features/meridian/lib/meridian-types";
import { MeridianCountdown, MeridianSparkline } from "./meridian-viz";
import { computeMeridianDrift, driftSeries } from "@/lib/meridian/meridian-drift-core";
import { etWallClockToIso } from "@/lib/meridian/meridian-viz-core";

const pct = (v: number | null | undefined, digits = 0) =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

export function MeridianEarningsSummaryPanel({ detail }: { detail: MeridianEarningsDetail }) {
  const { intel, enrichment, pack } = detail;

  const summary: MeridianSummary = useMemo(
    () =>
      buildMeridianSummary({
        spot: intel?.thermal?.spot ?? intel?.expected_move_band?.spot ?? pack?.positioning?.spot ?? null,
        movePct: intel?.expected_move_pct ?? pack?.expected_move_pct ?? null,
        moveSource: intel?.expected_move_source ?? null,
        band: intel?.expected_move_band ?? null,
        thermal: intel?.thermal ?? null,
        prints: enrichment?.print_history ?? null,
        signals: intel?.report?.signals ?? null,
        flowAvailable: intel?.flow_into_print?.available === true,
        darkPoolAvailable: intel?.dark_pool?.available === true,
      }),
    [intel, enrichment, pack]
  );

  /**
   * How this read has MOVED as the print approached. Often the more useful signal: a verdict
   * decaying toward neutral means something different from one that arrived neutral and stayed.
   * Renders nothing until a second day exists — a one-point series is not a trend.
   */
  const drift = useMemo(() => computeMeridianDrift(detail.drift_snapshots, 7), [detail.drift_snapshots]);
  const series = useMemo(() => driftSeries(detail.drift_snapshots), [detail.drift_snapshots]);

  const cal = enrichment?.earnings_calendar;
  const eventAt = etWallClockToIso(cal?.date ?? null, cal?.report_time_et ?? cal?.time ?? null);

  return (
    <section className="msum" aria-label="Summary">
      <header className="msum-head">
        <div>
          <span className="mr-panel-title">What the book says</span>
          <p className={`msum-headline mv-${summary.lean === "bullish" ? "bull" : summary.lean === "bearish" ? "bear" : "neutral"}`}>
            {summary.headline}
          </p>
        </div>
        {eventAt && <MeridianCountdown targetIso={eventAt} />}
      </header>

      {/* Which feeds actually contributed. An absent input must never be mistaken for a neutral
          one — a reader weighing this read needs to know what it was computed from. */}
      <ul className="msum-inputs" aria-label="Inputs used">
        {(
          [
            ["implied move", summary.inputs.move],
            ["dealer structure", summary.inputs.thermal],
            ["flow", summary.inputs.flow],
            ["dark pool", summary.inputs.darkPool],
            ["print history", summary.inputs.history],
          ] as const
        ).map(([label, on]) => (
          <li key={label} className={`msum-input${on ? " is-on" : ""}`}>
            {on ? "●" : "○"} {label}
          </li>
        ))}
      </ul>

      {drift && (
        <div className="msum-drift">
          <div className="msum-drift-head">
            <span className="mr-panel-title">What changed</span>
            <span className={`msum-drift-dir msum-drift-${drift.direction}`}>{drift.headline}</span>
          </div>
          {series.filter((v) => v != null).length >= 2 && (
            <MeridianSparkline
              values={series}
              lean={drift.direction === "firming" ? "bullish" : drift.direction === "fading" ? "bearish" : "neutral"}
              width={120}
              height={24}
            />
          )}
          {drift.turns.length > 0 && (
            <ul className="msum-drift-turns">
              {drift.turns.map((t) => (
                <li key={t.pillar}>
                  <b>{t.pillar}</b> {t.from} → <span className={t.to === "bullish" ? "mv-bull" : t.to === "bearish" ? "mv-bear" : ""}>{t.to}</span>
                </li>
              ))}
            </ul>
          )}
          {/* Sample size, always. Two days is a comparison; it is not a trend, and the panel
              must not let a reader mistake one for the other. */}
          <span className="msum-thin">
            {drift.sampleDays} day{drift.sampleDays === 1 ? "" : "s"} tracked
            {drift.sampleDays === 2 ? " — a comparison, not yet a trend" : ""}
          </span>
        </div>
      )}

      {summary.contested && (
        <p className="msum-contested" role="status">
          The evidence contradicts itself. Both ideas below stand on their own numbers — neither is
          promoted, because a verdict built from a split book would overstate what this desk knows.
        </p>
      )}

      <div className="msum-ideas">
        <IdeaCard idea={summary.call} summary={summary} muted={!summary.contested && summary.lean === "bearish"} />
        <IdeaCard idea={summary.put} summary={summary} muted={!summary.contested && summary.lean === "bullish"} />
      </div>

      {summary.levels.length > 0 && (
        <div className="msum-levels">
          <span className="mr-panel-title">Levels to watch</span>
          <ul className="msum-level-rows">
            {summary.levels.map((l) => (
              <li key={`${l.label}-${l.value}`} className={`msum-level msum-level-${l.kind}`}>
                <span className="msum-level-label">{l.label}</span>
                <span className="msum-level-leader" aria-hidden="true" />
                <span className="msum-level-val">{l.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.reaction.sample > 0 && (
        <p className="msum-note">
          This name has moved a median <strong>{summary.reaction.medianAbsMovePct}%</strong> on its
          last {summary.reaction.sample} print{summary.reaction.sample === 1 ? "" : "s"} (largest{" "}
          {summary.reaction.maxAbsMovePct}%)
          {summary.movePct != null ? `, against ${summary.movePct.toFixed(1)}% implied now` : ""}.
        </p>
      )}
    </section>
  );
}

function IdeaCard({
  idea,
  summary,
  muted,
}: {
  idea: PlayIdea | null;
  summary: MeridianSummary;
  muted: boolean;
}) {
  if (!idea) return null;
  const bull = idea.side === "call";
  return (
    <article className={`msum-idea msum-idea-${idea.side}${muted ? " is-muted" : ""}`}>
      <header className="msum-idea-head">
        <span className={`msum-idea-side ${bull ? "mv-bull" : "mv-bear"}`}>{bull ? "CALL" : "PUT"}</span>
        <span className="msum-idea-level">
          {bull ? "above" : "below"} <b>{idea.level}</b>
          <span className="msum-idea-src"> · {idea.levelFrom}</span>
        </span>
      </header>

      {/* The headline number is a DISTRIBUTION statement. The label says so in as many words —
          nothing here knows a contract price, so "chance of profit" would be invented. */}
      <div className="msum-prob">
        <span className="msum-prob-val">{pct(idea.impliedProb)}</span>
        <span className="msum-prob-label">
          implied chance of closing {bull ? "above" : "below"} {idea.level}
        </span>
      </div>

      <dl className="msum-metrics">
        <div>
          <dt>this name&rsquo;s base rate</dt>
          <dd>
            {idea.historicalRate == null ? (
              <span className="msum-thin">n={idea.historicalSample}, too few</span>
            ) : (
              <>
                {pct(idea.historicalRate)} <span className="msum-thin">n={idea.historicalSample}</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>evidence</dt>
          <dd className={idea.evidenceNet > 0 ? "mv-bull" : idea.evidenceNet < 0 ? "mv-bear" : ""}>
            {idea.evidenceNet > 0 ? "+" : ""}
            {(idea.evidenceNet * 100).toFixed(0)}
          </dd>
        </div>
        <div>
          <dt>invalidated at</dt>
          <dd>{idea.invalidation ?? "—"}</dd>
        </div>
      </dl>

      <div className="msum-conf" title="the three components above, combined">
        <span className="msum-conf-bar">
          <span
            className={`msum-conf-fill ${bull ? "mv-bull" : "mv-bear"}`}
            style={{ width: `${idea.confidence}%` }}
          />
        </span>
        <span className="msum-conf-val">{idea.confidence}</span>
      </div>

      <ul className="msum-why">
        {idea.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>

      {summary.contested && (
        <p className="msum-thin msum-idea-foot">shown because the book is split, not because it won</p>
      )}
    </article>
  );
}
