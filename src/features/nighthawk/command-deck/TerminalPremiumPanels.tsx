"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import {
  confluenceChecklist,
  convictionDisplay,
  decisionWindowLabel,
  engineChecklist,
  managementActionDisplay,
  strengthBarSegmentFills,
  thesisStrengthPct,
  tradeOutcomeDisplay,
  trimLadderVisual,
} from "./terminal-display";
import { etNowParts } from "@/features/nighthawk/lib/session";
import { timeStopClock } from "@/lib/zerodte/terminal-ladder";
import type { Recommendation } from "./types";

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
    <section className="nh-deck-thesis-strength" aria-label="Thesis strength">
      <div className="nh-deck-thesis-strength__head">
        <span className="nh-deck-thesis-strength__label">Thesis Strength</span>
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
      <h4 className="nh-deck-premium__heading">Engine Checklist</h4>
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
    <section className="nh-deck-action-card" aria-label="Management action">
      <div className="nh-deck-action-card__banner">ACTION</div>
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
          <span className="nh-deck-action-card__key">Probability</span>
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
