"use client";

import { clsx } from "clsx";
import type { StructureLadder, StructureLadderRung } from "@/lib/swing/play-brief-ladder";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";

function fmtPrice(n: number): string {
  // Round for display — several endpoints serve unrounded floats (7499.360000001), same guard
  // BieKeyLevelsTable already applies to level prices.
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtDist(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

const ROLE_LABEL: Record<StructureLadderRung["role"], string> = {
  support: "Support",
  resistance: "Resistance",
  neutral: "Pivot",
};

const HORIZON_LABEL: Record<"short_term" | "swing", string> = {
  short_term: "short-term",
  swing: "swing",
};

/**
 * One ladder rung — ports the CSS-width bar primitive from `GexDepthLadderView`
 * (src/features/thermal/components/GexHeatmap.tsx): a centered zero-spine with a colored fill
 * whose width is the rung's magnitude relative to the widest rung on the ladder, growing toward
 * whichever side of the spine the rung actually sits on. There the magnitude was dealer notional
 * and the two sides were buy/sell; here the magnitude is `|distancePct|` and the two sides are
 * "below spot" (support, fill grows left) vs "above spot" (resistance, fill grows right) — the
 * same mechanic, repurposed for a signed distance instead of a signed order-flow direction.
 */
function LadderRow({ rung, maxAbsDistPct }: { rung: StructureLadderRung; maxAbsDistPct: number }) {
  const w = maxAbsDistPct > 0 ? Math.min(100, (Math.abs(rung.distancePct) / maxAbsDistPct) * 100) : 0;
  const above = rung.distancePct >= 0;
  return (
    <div className="bie-ladder-row">
      <span className="bie-ladder-row-price">{fmtPrice(rung.price)}</span>
      <div className="bie-ladder-row-track">
        <span aria-hidden className="bie-ladder-row-spine" />
        <span
          aria-hidden
          className={clsx(
            "bie-ladder-row-fill",
            `bie-ladder-role-${rung.role}`,
            above ? "bie-ladder-row-fill-above" : "bie-ladder-row-fill-below",
          )}
          style={{ width: `${w / 2}%` }}
        />
      </div>
      <span className="bie-ladder-row-meta">
        <span className="bie-ladder-row-label">{rung.label}</span>
        <span className="bie-ladder-row-dist">{fmtDist(rung.distancePct)}</span>
        <span className={clsx("bie-ladder-role-chip", `bie-ladder-role-${rung.role}`)}>
          {ROLE_LABEL[rung.role]}
        </span>
      </span>
      <span className="bie-ladder-row-target">
        {rung.target ? (
          <>
            <span className="bie-ladder-rr">{rung.target.rewardRisk.toFixed(1)}R</span>
            <span className="bie-ladder-horizon">{HORIZON_LABEL[rung.target.horizon]}</span>
          </>
        ) : (
          <span aria-hidden className="bie-ladder-row-target-empty">
            —
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Structure Ladder widget (Ask Largo standing mandate, 2026-09-12) — sibling of
 * `BieKeyLevelsTable`, built for swing play briefs specifically. Renders `envelope.structureLadder`
 * (`src/lib/swing/play-brief-ladder.ts`): every real structural node for this ticker with real
 * per-level R:R to the actual structural stop, plus a cross-desk gamma-regime agreement flag and
 * (when graduated) this archetype's historical win rate.
 *
 * Absent/empty on every non-swing answer and on a CLOSED swing brief — renders nothing rather than
 * an empty card, matching every other optional block in this answer UI (`BieKeyLevelsTable`,
 * `BieScenarioCards`).
 */
export function BieStructureLadder({ ladder }: { ladder: StructureLadder | null | undefined }) {
  if (!ladder || !ladder.rungs.length) return null;

  const maxAbsDistPct = Math.max(...ladder.rungs.map((r) => Math.abs(r.distancePct)), 0.01);
  // Rungs are already sorted high price -> low price (StructureLadder's own contract). Find where
  // the live spot slots in so the SPOT marker row prints in its true sorted position, the same
  // technique GexDepthLadderView uses for its own spot row.
  const spotIdx = ladder.rungs.findIndex((r) => r.price < ladder.spot);
  const spotRow = (
    <div className="bie-ladder-spot-row">
      <span className="bie-ladder-spot-price">{fmtPrice(ladder.spot)}</span>
      <span aria-hidden className="bie-ladder-spot-line" />
      <span className="bie-ladder-spot-label">SPOT</span>
    </div>
  );

  return (
    <div className="bie-ladder">
      <div className="bie-ladder-head">
        <p className="bie-block-label">Structure ladder</p>
        {ladder.crossDeskAgreement ? (
          <span
            className={clsx(
              "bie-ladder-agreement",
              ladder.crossDeskAgreement.status === "aligned"
                ? "bie-ladder-agreement-aligned"
                : "bie-ladder-agreement-disagreement",
            )}
          >
            {ladder.crossDeskAgreement.status === "aligned" ? "Desks aligned" : "Desks disagree"}
          </span>
        ) : null}
      </div>

      {ladder.crossDeskAgreement?.status === "disagreement" && ladder.crossDeskAgreement.note ? (
        <p className="bie-ladder-agreement-note">{renderInlineMarkdown(ladder.crossDeskAgreement.note)}</p>
      ) : null}

      <div
        className="bie-ladder-rows"
        role="img"
        aria-label={`Structure ladder for a ${ladder.direction} setup, spot ${fmtPrice(ladder.spot)}. Levels above spot resist, levels below spot support; each level's reward-to-risk is measured against the structural stop at ${fmtPrice(ladder.stop)}.`}
      >
        {ladder.rungs.map((r, i) => (
          <div key={`${r.kind}-${r.price}`}>
            {i === spotIdx ? spotRow : null}
            <LadderRow rung={r} maxAbsDistPct={maxAbsDistPct} />
          </div>
        ))}
        {spotIdx === -1 ? spotRow : null}
      </div>

      <p className="bie-ladder-stop">
        Structural stop <strong>{fmtPrice(ladder.stop)}</strong> — every R:R above is measured against
        this level, not a fixed multiple.
      </p>

      {ladder.archetypeTrackRecord ? (
        <p className="bie-ladder-track-record">
          <strong>{ladder.archetypeTrackRecord.archetypeLabel}</strong> archetype
          {ladder.archetypeTrackRecord.winRatePct != null
            ? ` — ${ladder.archetypeTrackRecord.winRatePct.toFixed(0)}% win rate`
            : ""}{" "}
          (Wilson 95% LB {ladder.archetypeTrackRecord.wilsonLbPct.toFixed(0)}%, n=
          {ladder.archetypeTrackRecord.n})
        </p>
      ) : null}
    </div>
  );
}
