"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { playGradeLabel, playQualityPct } from "./play-card-display";
import { strengthBarSegmentFills } from "./terminal-display";

/** Inline grade + score for compact list rows — e.g. B 82. */
export function ConfidenceBadge({
  play,
  hero = false,
  list = false,
  inline = false,
  className,
}: {
  play: TerminalPlay;
  hero?: boolean;
  /** List rail: stars carry tier — show "Confidence" + score only. */
  list?: boolean;
  /** Single-row list card: grade + score only. */
  inline?: boolean;
  className?: string;
}) {
  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  if (grade == null && quality == null) return null;

  if (inline) {
    return (
      <span
        className={clsx("nh-deck-conf-inline", className)}
        aria-label={
          quality != null
            ? `Grade ${grade ?? ""} score ${quality}`.trim()
            : grade
              ? `Grade ${grade}`
              : undefined
        }
      >
        {grade != null && <span className="nh-deck-conf-inline__grade">{grade}</span>}
        {quality != null && <span className="nh-deck-conf-inline__score">{quality}</span>}
      </span>
    );
  }

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
