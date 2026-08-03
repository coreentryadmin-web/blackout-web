"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { etClock } from "./PlayTerminal";
import {
  closedRealizedPct,
  directionSetupLine,
  playFreshnessDisplay,
  playLifecyclePhase,
  playPrimaryEvent,
  playStatusLabel,
  playTriggeredEvent,
  setupTypeLabel,
} from "./play-card-lifecycle";
import { formatReturnPct, playGradeLabel, playQualityPct, tierStars } from "./play-card-display";

function FreshnessBadge({
  freshness,
}: {
  freshness: ReturnType<typeof playFreshnessDisplay>;
}) {
  const tone =
    freshness.tier === "just_fired" || freshness.tier === "fresh"
      ? "fresh"
      : freshness.tier === "aging"
        ? "aging"
        : freshness.tier === "late"
          ? "late"
          : "closed";

  return (
    <span className="nh-deck-lc-fresh-wrap">
      <span
        className={clsx(
          "nh-deck-lc-fresh",
          `is-${tone}`,
          freshness.pulse && "is-pulse",
        )}
      >
        <span className="nh-deck-lc-fresh-dot" aria-hidden />
        {freshness.badgeLabel}
      </span>
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
  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  const stars = grade ? tierStars(grade) : "";
  const primary = playPrimaryEvent(play);
  const freshness = playFreshnessDisplay(play, nowMs, primary.iso);
  const statusLabel = playStatusLabel(play.status);
  const setup = setupTypeLabel(play);

  const currentPct = play.pnlPct;
  const peakPct = play.peak;
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

      <div className="nh-deck-lc-head">
        <div className="nh-deck-lc-grade-row">
          {grade && (
            <span className="nh-deck-lc-grade" aria-label={`Grade ${grade}`}>
              {hero && <span className="nh-deck-lc-trophy" aria-hidden>🏆 </span>}
              {grade}
            </span>
          )}
          {!hero && rank > 0 && (
            <span className="nh-deck-lc-rank">#{rank}</span>
          )}
          {stars && !hero && (
            <span className="nh-deck-lc-stars" aria-hidden>{stars}</span>
          )}
        </div>
        <span className="nh-deck-lc-ticker">{play.ticker}</span>
      </div>

      <div className="nh-deck-lc-setup">
        {phase === "watch" ? (
          <>
            <span className="nh-deck-lc-watch-tag">WATCH</span>
            <span className="nh-deck-lc-horizon">0DTE</span>
          </>
        ) : (
          <>
            <span className={clsx("nh-deck-lc-dir", play.direction === "LONG" ? "long" : "short")}>
              {directionSetupLine(play)}
            </span>
            <span className="nh-deck-lc-horizon">0DTE</span>
          </>
        )}
      </div>

      {quality != null && (
        <div className="nh-deck-lc-conf">
          Confidence <b>{quality}</b>
        </div>
      )}

      {phase === "watch" && (
        <div className="nh-deck-lc-wait">Waiting for Trigger</div>
      )}

      {phase !== "closed" && (
        <>
          <FreshnessBadge freshness={freshness} />
          <EventLine
            label={primary.label}
            iso={primary.iso}
            relativeAge={freshness.relativeAge}
          />
        </>
      )}

      {phase === "closed" && (
        <>
          <EventLine
            label={playTriggeredEvent(play).label}
            iso={playTriggeredEvent(play).iso}
            relativeAge={null}
          />
          <EventLine label={primary.label} iso={primary.iso} relativeAge={null} />
        </>
      )}

      {phase === "open" && (
        <div className="nh-deck-lc-metrics">
          <div className="nh-deck-lc-metric">
            <span className="k">Current</span>
            <span className={clsx("v", signClass(currentPct), markFlash && currentPct != null && "neon")}>
              {currentPct != null ? formatReturnPct(currentPct) : "—"}
            </span>
          </div>
          <div className="nh-deck-lc-metric">
            <span className="k">Peak</span>
            <span className={clsx("v", signClass(peakPct))}>
              {peakPct != null ? formatReturnPct(peakPct) : "—"}
            </span>
          </div>
        </div>
      )}

      {phase === "closed" && (
        <div className="nh-deck-lc-metrics">
          <div className="nh-deck-lc-metric">
            <span className="k">Peak</span>
            <span className={clsx("v", signClass(peakPct))}>
              {peakPct != null ? formatReturnPct(peakPct) : "—"}
            </span>
          </div>
          <div className="nh-deck-lc-metric">
            <span className="k">Realized</span>
            <span className={clsx("v", signClass(realized))}>
              {realized != null ? formatReturnPct(realized) : "—"}
            </span>
          </div>
        </div>
      )}

      <div className="nh-deck-lc-foot">
        <span className="k">Status</span>
        <span className={clsx("nh-deck-lc-status", statusLabel.toLowerCase())}>{statusLabel}</span>
      </div>

      {hero && setup && (
        <div className="nh-deck-hero-cta">Tap to inspect →</div>
      )}
    </div>
  );
}
