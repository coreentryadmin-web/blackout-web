"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import type { ConvictionRankContext } from "./deck-command-center";
import {
  confluenceChecklist,
  convictionDisplay,
  decisionWindowLabel,
  engineChecklist,
  engineConfidencePct,
  expectedMovePct,
  managementActionDisplay,
  marketContextItems,
  markDollarPnl,
  peakMark,
  riskUnitLabel,
  strengthBarSegmentFills,
  thesisStrengthPct,
  tradeOutcomeDisplay,
  tradeSummaryDisplay,
  trimLadderVisual,
} from "./terminal-display";
import {
  playFreshnessDisplay,
  playLifecycleTimestamps,
  playPrimaryEvent,
  playStatusDisplay,
} from "./play-card-lifecycle";
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
          <span className="k">Confidence</span>
          <span className="v">{summary.confidence ?? "—"}</span>
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

/** Entry / peak / current premium chart — grounded on mark math, not tick history. */
export function PremiumMarkChart({ play }: { play: TerminalPlay }) {
  const entry = play.entry;
  const current = play.mark;
  const peak = peakMark(play);
  if (entry == null) return null;

  const points = [
    { x: 0, y: entry, label: "Entry", val: entry },
    peak != null ? { x: 0.5, y: peak, label: "Peak", val: peak } : null,
    current != null ? { x: 1, y: current, label: "Current", val: current } : null,
  ].filter(Boolean) as Array<{ x: number; y: number; label: string; val: number }>;

  if (points.length < 2) return null;

  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const w = 200;
  const h = 48;
  const pad = 4;
  const toSvg = (p: { x: number; y: number }) => ({
    sx: pad + p.x * (w - pad * 2),
    sy: pad + (1 - (p.y - minY) / span) * (h - pad * 2),
  });
  const svgPts = points.map((p) => toSvg(p));
  const pathD = svgPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" ");

  return (
    <section className="nh-deck-mark-chart" aria-label="Premium excursion chart">
      <div className="nh-deck-mark-chart__labels">
        {points.map((p) => (
          <div key={p.label} className="nh-deck-mark-chart__label">
            <span className="k">{p.label}</span>
            <span className="v">{usd(p.val)}</span>
          </div>
        ))}
      </div>
      <svg className="nh-deck-mark-chart__svg" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <path className="nh-deck-mark-chart__line" d={pathD} fill="none" />
        {svgPts.map((p, i) => (
          <circle key={i} className="nh-deck-mark-chart__dot" cx={p.sx} cy={p.sy} r={3} />
        ))}
      </svg>
      <div className="nh-deck-mark-chart__note">
        Entry → peak → current — excursion path from latched marks, not tick-by-tick history.
      </div>
    </section>
  );
}

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

export function ThesisStrengthBlock({ play }: { play: TerminalPlay }) {
  const pct = thesisStrengthPct(play);
  return (
    <section className="nh-deck-thesis-strength" aria-label="Conviction">
      <div className="nh-deck-thesis-strength__head">
        <span className="nh-deck-thesis-strength__label">Conviction</span>
        <span className="nh-deck-thesis-strength__pct">
          {pct != null ? `${pct}%` : "—"}
        </span>
      </div>
      <StrengthBar pct={pct} />
    </section>
  );
}

export function ConfluenceGrid({ play }: { play: TerminalPlay }) {
  const items = confluenceChecklist(play);
  return (
    <section className="nh-deck-confluence" aria-label="Confluence">
      <h4 className="nh-deck-premium__heading">Confluence</h4>
      <div className="nh-deck-confluence__grid">
        {items.map((item) => (
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
    </section>
  );
}

export function EngineChecklistPanel({ play }: { play: TerminalPlay }) {
  const items = engineChecklist(play);
  return (
    <section className="nh-deck-engine-check" aria-label="Engine checklist">
      <h4 className="nh-deck-premium__heading">Engine Checks</h4>
      <div className="nh-deck-engine-check__list">
        {items.map((item) => (
          <div
            key={item.label}
            className={clsx(
              "nh-deck-engine-check__row",
              item.ok === true && "is-pass",
              item.ok === false && "is-fail",
              item.ok == null && "is-na",
            )}
          >
            <span className="nh-deck-engine-check__mark">
              {item.ok === true ? "✓" : item.ok === false ? "✕" : "—"}
            </span>
            <span className="nh-deck-engine-check__name">{item.label}</span>
          </div>
        ))}
      </div>
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
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const { hour, minute } = etNowParts();
      const clock = timeStopClock(hour * 60 + minute);
      setMinutesRemaining(clock.minutes_remaining);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

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
        <div className="nh-deck-action-card__row">
          <span className="nh-deck-action-card__key">Confidence</span>
          <span className="nh-deck-action-card__val nh-deck-action-card__prob">
            {action.probabilityPct != null ? `${action.probabilityPct}%` : "—"}
          </span>
        </div>
      </div>
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
  const best = outcome.bestPct;
  const worst = outcome.worstPct;
  const range = best != null && worst != null ? best - worst : null;
  const closePos =
    closePct != null && worst != null && range != null && range > 0
      ? Math.min(96, Math.max(4, ((closePct - worst) / range) * 100))
      : 50;

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
      {(best != null || worst != null) && (
        <div className="nh-deck-outcome__excursion">
          <div className="nh-deck-outcome__excursion-track">
            {range != null && range > 0 && (
              <span
                className="nh-deck-outcome__excursion-range"
                style={{
                  left: "4%",
                  width: "92%",
                }}
              />
            )}
            {closePct != null && (
              <span
                className="nh-deck-outcome__excursion-close"
                style={{ left: `${closePos}%` }}
              />
            )}
          </div>
          <div className="nh-deck-outcome__excursion-labels">
            <span>Best {best != null ? `+${best.toFixed(0)}%` : "—"}</span>
            <span>Worst {worst != null ? `${worst.toFixed(0)}%` : "—"}</span>
            <span>
              Close {closePct != null ? `${sign}${closePct.toFixed(0)}%` : "—"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
