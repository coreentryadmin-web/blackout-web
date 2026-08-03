"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { playGradeLabel, playQualityPct } from "./play-card-display";
import { strengthBarSegmentFills } from "./terminal-display";

/** Prominent grade + score badge — the first thing traders compare across rows. */
export function ConfidenceBadge({
  play,
  hero = false,
  list = false,
  className,
}: {
  play: TerminalPlay;
  hero?: boolean;
  /** List rail: stars carry tier — show "Confidence" + score only. */
  list?: boolean;
  className?: string;
}) {
  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  if (grade == null && quality == null) return null;

  const fills = strengthBarSegmentFills(quality, 10);
  const showGrade = grade != null && !list;

  return (
    <div
      className={clsx(
        "nh-deck-conf-badge",
        hero && "nh-deck-conf-badge-hero",
        list && "nh-deck-conf-badge-list",
        className,
      )}
      aria-label={
        quality != null
          ? `Confidence ${quality}${grade ? `, grade ${grade}` : ""}`
          : grade
            ? `Grade ${grade}`
            : undefined
      }
    >
      {showGrade && <span className="nh-deck-conf-badge__grade">{grade}</span>}
      {quality != null && (
        <div className="nh-deck-conf-badge__stack">
          {list && <span className="nh-deck-conf-badge__label">Confidence</span>}
          <div className="nh-deck-conf-badge__bar" aria-hidden>
            {fills.map((filled, i) => (
              <span key={i} className={clsx("nh-deck-conf-badge__seg", filled && "is-on")} />
            ))}
          </div>
          <span className="nh-deck-conf-badge__score">{quality}</span>
        </div>
      )}
    </div>
  );
}
