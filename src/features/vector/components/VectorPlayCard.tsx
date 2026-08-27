"use client";

import clsx from "clsx";
import { STALE_MILD_MS, type VectorPlay } from "@/features/vector/lib/vector-play-engine";

type Props = {
  play: VectorPlay | null;
  className?: string;
  /** Opens the full desk analytics drawer (regime, walls, confluence, watch list). */
  onOpenAnalytics?: () => void;
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
 *
 * Redesigned 2026-08-27 (member, verbatim: "I feel like the layout UI UX of Vector plays is
 * really bad — like really bad — and it is small, can we make it bigger??"). This is a
 * presentation-only pass — `buildVectorPlay`/`vector-play-engine.ts` is untouched, every field
 * rendered here already existed on `VectorPlay`. What changed is hierarchy, not data:
 *  - Grade + conviction were two small, easy-to-miss inline scraps (a 20px letter chip, a
 *    right-floated "%") — they're now ONE scannable badge ("A · 76%") sized and colored to read
 *    as the card's verdict at a glance, borrowing the pill-badge treatment from SPX Slayer's
 *    `SpxPlayVerdictBar` (color-coded border/background/text using the same token, not just a
 *    bare number).
 *  - The headline is now the card's largest, most prominent text (was the same ~14px weight as
 *    the thesis below it) — it's the one-line trade idea, so it leads.
 *  - Entry/Targets/Invalidation were already a `<dl>` (not run-on prose), but cramped inline with
 *    no visual distinction; they're now a 3-row grid with a left accent rule per row and
 *    directional coloring (targets green, invalidation red/amber) so a member can find "where do
 *    I get out" without reading the sentence.
 *  - Overall padding/type scale increased throughout so the card reads as a primary rail element,
 *    not a cramped sidebar afterthought next to the (also-enlarged-in-spirit) contract picks card.
 */
export function VectorPlayCard({ play, className, onOpenAnalytics }: Props) {
  if (!play) return null;
  // dataAge was a documented passthrough nothing ever read — the doc comment on VectorSnapshot
  // promised "for the terminal to show staleness," but no UI surfaced it. This is that surface:
  // the same STALE_MILD_MS boundary computeConviction's discount starts applying at.
  const isStale = play.dataAge != null && play.dataAge > STALE_MILD_MS;
  return (
    <section
      className={clsx("vector-play-card", className)}
      aria-label="Suggested play"
      data-testid="vector-play-card"
    >
      <header className="vector-play-card-head">
        <span className={clsx("vector-play-card-badge", GRADE_TONE[play.grade])}>
          <span className="vector-play-card-badge-grade">{play.grade}</span>
          <span className="vector-play-card-badge-sep" aria-hidden="true">
            ·
          </span>
          <span className="vector-play-card-badge-conviction">{play.conviction}%</span>
        </span>
        <div className="vector-play-card-head-meta">
          <span className="vector-play-card-style">{play.style}</span>
          <span className={clsx("vector-play-card-bias", `vector-play-bias-${play.bias}`)}>
            {BIAS_LABEL[play.bias]}
          </span>
        </div>
        {isStale ? (
          <span className="vector-play-card-stale" title="Live data feed hasn't updated recently">
            STALE
          </span>
        ) : null}
        {onOpenAnalytics ? (
          <button
            type="button"
            className="vector-play-card-analytics-btn"
            onClick={onOpenAnalytics}
            aria-label="Open desk analytics"
            title="Full desk analytics — regime, walls, confluence, watch list"
          >
            Analytics
          </button>
        ) : null}
      </header>
      <p className="vector-play-card-headline">{play.headline}</p>
      <p className="vector-play-card-thesis">{play.thesis}</p>
      {(play.entryZone || play.targets.length || play.invalidation) && (
        <dl className="vector-play-card-levels">
          {play.entryZone ? (
            <div className="vector-play-card-level vector-play-card-level-entry">
              <dt>Entry</dt>
              <dd>{play.entryZone}</dd>
            </div>
          ) : null}
          {play.targets.length ? (
            <div className="vector-play-card-level vector-play-card-level-targets">
              <dt>Targets</dt>
              <dd>{play.targets.join(" → ")}</dd>
            </div>
          ) : null}
          {play.invalidation ? (
            <div className="vector-play-card-level vector-play-card-level-invalidation">
              <dt>Invalidation</dt>
              <dd>{play.invalidation}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}
