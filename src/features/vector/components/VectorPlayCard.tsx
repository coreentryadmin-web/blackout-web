"use client";

import clsx from "clsx";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";

type Props = {
  play: VectorPlay | null;
  className?: string;
};

const GRADE_TONE: Record<VectorPlay["grade"], string> = {
  A: "vector-play-grade-a",
  B: "vector-play-grade-b",
  C: "vector-play-grade-c",
};

const BIAS_LABEL: Record<VectorPlay["bias"], string> = {
  long: "LONG",
  short: "SHORT",
  range: "RANGE",
  neutral: "NEUTRAL",
};

/**
 * Suggested Play card — the Pulse rail's synthesis of everything Vector already tracks
 * (`buildVectorPlay`) into ONE concrete trade idea, instead of leaving the member to fuse the
 * regime/magnet/proximity/confluence/wall-integrity narration in their head. Renders nothing when
 * there isn't enough structure yet (no spot) — same "never fabricate, degrade to absent" policy
 * every other Vector overlay follows.
 */
export function VectorPlayCard({ play, className }: Props) {
  if (!play) return null;
  return (
    <section
      className={clsx("vector-play-card", className)}
      aria-label="Suggested play"
      data-testid="vector-play-card"
    >
      <header className="vector-play-card-head">
        <span className={clsx("vector-play-card-grade", GRADE_TONE[play.grade])}>{play.grade}</span>
        <span className="vector-play-card-style">{play.style}</span>
        <span className={clsx("vector-play-card-bias", `vector-play-bias-${play.bias}`)}>
          {BIAS_LABEL[play.bias]}
        </span>
        <span className="vector-play-card-conviction">{play.conviction}%</span>
      </header>
      <p className="vector-play-card-headline">{play.headline}</p>
      <p className="vector-play-card-thesis">{play.thesis}</p>
      {(play.entryZone || play.targets.length || play.invalidation) && (
        <dl className="vector-play-card-levels">
          {play.entryZone ? (
            <div className="vector-play-card-level">
              <dt>Entry</dt>
              <dd>{play.entryZone}</dd>
            </div>
          ) : null}
          {play.targets.length ? (
            <div className="vector-play-card-level">
              <dt>Targets</dt>
              <dd>{play.targets.join(" → ")}</dd>
            </div>
          ) : null}
          {play.invalidation ? (
            <div className="vector-play-card-level">
              <dt>Invalidation</dt>
              <dd>{play.invalidation}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}
