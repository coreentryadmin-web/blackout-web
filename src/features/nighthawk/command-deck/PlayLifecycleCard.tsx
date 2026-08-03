"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { etClock } from "./PlayTerminal";
import {
  closedRealizedPct,
  directionSetupLine,
  horizonDisplayLabel,
  openMetricsLabels,
  openMetricsValues,
  playFreshnessDisplay,
  playLifecyclePhase,
  playPrimaryEvent,
  playStatusDisplay,
  playTriggeredEvent,
  setupTypeLabel,
  watchWaitLabel,
} from "./play-card-lifecycle";
import { formatReturnPct, playGradeLabel, tierStars } from "./play-card-display";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { AgeDecayBadge, StatusPill } from "./DeckStatusBadges";

function FreshnessBadge({
  freshness,
}: {
  freshness: ReturnType<typeof playFreshnessDisplay>;
}) {
  const age = freshness.compactAge ?? freshness.badgeLabel;
  return (
    <span className="nh-deck-lc-fresh-wrap">
      <AgeDecayBadge
        compactAge={age}
        decayTone={freshness.decayTone}
        pulse={freshness.pulse}
      />
      {freshness.lateEntry && (
        <span className="nh-deck-lc-late">Late Entry</span>
      )}
    </span>
  );
}

function EventLine({
  label,
  iso,
  relativeAge,
}: {
  label: string;
  iso: string | null;
  relativeAge: string | null;
}) {
  const clock = iso ? etClock(iso) : null;
  if (!clock && !relativeAge) return null;
  return (
    <div className="nh-deck-lc-event">
      <span className="nh-deck-lc-event-lab">{label}</span>
      <span className="nh-deck-lc-event-val">
        {clock ? `${clock} ET` : "—"}
        {relativeAge && clock ? ` • ${relativeAge}` : relativeAge ? relativeAge : null}
      </span>
    </div>
  );
}

export function PlayLifecycleCardBody({
  play,
  rank,
  nowMs,
  hero = false,
  markFlash = false,
}: {
  play: TerminalPlay;
  rank: number;
  nowMs: number;
  hero?: boolean;
  markFlash?: boolean;
}) {
  const phase = playLifecyclePhase(play.status);
  const primary = playPrimaryEvent(play);
  const freshness = playFreshnessDisplay(play, nowMs, primary.iso);
  const status = playStatusDisplay(play.status);
  const setup = setupTypeLabel(play);
  const horizonLabel = horizonDisplayLabel(play.horizon);
  const metricLabels = openMetricsLabels(play);
  const { currentPct, peakPct } = openMetricsValues(play);
  const grade = playGradeLabel(play);
  const stars = grade ? tierStars(grade) : "";

  const realized = closedRealizedPct(play);

  const signClass = (n: number | null | undefined) =>
    n != null && n > 0 ? "nh-deck-pos" : n != null && n < 0 ? "nh-deck-neg" : undefined;

  return (
    <div className={clsx("nh-deck-lc", hero && "nh-deck-lc-hero", `is-${phase}`)}>
      {hero && rank === 1 && (
        <div className="nh-deck-hero-banner" aria-hidden>
          BEST PLAY TODAY
        </div>
      )}

      <div className="nh-deck-lc-identity">
        {!hero && rank > 0 && (
          <span className="nh-deck-lc-rank-corner" aria-label={`Rank ${rank}`}>
            #{rank}
          </span>
        )}
        <div className="nh-deck-lc-title-block">
          <span className="nh-deck-lc-ticker">{play.ticker}</span>
          {stars && (
            <span className="nh-deck-lc-stars" aria-label={`Tier ${grade}`}>
              {stars}
            </span>
          )}
        </div>
      </div>

      <div className="nh-deck-lc-status-row">
        <StatusPill label={status.label} tone={status.tone} />
        <span className="nh-deck-lc-horizon">{horizonLabel}</span>
      </div>

      {phase !== "watch" && (
        <div className="nh-deck-lc-dir-row">
          <span className={clsx("nh-deck-lc-dir", play.direction === "LONG" ? "long" : "short")}>
            {directionSetupLine(play)}
          </span>
        </div>
      )}

      <div className="nh-deck-lc-conf-row">
        <ConfidenceBadge play={play} hero={hero} list={!hero} />
      </div>

      {phase === "watch" && (
        <div className="nh-deck-lc-wait">{watchWaitLabel(play)}</div>
      )}

      {phase !== "closed" && (
        <div className="nh-deck-lc-age-row">
          <FreshnessBadge freshness={freshness} />
        </div>
      )}

      {phase === "open" && (
        <div className="nh-deck-lc-metrics">
          <div className="nh-deck-lc-metric">
            <span className="k">{metricLabels.current}</span>
            <span className={clsx("v", signClass(currentPct), markFlash && currentPct != null && "neon")}>
              {currentPct != null ? formatReturnPct(currentPct) : "—"}
            </span>
          </div>
          <div className="nh-deck-lc-metric">
            <span className="k">{metricLabels.peak}</span>
            <span className={clsx("v", signClass(peakPct))}>
              {peakPct != null ? formatReturnPct(peakPct) : "—"}
            </span>
          </div>
        </div>
      )}

      {phase === "closed" && (
        <>
          <div className="nh-deck-lc-closed-times">
            <EventLine
              label={playTriggeredEvent(play).label}
              iso={playTriggeredEvent(play).iso}
              relativeAge={null}
            />
            <EventLine label={primary.label} iso={primary.iso} relativeAge={null} />
          </div>
          <div className="nh-deck-lc-metrics">
            <div className="nh-deck-lc-metric">
              <span className="k">Peak</span>
              <span className={clsx("v", signClass(peakPct ?? play.peak))}>
                {(peakPct ?? play.peak) != null ? formatReturnPct(peakPct ?? play.peak!) : "—"}
              </span>
            </div>
            <div className="nh-deck-lc-metric">
              <span className="k">Realized</span>
              <span className={clsx("v", signClass(realized))}>
                {realized != null ? formatReturnPct(realized) : "—"}
              </span>
            </div>
          </div>
        </>
      )}

      {hero && setup && (
        <div className="nh-deck-hero-cta">Tap to inspect →</div>
      )}
    </div>
  );
}
