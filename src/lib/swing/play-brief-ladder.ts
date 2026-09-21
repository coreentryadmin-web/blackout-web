/**
 * Structure Ladder — a single-source dealer-positioning price ladder for the swing play brief.
 *
 * Built 2026-09-12 (Ask Largo standing mandate) after the operator flagged a competitor panel
 * ("Launchpad Ladder") that renders an ordered price ladder + fixed-multiple R:R targets + a
 * "moonshot" tier off ONE data source (their own GEX matrix). This widget answers the same trader
 * question — "what's between here and where, and what's the reward for the risk" — with THREE
 * things a single-source tool structurally cannot do:
 *
 *   1. Rungs pulled from `collectFocalLevels` (play-brief-narrative.ts) — the SAME Vector-ladder-
 *      first/GEX-matrix-fallback resolution already narrated elsewhere in this brief, so this
 *      widget can never disagree with "Trade manager read" about where a wall or the gamma flip
 *      sits. Includes dark-pool prints and the gamma magnet — nodes a GEX-only tool never sees.
 *   2. Real per-level R:R computed to the ACTUAL structural stop (`deriveSwingPlanLevels`,
 *      structure-levels.ts — the exact function every committed swing position's real
 *      `thesis_invalidation_px` is derived from at commit), not a fixed 1:2/1:3 multiple to an
 *      arbitrary target.
 *   3. A cross-desk gamma-regime agreement flag — Vector's own regime read vs what the GEX
 *      matrix's OWN flip independently implies. A single-source panel cannot even ask this
 *      question; disagreement is real information (Largo product contract: "disagreement is
 *      represented, never reconciled").
 *
 * NO fabricated moonshot/far-dated tier — see `buildStructureLadder`'s own comment below for why,
 * and the PR description for the deliberate-omission write-up.
 *
 * Pure + deterministic — no IO, no LLM. Bucket-gated OPEN/WATCH only (see point 6, PR description):
 * a CLOSED position has no forward risk/reward left to show, matching the identical bucket gate
 * `chartTechnicalsSection`/`gexPostureSection`/`wallDynamicsSection` already apply in
 * play-brief-intel.ts for the same "today's read vs the trade's own conditions" reason.
 *
 * CORRECTNESS NOTE on `stop`/point 2 above for an already-OPEN position: `stop` is always computed
 * LIVE from today's spot (see `StructureLadderTarget`'s own comment) — it is never the real,
 * frozen `thesis_invalidation_px` a committed position's actual entry pinned, because that value
 * is not threaded onto `TerminalPlay` today. For a WATCH candidate this is exactly right (there is
 * no real position yet to disagree with). For an OPEN/HOLD/TRIM position it is an honest estimate
 * that can diverge from the real, system-governing stop once the underlying has moved since entry
 * — `StructureLadder.positionState` exists so the UI can caveat this specifically for that case
 * rather than silently presenting a recompute as the trade's actual risk level.
 */
import type { DeckDirection, TerminalPlay } from "@/features/nighthawk/command-deck/types";
import type { PlayDirection } from "../horizon-fanout";
import type { GexPositioning } from "@/lib/providers/gex-positioning";
import type { VectorFullState } from "@/lib/bie/vector-full-state";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { fmtPriceLevel } from "@/lib/fmt-money";
import { preferredGexWalls } from "./play-brief-intel";
import { collectFocalLevels, type FocalLevel, type LevelKind } from "./play-brief-narrative";
import { gexMatrixStale, vectorSnapshotStale } from "./play-brief-absence";
import { deriveSwingPlanLevels } from "./structure-levels";
import { graduatedArchetypeEntry, type SwingArchetypeTrackRecordSnapshot } from "./calibration-cache";
import { ARCHETYPE_META, SWING_ARCHETYPES } from "./taxonomy";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

/** Same kind vocabulary `collectFocalLevels` already uses — see that function's header on why this
 *  is reused rather than re-invented (a third, independently-drifting enum for the same 7 nodes). */
export type StructureLadderRungKind = LevelKind;

export type StructureLadderRungRole = "support" | "resistance" | "neutral";

/**
 * Reward:risk for a rung on the favorable side of spot — never present on the unfavorable side
 * (a target behind you, in the direction the thesis breaks toward, is not a reward).
 */
export type StructureLadderTarget = {
  /**
   * |rung.price − entry| / |entry − stop|, where entry/stop come from `deriveSwingPlanLevels`
   * (structure-levels.ts) evaluated at the CURRENT spot — the same real ATR-based formula every
   * committed swing position's real `thesis_invalidation_px` is derived from at commit (dossier.ts/
   * commit.ts), not a fixed 1:2/1:3 multiple to a made-up target. See `buildStructureLadder`'s own
   * comment for why this is evaluated live rather than reading back the frozen per-position value.
   */
  rewardRisk: number;
  /**
   * Distance bucket from the SAME ATR value the R:R stop was derived from (within ~2x ATR =
   * short_term, beyond it = swing) — reused ONLY for horizon classification, never to fabricate a
   * target price or date.
   */
  horizon: "short_term" | "swing";
  /**
   * True when at least one OTHER favorable-side rung sits further from spot than this one —
   * i.e. clearing this rung is what exposes the next target, not the final one. Derived purely
   * from the real rung set already built (never a fabricated tier): among the favorable-side
   * rungs ordered by distance from spot, every rung except the single farthest one is a
   * gatekeeper for whichever rung comes after it. The farthest favorable rung is never a
   * gatekeeper — there is nothing further out on THIS ladder for it to open up.
   */
  gatekeeper: boolean;
};

export type StructureLadderRung = {
  kind: StructureLadderRungKind;
  /** e.g. "call wall", "put wall", "gamma flip", "GEX king", "max pain", "dark pool", "gamma magnet". */
  label: string;
  price: number;
  /** Signed % distance from spot — positive = above spot. */
  distancePct: number;
  role: StructureLadderRungRole;
  /** Extra context off the source read (e.g. dark-pool print size) when `collectFocalLevels` carried one. */
  meta?: string;
  /** Present ONLY when this rung sits on the favorable side of spot for `direction` — see
   *  `StructureLadderTarget`'s own comment. Omitted (not null) on the unfavorable side. */
  target?: StructureLadderTarget;
};

/**
 * Cross-desk gamma-regime agreement (point 3) — Vector's OWN regime read (`vec.regime.posture`,
 * read raw here, never through `resolveGammaPosture`'s GEX-matrix fallback: that fallback exists
 * so a NARRATIVE line always has something to say, but it would make this comparison compare the
 * GEX matrix against itself whenever Vector's own read were absent, which is not a comparison at
 * all) against what the GEX matrix's OWN flip independently implies (spot vs `gex.flip`: spot
 * above flip → long gamma, below → short gamma — the same sign convention `deriveVectorRegime`,
 * vector-regime.ts, uses for Vector's own read, confirmed before assuming it).
 *
 * THREE-STATE, never a forced binary (Largo C3 absence honesty): "aligned" when both reads agree,
 * "disagreement" with a plain-English note naming the discrepancy when Vector's own (non-unknown)
 * read contradicts the matrix-implied one, and the FIELD IS OMITTED ENTIRELY (not present, not a
 * third "unknown" value) whenever either side has nothing to say — Vector's read is "unknown", the
 * matrix is stale/cold, or spot sits exactly on the flip with no independent implied side.
 */
export type StructureLadderAgreement = {
  status: "aligned" | "disagreement";
  /** Only present on "disagreement" — names the specific discrepancy. */
  note?: string;
};

export type StructureLadderArchetypeTrackRecord = {
  archetypeLabel: string;
  /** Null only when the graduated bucket's own n=0 edge case (graduatedArchetypeEntry's own contract). */
  winRatePct: number | null;
  wilsonLbPct: number;
  n: number;
};

/**
 * The single nearest rung on the unfavorable side of spot (`StructureLadder.riskTheOtherSide`) —
 * always a REFERENCE into the same `rungs` array (kind/label/price/distancePct copied verbatim),
 * never an independently-derived level. `role` is carried through so the UI can phrase it
 * correctly ("support" the price would have to break down through, vs "resistance" it would have
 * to break up through) rather than re-deriving that from price/spot a second time.
 */
export type StructureLadderRisk = {
  kind: StructureLadderRungKind;
  label: string;
  price: number;
  distancePct: number;
  role: StructureLadderRungRole;
};

export type StructureLadder = {
  spot: number;
  direction: DeckDirection;
  /**
   * The real ATR-derived structural stop every rung's R:R is measured against (see
   * `StructureLadderTarget`) — ALWAYS computed live from TODAY's spot via `deriveSwingPlanLevels`,
   * never read back from a frozen per-position value (see that type's own comment and
   * `positionState` immediately below for why this matters on an already-OPEN position).
   */
  stop: number;
  /** The ATR value the stop/horizon classification were derived from. */
  atr: number;
  /**
   * "watch" for a pre-entry candidate, "open" for an already-committed OPEN/HOLD/TRIM position.
   *
   * This does NOT mean `stop` reflects the real per-position value — it never does; `stop` above
   * is always a fresh live recompute from TODAY's spot (see its own comment), never the frozen
   * per-position one. It exists so the UI can render the honest caveat only where it is needed:
   * for a WATCH candidate, "if you enter here, this is the plan" is exactly the right claim, since
   * no position exists yet to disagree with it. For an OPEN/HOLD/TRIM position, a REAL committed
   * stop already exists — `thesis_invalidation_px`, frozen at the position's actual entry price
   * and actually read by `manage-sync.ts` to decide whether to recommend an exit — and it can be
   * materially different from this live recompute once the underlying has moved since entry.
   * `thesis_invalidation_px` is not threaded onto `TerminalPlay` today (see `buildStructureLadder`'s
   * own comment — real, separate plumbing, out of scope here), so this widget cannot show the real
   * number; the honest fix available NOW is telling the member it's showing an estimate rather than
   * silently labeling a recomputed number as if it were their trade's actual, frozen risk level —
   * exactly the "plausible wrong number is worse than an obvious one" trap the Largo product
   * contract's C4 identity section warns about.
   */
  positionState: "watch" | "open";
  /** Sorted high price → low price (the convention every price ladder in this codebase already uses —
   *  see `GexDepthLadderView`, thermal's depth ladder). */
  rungs: StructureLadderRung[];
  /** Omitted (not present) when either side of the comparison has nothing to say — see
   *  `StructureLadderAgreement`'s own header. */
  crossDeskAgreement?: StructureLadderAgreement;
  /** Omitted (not present) unless this archetype's bucket has actually graduated (Largo C6 —
   *  `graduatedArchetypeEntry`, the exact same gate `archetypeTrackRecordSection` uses elsewhere in
   *  this brief; never a second, independently-computed confidence number). */
  archetypeTrackRecord?: StructureLadderArchetypeTrackRecord;
  /**
   * The nearest real rung on the UNFAVORABLE side of spot — i.e. a level the thesis has to work
   * against, not toward. Omitted (not present) when every rung on this ladder happens to sit on
   * the favorable side (nothing on the wrong side to name). Never a second, independently-derived
   * level — always one of the SAME `rungs` above, so this can never disagree with the ladder it
   * summarizes.
   */
  riskTheOtherSide?: StructureLadderRisk;
  /** ET stamp ("YYYY-MM-DD HH:mm ET") this ladder was assembled — Largo product-contract C1: a
   *  bare UTC instant with no session anchor reads a full session ahead after ~20:00 ET (see
   *  `src/lib/largo/contract/session-anchor.test.ts`), so this uses `etStamp()` rather than a raw
   *  `Date.toISOString()`. */
  asOf: string;
};

/**
 * Institutional/dealer nodes (walls, GEX king, dark pool) are directional barriers — above spot
 * they cap/resist, below spot they defend/support. Regime-pivot nodes (gamma flip, max pain, the
 * gamma magnet) are NOT hard support/resistance — they are narrated elsewhere as a regime boundary,
 * a pin statistic, and a "pull toward" node respectively (play-brief-narrative.ts's own
 * narrateKing/narrateMagnet), never as a wall a price bounces off — so they read "neutral" here
 * rather than being forced into a support/resistance label they don't structurally earn.
 */
function roleForKind(kind: StructureLadderRungKind, price: number, spot: number): StructureLadderRungRole {
  if (kind === "gamma_flip" || kind === "max_pain" || kind === "magnet") return "neutral";
  return price > spot ? "resistance" : "support";
}

function crossDeskAgreementFor(
  vec: VectorFullState | null,
  gex: GexPositioning | null | undefined,
  spot: number,
  vectorStale: boolean,
  gexStale: boolean,
): StructureLadderAgreement | undefined {
  // Raw Vector read — deliberately NOT `resolveGammaPosture` (play-brief-absence.ts), which falls
  // through to this SAME GEX matrix when Vector has nothing to say. Using that resolved value here
  // would compare the matrix against itself on every ordinary "Vector unknown" read and silently
  // report "aligned" for a comparison that never actually happened.
  const vecPosture = vectorStale ? null : (vec?.regime?.posture ?? null);
  if (vecPosture == null || vecPosture === "unknown") return undefined;

  if (gexStale || gex?.flip == null || !Number.isFinite(gex.flip)) return undefined;
  const matrixImplied: "long" | "short" | null =
    spot > gex.flip ? "long" : spot < gex.flip ? "short" : null;
  if (matrixImplied == null) return undefined; // spot exactly on the flip — no independent implied side

  if (vecPosture === matrixImplied) return { status: "aligned" };

  return {
    status: "disagreement",
    note:
      // fmtPriceLevel (not raw .toFixed(2)) — same rounding-consistency requirement as every other
      // bare price level narrated in this brief (see fmt-money.ts's own header): this text sits
      // alongside `envelope.structureLadder.spot`/rung prices, both derived from these SAME raw
      // `spot`/`gex.flip` floats but rounded via `roundFloats` at the route boundary, which can
      // disagree with `n.toFixed(2)` by a full cent at an IEEE-754 half-cent boundary.
      `Vector reads **${vecPosture} gamma** while the GEX matrix's flip (**${fmtPriceLevel(gex.flip)}**) vs ` +
      `spot (**${fmtPriceLevel(spot)}**) implies **${matrixImplied} gamma** — the two dealer-positioning ` +
      `reads disagree on regime.`,
  };
}

function trackRecordFor(
  play: TerminalPlay,
  snapshot: SwingArchetypeTrackRecordSnapshot | null | undefined,
): StructureLadderArchetypeTrackRecord | undefined {
  const archetype = (SWING_ARCHETYPES as readonly string[]).includes(play.archetype ?? "")
    ? (play.archetype as (typeof SWING_ARCHETYPES)[number])
    : null;
  const entry = graduatedArchetypeEntry(snapshot, archetype);
  if (!entry || !archetype) return undefined;
  return {
    archetypeLabel: ARCHETYPE_META[archetype].label,
    winRatePct: entry.winRatePct,
    wilsonLbPct: entry.wilsonLbPct,
    n: entry.n,
  };
}

/**
 * Compose the Structure Ladder for the current play state. Returns `null` when there is nothing
 * honest to build (CLOSED bucket — point 6; no live spot; no structural nodes at all).
 *
 * DELIBERATELY NO "moonshot"/far-dated tier (contrast with the competitor panel this widget was
 * built to beat): far-dated wall data exists only inside the Thermal Heatmap's own matrix, never
 * read by the swing brief, with no VEX/king-strike derivation at that horizon — inventing a
 * placeholder "weak, 18-months-out" node the way the competitor does would be exactly the
 * fabrication the Largo product contract's absence principle forbids. Real support for a genuine
 * far-dated tier needs new plumbing to read the Thermal matrix's far-expiry columns from the swing
 * brief — a real, scoped phase-2 item, not attempted in this pass (see the PR description).
 * TODO(phase-2, structure-ladder-far-dated-tier): wire a Thermal-matrix far-expiry read here once
 * that plumbing exists, gated the same absence-honest way as every other rung above.
 */
export function buildStructureLadder(
  ctx: SwingPlayBriefContext,
  play: TerminalPlay,
  bucket: "watch" | "open" | "closed",
): StructureLadder | null {
  if (bucket === "closed") return null;

  // Ask Largo standing mandate, readMs-anchor sweep follow-up to #5351: ctx is a required param
  // here — prefer its stamped readMs over a fresh wall-clock sample.
  const readMs = ctx.readMs ?? Date.now();
  const vec = ctx.vector ?? ctx.ecosystem?.vector_full_state ?? null;
  const gex = ctx.ecosystem?.gex_positioning ?? null;
  const { spot } = preferredGexWalls(ctx);
  if (spot == null || !Number.isFinite(spot) || spot <= 0) return null;

  const focal: FocalLevel[] = collectFocalLevels(ctx, spot);
  if (!focal.length) return null;

  // Real per-level R:R (not a fixed multiple) — see `StructureLadderTarget`'s own header for why
  // this is evaluated live at spot rather than reading back a frozen per-position value.
  const plan = deriveSwingPlanLevels(play.direction as PlayDirection, spot, null);
  if (!plan) return null; // unreachable given the spot>0 guard above, kept for type-safety/defense

  // Distance a favorable rung sits from spot, on the SAME |price - spot| basis distancePct is
  // signed from — used only to order favorable rungs near->far for the gatekeeper pass below.
  const favorableGap = (f: FocalLevel) => Math.abs(f.price - spot);

  // The FARTHEST favorable rung (if any) is never a gatekeeper — nothing on this ladder sits
  // beyond it for clearing it to open up. Every closer favorable rung IS one: clearing it is what
  // exposes the next rung out, exactly the "clearing it opens the next level up" read the
  // competitor panel's ladder makes explicit per-rung rather than leaving implicit in a sorted list.
  const farthestFavorablePrice = focal
    .filter((f) => (play.direction === "LONG" ? f.price > spot : f.price < spot))
    .reduce<{ price: number; gap: number } | null>(
      (far, f) => (far == null || favorableGap(f) > far.gap ? { price: f.price, gap: favorableGap(f) } : far),
      null,
    );

  const rungs: StructureLadderRung[] = focal
    .map((f): StructureLadderRung => {
      const role = roleForKind(f.kind, f.price, spot);
      const favorable = play.direction === "LONG" ? f.price > spot : f.price < spot;
      const target: StructureLadderTarget | undefined = favorable
        ? {
            rewardRisk:
              Math.abs(f.price - plan.entryUnderlyingPx) / Math.abs(plan.entryUnderlyingPx - plan.thesisInvalidationPx),
            horizon: Math.abs(f.price - spot) <= 2 * plan.atr ? "short_term" : "swing",
            gatekeeper: farthestFavorablePrice != null && f.price !== farthestFavorablePrice.price,
          }
        : undefined;
      return {
        kind: f.kind,
        label: f.label,
        price: f.price,
        distancePct: f.distancePct,
        role,
        ...(f.meta ? { meta: f.meta } : {}),
        ...(target ? { target } : {}),
      };
    })
    // Sort high → low (point 1 + the ladder convention every other price ladder in this codebase uses).
    .sort((a, b) => b.price - a.price);

  // Nearest real rung WITHOUT a target — i.e. on the unfavorable side, the side price would have
  // to move through for this thesis to break, not toward. A direct reference into `rungs` above
  // (never a second, independently-derived level), so it can never disagree with the ladder it
  // summarizes. Omitted when every rung on this ladder happens to sit on the favorable side.
  //
  // BUG FIX (2026-09-15, Ask Largo standing mandate, live repro AAPL/CG/ENPH/PEGA): the reduce
  // below used to run over EVERY unfavorable-side rung with no regard to `role`, so a `"neutral"`
  // pivot (gamma_flip/max_pain/magnet) could win over a genuine support/resistance wall whenever
  // the pivot happened to sit nearer — directly contradicting `roleForKind`'s own documented
  // stance two paragraphs up: gamma flip/max pain/the gamma magnet "are NOT hard support/
  // resistance ... never as a wall a price bounces off." The member-facing widget
  // (`BieStructureLadder.tsx`) renders whatever wins here as "the **nearest real structure** on
  // the wrong side of this thesis" — calling a neutral pivot "real structure" contradicts this
  // file's own design, and on PEGA it hid the real put wall by 13 points (magnet -8.3% shown vs.
  // put wall -21.4% actual). Prefer a genuine support/resistance rung; only fall back to the
  // nearest neutral pivot when no real wall exists on the unfavorable side at all (unchanged for
  // that case — GLXY's real "no wall, just the magnet" read still resolves the same way today).
  const unfavorableRungs = rungs.filter((r) => !r.target);
  const unfavorableRealWalls = unfavorableRungs.filter((r) => r.role !== "neutral");
  const riskTheOtherSide = (unfavorableRealWalls.length > 0 ? unfavorableRealWalls : unfavorableRungs).reduce<
    StructureLadderRung | null
  >((nearest, r) => (nearest == null || Math.abs(r.distancePct) < Math.abs(nearest.distancePct) ? r : nearest), null);

  const vectorStale = vectorSnapshotStale(vec, readMs, ctx.sessionDate);
  const gexStale = gexMatrixStale(gex, readMs);
  const crossDeskAgreement = crossDeskAgreementFor(vec, gex, spot, vectorStale, gexStale);
  const archetypeTrackRecord = trackRecordFor(play, ctx.archetypeTrackRecord);

  return {
    spot,
    direction: play.direction,
    stop: plan.thesisInvalidationPx,
    atr: plan.atr,
    // "closed" already returned above; only "watch"/"open" reach here.
    positionState: bucket,
    rungs,
    ...(crossDeskAgreement ? { crossDeskAgreement } : {}),
    ...(archetypeTrackRecord ? { archetypeTrackRecord } : {}),
    ...(riskTheOtherSide
      ? {
          riskTheOtherSide: {
            kind: riskTheOtherSide.kind,
            label: riskTheOtherSide.label,
            price: riskTheOtherSide.price,
            distancePct: riskTheOtherSide.distancePct,
            role: riskTheOtherSide.role,
          },
        }
      : {}),
    // etStamp(readMs) cannot return null for a real Date.now() instant — the fallback only guards
    // against a future refactor that feeds this something else, never silently reverting to a bare
    // ISO instant with no ET anchor.
    asOf: etStamp(readMs) ?? new Date(readMs).toISOString(),
  };
}
