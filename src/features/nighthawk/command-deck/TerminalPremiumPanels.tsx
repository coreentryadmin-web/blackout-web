"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import type { ConvictionRankContext } from "./deck-command-center";
import {
  convictionDisplay,
  decisionWindowLabel,
  engineConfidencePct,
  expectedMovePct,
  managementActionDisplay,
  marketContextItems,
  markDollarPnl,
  riskUnitLabel,
  strengthBarSegmentFills,
  thesisStrengthPct,
  tradeOutcomeDisplay,
  tradeSummaryDisplay,
  trimLadderVisual,
  unifiedChecklist,
} from "./terminal-display";
import {
  playFreshnessDisplay,
  playLifecycleTimestamps,
  playPrimaryEvent,
  playStatusDisplay,
} from "./play-card-lifecycle";
import {
  entryCenteredExcursionLayout,
  formatExcursionPct,
} from "./trade-excursion-graphic";
import { signColorClass } from "@/lib/zerodte/terminal-edge";
import { formatReturnPct } from "./play-card-display";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { AgeDecayBadge, StatusPill } from "./DeckStatusBadges";
import { etNowParts } from "@/features/nighthawk/lib/session";
import { etClock } from "./PlayTerminal";
import { timeStopClock } from "@/lib/zerodte/terminal-ladder";
import type { Recommendation } from "./types";

const usd = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";

/** Engine confidence strip — directly under the ticker in the trade hero. */
export function EngineConfidenceBlock({
  play,
  rankContext,
}: {
  play: TerminalPlay;
  rankContext: ConvictionRankContext | null;
}) {
  const pct = engineConfidencePct(play);
  if (pct == null && !rankContext) return null;

  return (
    <section className="nh-deck-engine-conf" aria-label="Engine confidence">
      {pct != null && (
        <>
          <StrengthBar pct={pct} className="nh-deck-engine-conf__bar" />
          <div className="nh-deck-engine-conf__row">
            <span className="nh-deck-engine-conf__label">Engine Confidence</span>
            <span className="nh-deck-engine-conf__score">{pct}</span>
          </div>
        </>
      )}
      {rankContext?.isHighestToday && (
        <div className="nh-deck-engine-conf__badge">Highest today</div>
      )}
      {rankContext && (
        <div className="nh-deck-engine-conf__rank">
          Rank #{rankContext.rank} / {rankContext.total}
        </div>
      )}
    </section>
  );
}

/** Lifecycle timestamps — detail surfaces (trade hero + timeline tab). */
export function PlayLifecycleStrip({ play }: { play: TerminalPlay }) {
  const stamps = playLifecycleTimestamps(play);
  if (stamps.length === 0) return null;
  return (
    <div className="nh-deck-lifecycle-strip" aria-label="Trade lifecycle">
      {stamps.map((s) => (
        <div key={s.key} className="nh-deck-lifecycle-strip__cell">
          <span className="nh-deck-lifecycle-strip__lab">{s.label}</span>
          <span className="nh-deck-lifecycle-strip__val">{s.et} ET</span>
        </div>
      ))}
    </div>
  );
}

/** Persistent trade summary — dense hero visible across all tabs (0DTE). */
export function TradeSummaryHero({
  play,
  streamKind,
  markFlash,
  rankContext = null,
  nowMs = Date.now(),
}: {
  play: TerminalPlay;
  streamKind: string;
  markFlash?: boolean;
  rankContext?: ConvictionRankContext | null;
  nowMs?: number;
}) {
  const summary = tradeSummaryDisplay(play);
  const dollar = summary.dollarPnl;
  const dollarSign = dollar != null && dollar >= 0 ? "+" : "";
  const primary = playPrimaryEvent(play);
  const freshness = playFreshnessDisplay(play, nowMs, primary.iso);
  const status = playStatusDisplay(play.status);
  const ageLabel = freshness.compactAge ?? "—";

  return (
    <header className="nh-deck-trade-hero nh-deck-trade-hero-dense" aria-label="Selected trade summary">
      <div className="nh-deck-trade-hero__headrow">
        <div className="nh-deck-trade-hero__identity">
          <span className="nh-deck-trade-hero__tk">{summary.ticker}</span>
          <span className={clsx("nh-deck-trade-hero__dir", play.direction === "LONG" ? "long" : "short")}>
            {summary.direction}
            {summary.origin ? ` • ${summary.origin}` : ""}
          </span>
          <StatusPill label={status.label} tone={status.tone} />
        </div>
        <ConfidenceBadge play={play} hero className="nh-deck-trade-hero__conf-badge" />
      </div>

      <div className="nh-deck-trade-hero__chips">
        <span className="nh-deck-trade-hero__chip">{summary.horizonLabel}</span>
        <span className="nh-deck-trade-hero__chip contract">{summary.contract}</span>
        {rankContext?.isHighestToday && (
          <span className="nh-deck-trade-hero__chip orig">Highest today</span>
        )}
      </div>

      <div className="nh-deck-trade-hero__metrics" aria-label="Live trade metrics">
        <div className="nh-deck-trade-hero__metric is-primary">
          <span className="k">Current</span>
          <span
            className={clsx(
              "v",
              markFlash && "neon",
              dollar != null ? (dollar >= 0 ? "nh-deck-pos" : "nh-deck-neg") : (summary.currentPct ?? 0) >= 0 ? "nh-deck-pos" : "nh-deck-neg",
            )}
          >
            {dollar != null && play.entry != null
              ? `${dollarSign}${usd(dollar)}`
              : summary.currentPct != null
                ? formatReturnPct(summary.currentPct)
                : "—"}
          </span>
        </div>
        <div className="nh-deck-trade-hero__metric">
          <span className="k">Peak</span>
          <span className={clsx("v", (summary.peakPct ?? 0) >= 0 ? "nh-deck-pos" : "nh-deck-neg")}>
            {summary.peakPct != null ? formatReturnPct(summary.peakPct) : "—"}
          </span>
        </div>
        <div className="nh-deck-trade-hero__metric">
          {/* Canonical location for the thesis-strength/conviction number (Night Hawk panel
              declutter, docs/audit/FINDINGS.md 2026-08-05): previously this tile showed
              `convictionDisplay(play).score` (== `summary.confidence`, effectively `play.score`
              since `play.confidence` is never populated by any adapter) — a STATIC entry-time
              score that is ALSO rendered right above in `ConfidenceBadge` (grade + strength bar +
              same score, headrow). Meanwhile the Thesis tab's `ThesisStrengthBlock` and the
              Management tab's `ManagementActionCard` both rendered `thesisHealth.health` — a LIVE,
              decaying number — under yet another label ("Conviction" / "Confidence") in yet
              another tab. Consolidated to ONE canonical number in ONE canonical place: this tile
              now shows the LIVE thesis-health strength (falling back to the static score only when
              no thesisHealth is wired, e.g. Legacy/WATCH rows), labeled "Thesis Strength", and the
              other two renders were removed (see ThesisStrengthBlock removal + ManagementActionCard
              below). The static entry score keeps its own home in `ConfidenceBadge` — a genuinely
              different, non-live measure, not touched. */}
          <span className="k">Thesis Strength</span>
          <span className="v">{thesisStrengthPct(play) ?? summary.confidence ?? "—"}</span>
        </div>
        <div className="nh-deck-trade-hero__metric">
          <span className="k">Rank</span>
          <span className="v">
            {rankContext ? `#${rankContext.rank}` : "—"}
            {rankContext ? <span className="nh-deck-trade-hero__rank-den"> / {rankContext.total}</span> : null}
          </span>
        </div>
        <div className="nh-deck-trade-hero__metric">
          <span className="k">Age</span>
          <span className="v nh-deck-trade-hero__age">
            {play.status !== "CLOSED" ? (
              <AgeDecayBadge
                compactAge={ageLabel}
                decayTone={freshness.decayTone}
                pulse={freshness.pulse}
              />
            ) : (
              "Closed"
            )}
          </span>
        </div>
      </div>

      <PlayLifecycleStrip play={play} />
    </header>
  );
}

/** Market context chips — shown when greeks are unavailable. */
export function MarketContextRow({ play }: { play: TerminalPlay }) {
  const items = marketContextItems(play);
  if (items.length === 0) return null;
  return (
    <div className="nh-deck-mkt-ctx" aria-label="Market context">
      <span className="nh-deck-mkt-ctx__title">Market Context</span>
      <div className="nh-deck-mkt-ctx__grid">
        {items.map((item) => (
          <div key={item.label} className={clsx("nh-deck-mkt-ctx__cell", `is-${item.tone}`)}>
            <span className="nh-deck-mkt-ctx__label">{item.label}</span>
            <span className="nh-deck-mkt-ctx__val">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThesisExpectedMove({ play }: { play: TerminalPlay }) {
  const move = expectedMovePct(play);
  const risk = riskUnitLabel(play);
  if (move == null && risk == null) return null;
  return (
    <section className="nh-deck-thesis-move" aria-label="Expected move and risk">
      <div className="nh-deck-thesis-move__grid">
        <div className="nh-deck-thesis-move__cell">
          <span className="k">Expected Move</span>
          <span className={clsx("v", move != null && move >= 0 && "nh-deck-pos")}>
            {move != null ? `+${move}%` : "—"}
          </span>
        </div>
        <div className="nh-deck-thesis-move__cell">
          <span className="k">Risk</span>
          <span className="v">{risk ?? "—"}</span>
        </div>
      </div>
    </section>
  );
}

/** Entry-centered MAE/MFE bar + journey spine — replaces the old premium line chart. */
export function TradeExcursionGraphic({
  play,
  markFlash = false,
}: {
  play: TerminalPlay;
  markFlash?: boolean;
}) {
  const closed = play.status === "CLOSED";
  const isLegacy = play.horizon === "LEGACY";
  const currentPct = closed
    ? (play.exitPnlPct ?? play.pnlPct)
    : isLegacy
      ? (play.stockMovePct ?? play.pnlPct)
      : play.pnlPct;
  const worst = isLegacy ? play.stockTroughPct : play.trough;
  const best = isLegacy ? play.stockPeakPct : play.peak;
  const layout = entryCenteredExcursionLayout(worst, best, currentPct, { closed });

  if (!layout) return null;

  const entryUsd =
    play.entry != null && Number.isFinite(play.entry) ? `$${play.entry.toFixed(2)}` : "—";

  return (
    <section className="nh-deck-excursion-graphic" aria-label="Trade excursion">
      <div className="nh-deck-excursion-graphic__stats">
        <div className="nh-deck-excursion-graphic__stat">
          <span className="k">Entry</span>
          <span className="v">{entryUsd}</span>
          <span className="s">0%</span>
        </div>
        <div className="nh-deck-excursion-graphic__stat">
          <span className="k">Peak</span>
          <span className={clsx("v", signColorClass(layout.best))}>{formatExcursionPct(layout.best)}</span>
        </div>
        <div className="nh-deck-excursion-graphic__stat">
          <span className="k">{closed ? "Close" : "Current"}</span>
          <span
            className={clsx(
              "v",
              markFlash && "neon",
              currentPct != null ? signColorClass(currentPct) : "flat",
            )}
          >
            {currentPct != null ? formatExcursionPct(currentPct) : "—"}
          </span>
        </div>
      </div>

      <div className="nh-deck-excursion-graphic__bar-head">
        <span>Worst</span>
        <span>Entry</span>
        <span>Best</span>
      </div>
      <div className="nh-deck-excursion-graphic__bar" role="img" aria-hidden>
        <div className="nh-deck-excursion-graphic__bar-fill" />
        <span className="nh-deck-excursion-graphic__bar-zero" style={{ left: "50%" }} aria-hidden />
        {layout.markers.map((m) => (
          <div
            key={m.key}
            className={clsx(
              "nh-deck-excursion-graphic__marker",
              `is-${m.key}`,
              m.key === "current" && markFlash && "is-flash",
            )}
            style={{ left: `${m.posPct}%` }}
          >
            <span className={clsx("nh-deck-excursion-graphic__dot", signColorClass(m.pct))} />
            <span className={clsx("nh-deck-excursion-graphic__marker-lab", signColorClass(m.pct))}>
              {m.label}
            </span>
            <span className={clsx("nh-deck-excursion-graphic__marker-val", signColorClass(m.pct))}>
              {formatExcursionPct(m.pct)}
            </span>
          </div>
        ))}
      </div>

      <p className="nh-deck-excursion-graphic__note">
        Excursion from entry — latched best/worst marks, not tick-by-tick history.
      </p>
    </section>
  );
}

/** @deprecated Use TradeExcursionGraphic — kept as alias for any stale imports. */
export const PremiumMarkChart = TradeExcursionGraphic;

function StrengthBar({
  pct,
  className = "",
  animate = true,
}: {
  pct: number | null;
  className?: string;
  animate?: boolean;
}) {
  const fills = strengthBarSegmentFills(pct);
  const val = pct ?? 0;
  return (
    <div
      className={`nh-deck-strength-bar ${className}`.trim()}
      role="meter"
      aria-valuenow={pct ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={pct != null ? `${val}% strength` : "Strength unavailable"}
    >
      {fills.map((filled, i) => (
        <span
          key={i}
          className={clsx(
            "nh-deck-strength-bar__block",
            filled && "is-filled",
            animate && "is-animated",
          )}
          style={animate ? { animationDelay: `${i * 45}ms` } : undefined}
        />
      ))}
    </div>
  );
}

export function ConvictionHero({ play }: { play: TerminalPlay }) {
  const conviction = convictionDisplay(play);
  const strength = thesisStrengthPct(play) ?? conviction.score;
  return (
    <section className="nh-deck-conviction" aria-label="Conviction">
      <div className="nh-deck-conviction__label">Conviction</div>
      <div className="nh-deck-conviction__row">
        <div className="nh-deck-conviction__grade">{conviction.grade ?? "—"}</div>
        <div className="nh-deck-conviction__score">
          <span className="nh-deck-conviction__score-num">
            {conviction.score ?? "—"}
          </span>
          <span className="nh-deck-conviction__score-denom">/{conviction.max}</span>
        </div>
      </div>
      <StrengthBar pct={strength} className="nh-deck-conviction__battery" />
    </section>
  );
}

// NOTE: `ThesisStrengthBlock` (Thesis-tab "Conviction" % — `thesisStrengthPct(play)`, i.e.
// `thesisHealth.health`) was removed here (Night Hawk panel declutter, docs/audit/FINDINGS.md
// 2026-08-05). It carried no content beyond that single %, and that % is now the hero's canonical
// "Thesis Strength" tile (see `TradeSummaryHero` above) — always visible regardless of tab, so a
// second identical rendering buried in the collapsible Thesis tab added nothing but confusion
// ("which number do I trust — the one on top, or the one in the tab?"). `thesisStrengthPct` itself
// is untouched (pure, still exported, still unit-tested in terminal-display.test.ts) — this was a
// presentation-layer removal only, not a math change.

/** ONE merged checklist — replaces the prior three separate renders that described
 *  overlapping/related gate-and-scoring state under three different label taxonomies
 *  (`EngineChecklistPanel`'s 5-row list, `ConfluenceGrid`'s 6-cell grid, and the "Conviction
 *  tier breakdown" list built from `play.tierFactors`). Section 1 (pillar checks) fires for
 *  0DTE plays with thesis-health wired; Section 2 (tier factors) fires for Legacy plays with a
 *  pinned tier blob — the two data sources are mutually exclusive per play today (see
 *  docs/audit/FINDINGS.md 2026-08-04), so in practice a given play shows exactly one section,
 *  but both live in this single component/taxonomy instead of three separate render sites.
 *  Renders nothing when neither source has data (never an empty shell). */
export function ThesisChecklistPanel({ play }: { play: TerminalPlay }) {
  const pillarItems = unifiedChecklist(play);
  const hasPillarSignal = pillarItems.some((item) => item.ok !== null);
  const tierFactors = play.tierFactors ?? [];

  if (!hasPillarSignal && tierFactors.length === 0) return null;

  return (
    <section className="nh-deck-engine-check" aria-label="Engine checklist">
      <h4 className="nh-deck-premium__heading">Engine Checklist</h4>
      {hasPillarSignal && (
        <div className="nh-deck-confluence__grid">
          {pillarItems.map((item) => (
            <div
              key={item.label}
              className={clsx(
                "nh-deck-confluence__cell",
                item.ok === true && "is-pass",
                item.ok === false && "is-fail",
                item.ok == null && "is-na",
              )}
            >
              <span className="nh-deck-confluence__mark">
                {item.ok === true ? "✓" : item.ok === false ? "✕" : "—"}
              </span>
              <span className="nh-deck-confluence__name">{item.label}</span>
            </div>
          ))}
        </div>
      )}
      {tierFactors.length > 0 && (
        <div className="nh-deck-tierfactors" style={hasPillarSignal ? { marginTop: 10 } : undefined}>
          <div className="nh-deck-tierfactors-hd">
            <span className="nh-deck-tierfactors-lb">Merit tier · graded at publish</span>
            <span className="nh-deck-tierfactors-val">tier {play.tierLabel ?? "?"}</span>
          </div>
          <ul className="nh-deck-tierfactors-list">
            {tierFactors.map((f, i) => (
              <li key={`${f.label}-${i}`} className="nh-deck-tierfactor">
                <span className={`nh-deck-tierfactor-dir ${f.direction}`}>
                  {f.direction === "up" ? "▲" : "▼"} {f.label}
                </span>
                <span className="nh-deck-tierfactor-detail">{f.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ManagementActionCard({
  play,
  recommendation,
  progress,
}: {
  play: TerminalPlay;
  recommendation: Recommendation;
  progress: number | null;
}) {
  const action = managementActionDisplay(play, recommendation, progress);
  // The 15:50-ET "Decision Window" countdown is a 0DTE-ONLY same-session discipline (flat by the
  // hard exit THIS session) — a Swing position runs 2-30 days, so a same-day countdown would be
  // flatly false. The verb/size/urgency banner + reason + confidence rows above are horizon-agnostic
  // (extended to Swing 2026-08-05, docs/audit/FINDINGS.md) and render for both; only this clock
  // section is conditional. No swing-side "days remaining" substitute is shown — a Swing play has
  // no pinned hard-exit instant to count down to (unlike 0DTE's fixed 15:50 ET), so a fabricated
  // countdown would be dishonest; the Thesis tab's swing-status line covers the "why hold" context.
  const showsClock = play.horizon === "ZERO_DTE";
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!showsClock) return;
    const tick = () => {
      const { hour, minute } = etNowParts();
      const clock = timeStopClock(hour * 60 + minute);
      setMinutesRemaining(clock.minutes_remaining);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [showsClock]);

  const windowLabel = useMemo(
    () => (minutesRemaining != null ? decisionWindowLabel(minutesRemaining) : null),
    [minutesRemaining],
  );

  return (
    <section className="nh-deck-action-card" aria-label="Recommended action">
      <div className="nh-deck-action-card__banner">Recommended Action</div>
      <div className="nh-deck-action-card__primary">
        <span className="nh-deck-action-card__verb">{action.verb}</span>
        {action.sizePct != null ? (
          <span className="nh-deck-action-card__size">{action.sizePct}%</span>
        ) : null}
        <span className="nh-deck-action-card__now">{action.urgency}</span>
      </div>
      <div className="nh-deck-action-card__meta">
        <div className="nh-deck-action-card__row">
          <span className="nh-deck-action-card__key">Reason</span>
          <span className="nh-deck-action-card__val">{action.reason}</span>
        </div>
        {/* `action.probabilityPct` (labeled "Confidence" here) was removed from this render
            (Night Hawk panel declutter, docs/audit/FINDINGS.md 2026-08-05): for the common
            HOLD/TRIM path it is `thesisHealth.health` verbatim (`actionProbability` in
            terminal-display.ts returns it unchanged), and for SELL it is `100 - health` — still
            the SAME underlying field, just complemented. That number is now the hero's canonical
            "Thesis Strength" tile, always visible above every tab including this one — showing it
            a 2nd time here (a 3rd rendering counting the old Thesis-tab block) added no new
            information, only a risk that the two numbers drift/disagree in a future refactor.
            `action.probabilityPct` itself is untouched (still computed, still unit-tested) in case
            a future consumer needs the SELL-complemented framing specifically. */}
      </div>
      {showsClock && (
        <div className="nh-deck-action-card__window">
          <span className="nh-deck-action-card__window-label">Decision Window</span>
          <span className="nh-deck-action-card__window-clock">
            {windowLabel ? (
              <>
                {windowLabel.mins}m <span className="nh-deck-action-card__window-sep" /> {windowLabel.secs}s
              </>
            ) : (
              "—"
            )}
          </span>
        </div>
      )}
    </section>
  );
}

export function VisualTrimLadder({ play }: { play: TerminalPlay }) {
  const rungs = trimLadderVisual(play.exitPolicy);
  if (rungs.length === 0) return null;
  return (
    <section className="nh-deck-trim-visual" aria-label="Trim ladder">
      <h4 className="nh-deck-premium__heading">Trim Ladder</h4>
      <div className="nh-deck-trim-visual__list">
        {rungs.map((rung) => (
          <div key={rung.label} className={clsx("nh-deck-trim-visual__rung", `is-${rung.state}`)}>
            <div className="nh-deck-trim-visual__head">
              <span className="nh-deck-trim-visual__label">{rung.label}</span>
              <span className="nh-deck-trim-visual__state">
                {rung.state === "banked"
                  ? "BANKED"
                  : rung.state === "live"
                    ? "LIVE"
                    : "—"}
              </span>
            </div>
            <StrengthBar pct={Math.round(rung.fill * 100)} animate={false} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function TradeOutcomePanel({ play }: { play: TerminalPlay }) {
  const outcome = tradeOutcomeDisplay(play);
  const closePct = outcome.closePct;
  const sign = closePct != null && closePct >= 0 ? "+" : "";

  return (
    <section className="nh-deck-outcome" aria-label="Trade outcome">
      <div className={clsx("nh-deck-outcome__banner", `is-${outcome.verdict.toLowerCase()}`)}>
        {outcome.verdict === "OPEN" ? "LIVE" : outcome.verdict}
      </div>
      <div
        className={clsx(
          "nh-deck-outcome__close",
          (closePct ?? 0) > 0 && "nh-deck-pos",
          (closePct ?? 0) < 0 && "nh-deck-neg",
        )}
      >
        {closePct != null ? `${sign}${closePct.toFixed(0)}%` : "—"}
      </div>
    </section>
  );
}
