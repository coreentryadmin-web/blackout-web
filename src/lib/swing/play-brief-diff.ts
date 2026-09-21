/**
 * Swing play brief — "what changed" diff engine.
 * Pure, deterministic: compares successive brief snapshots on refresh.
 */
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { thesisHealthUncalibrated } from "./thesis-health";
import { roundFloats } from "@/lib/round-floats";
import { fmtPriceLevel } from "@/lib/fmt-money";

export type BriefSnapshot = {
  headline: string;
  recommendation: string | null;
  /** LONG/SHORT — used both to tell an "adverse" spot move (toward the put wall for a LONG,
   *  toward the call wall for a SHORT) from a favorable one, AND diffed directly below.
   *  BUG FIXED 2026-09-18 (Ask Largo round 20): this field used to be documented "not itself
   *  diffed (a play's direction doesn't change mid-life)" — true for a COMMITTED position (once
   *  committed, direction is locked to the position, per commit.ts), but false for a WATCH
   *  candidate: `TerminalPlay.id` for an uncommitted row is `${horizon}:${ticker}` with no
   *  positionId suffix (adapters.ts ~line 983 — positionId is only appended `if (src.positionId
   *  != null)`), so the SAME play.id persists across discovery cycles while `src.direction`
   *  (freshly derived from that cycle's net flow read) can genuinely flip — a ticker's
   *  accumulated flow can turn from net-bullish to net-bearish (or vice versa) session to
   *  session before it is ever committed. `diffBriefSnapshots` is keyed by that stable play.id
   *  (see useSwingPlayBrief.ts's `prevSnapRef`/`briefSnapshotStorageKey`), so a real directional
   *  reversal on a WATCH ticker was silently un-narrated by "What changed" even though it is the
   *  single most material fact possible — every other diffed field (thesis health, spot, walls)
   *  is only meaningful relative to a direction that the diff engine was assuming was constant. */
  direction: TerminalPlay["direction"] | null;
  thesisHealth: number | null;
  pnlPct: number | null;
  mark: number | null;
  spot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  flowCallPremium: number | null;
  flowPutPremium: number | null;
  trimsFired: number | null;
  /**
   * `play.rollCandidate`'s reason string when the manage engine is CURRENTLY weighing a roll
   * (theta outpacing thesis inside the migration-DTE window — the same per-tick check
   * `roll.ts`'s live executor runs before it actually rolls). Null when no roll is being
   * weighed this tick. GAP FOUND (Ask Largo standing mandate, 2026-09-18): `play-brief.ts`'s
   * Management section already renders this as a static "Roll watch" line every refresh once
   * present (#5163), but the diff engine — whose entire job is to narrate what changed since
   * the LAST refresh — never looked at it, so a position crossing INTO roll-candidate territory
   * (arguably the most actionable trade-manager fact there is: "the system is now weighing
   * rolling this position") produced no "What changed" callout at all, silently identical to a
   * refresh where nothing happened. A member watching the static section alone would only
   * notice a roll watch by re-reading the whole Management block on every poll, not by the
   * "Since last read" pulse this diff engine exists to spare them from having to do.
   */
  rollCandidateReason: string | null;
  sectionTitles: string[];
};

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Strip the trailing "<N>DTE" token `playContractHeadline` bakes into every non-WATCH headline
 * (e.g. "TRIM — CRWD 235C 7DTE" -> "TRIM — CRWD 235C") so a headline comparison can tell "the
 * setup actually changed" from "one calendar day passed and the DTE counter ticked down" — the
 * one component of the headline that changes on its own, every session day, with nothing else
 * moving. See the "Verdict headline updated" call site's own comment for the bug this fixes.
 */
function stripDteFromHeadline(headline: string): string {
  return headline.replace(/\s+\d+DTE\b/, "").trim();
}

function fmtDelta(prev: number, next: number, suffix = ""): string {
  const d = next - prev;
  const sign = d > 0 ? "+" : "";
  return `${prev}${suffix} → ${next}${suffix} (${sign}${d.toFixed(1)}${suffix})`;
}

function narrateThesisShift(prev: number, next: number): string {
  const d = next - prev;
  const verb = d < 0 ? "fading" : "improving";
  return `**Thesis ${verb}** — health moved **${d >= 0 ? "+" : ""}${d.toFixed(0)} pts** to **${next}%**`;
}

function narratePnlShift(prev: number, next: number): string {
  const d = next - prev;
  const tone = d >= 0 ? "building" : "slipping";
  return `**P&L ${tone}** — **${fmtDelta(prev, next, "%")}** since last refresh`;
}

function narrateSpotShift(prev: number, next: number): string {
  const d = next - prev;
  const dir = d > 0 ? "higher" : "lower";
  return `**Spot drifted ${dir}** — **$${fmtPriceLevel(next)}** (${d >= 0 ? "+" : ""}${d.toFixed(2)} vs prior read)`;
}

function narrateMarkShift(prev: number, next: number): string {
  const d = next - prev;
  const tone = d >= 0 ? "built" : "slipped";
  return `**Option mark ${tone}** — $${fmtPriceLevel(prev)} → $${fmtPriceLevel(next)} (${d >= 0 ? "+" : ""}${d.toFixed(2)})`;
}

/** A structural GEX level (call wall/put wall/gamma flip) moving is a distinct fact from spot
 *  moving — dealers' own hedging structure shifted, not just price. Framed as room-to-spot
 *  compressing/receding (using each snapshot's OWN contemporaneous spot, so the read is honest
 *  about whether the wall moving actually changed the cushion, not just that a number changed)
 *  rather than a bare "$X → $Y" a reader has to interpret themselves. Deliberately does NOT judge
 *  favorable/adverse by direction here (unlike `adverseSpotDrift`, which already owns that
 *  judgment for spot itself moving toward a wall) — a wall's own drift affects both a LONG and a
 *  SHORT reading the same level, so "less/more room before it matters" is the honest, direction-
 *  neutral fact; falls back to the plain delta when spot is unavailable on either side, or when
 *  spot moved together with the level and left the room itself unchanged. */
function narrateStructuralLevelShift(
  label: string,
  prev: number,
  next: number,
  prevSpot: number | null,
  nextSpot: number | null,
): string {
  const plain = `${label} moved ${fmtDelta(prev, next)}`;
  if (prevSpot == null || nextSpot == null) return plain;
  const prevRoom = Math.abs(prev - prevSpot);
  const nextRoom = Math.abs(next - nextSpot);
  if (Math.abs(nextRoom - prevRoom) < 0.05) return plain;
  const compressing = nextRoom < prevRoom;
  const verb = compressing ? "closing in" : "receding";
  const readout = compressing ? "less room before it matters" : "more room before it matters";
  return `**${label} ${verb}** — $${fmtPriceLevel(prev)} → $${fmtPriceLevel(next)}, now $${fmtPriceLevel(nextRoom)} away (was $${fmtPriceLevel(prevRoom)}) — ${readout}`;
}

/** BUY > HOLD > TRIM > SELL — matches the ACTION vocabulary `swingActionDisplay` renders
 *  (play-card-lifecycle.ts): SELL surfaces as "EXIT", the most defensive action. Used only to
 *  classify a recommendation change as an upgrade/downgrade for cross-field synthesis below —
 *  never for anything that reaches the UI as a raw number. */
const RECOMMENDATION_RANK: Record<string, number> = { BUY: 3, HOLD: 2, TRIM: 1, SELL: 0 };

function recommendationShiftKind(
  prev: string | null,
  next: string | null,
): "upgrade" | "downgrade" | null {
  if (!prev || !next) return null;
  const p = RECOMMENDATION_RANK[prev];
  const n = RECOMMENDATION_RANK[next];
  if (p == null || n == null || p === n) return null;
  return n > p ? "upgrade" : "downgrade";
}

/** An "adverse" spot move — toward the put wall on a LONG, toward the call wall on a SHORT —
 *  is the one co-occurrence with a fading thesis that actually explains a downgrade; a spot
 *  move in the play's FAVOR alongside a fading thesis is two facts pulling in different
 *  directions and must NOT be narrated as connected (see the "independent shifts" test). Also
 *  flags a same-direction gamma-flip crossing, since "drifted through the gamma flip toward the
 *  put wall" is a materially different (more urgent) read than "drifted toward the put wall"
 *  alone. Returns null — never a guess — when direction is unknown or no level exists on the
 *  adverse side, so the caller falls back to the plain independent spot bullet. */
function adverseSpotDrift(
  prev: BriefSnapshot,
  next: BriefSnapshot,
): { label: string; level: number; throughFlip: boolean } | null {
  if (prev.spot == null || next.spot == null || Math.abs(next.spot - prev.spot) < 0.01) return null;
  if (next.direction !== "LONG" && next.direction !== "SHORT") return null;

  const movedDown = next.spot < prev.spot;
  const adverse = next.direction === "LONG" ? movedDown : !movedDown;
  if (!adverse) return null;

  const level = next.direction === "LONG" ? next.putWall : next.callWall;
  const label = next.direction === "LONG" ? "put wall" : "call wall";
  if (level == null) return null;

  const flip = next.gammaFlip;
  const throughFlip =
    flip != null &&
    (next.direction === "LONG" ? prev.spot >= flip && next.spot < flip : prev.spot <= flip && next.spot > flip);

  return { label, level, throughFlip };
}

/** Rule 1 of the cross-field synthesis: a fading thesis AND an adverse spot drift, read as one
 *  causal line — optionally naming the desk downgrade the combination produced — rather than two
 *  bullets a reader has to connect themselves. Composes the existing `narrateThesisShift`/
 *  `narrateSpotShift` fact strings (never reimplements their math) per the standing "narrative,
 *  not bullet-dump" mandate already shipped for the static brief in play-brief-narrative.ts. */
function synthesizeThesisAndPrice(
  prev: BriefSnapshot,
  next: BriefSnapshot,
  adverse: { label: string; level: number; throughFlip: boolean },
  downgradeTo: string | null,
): string {
  const thesisFact = narrateThesisShift(prev.thesisHealth!, next.thesisHealth!);
  const spotFact = narrateSpotShift(prev.spot!, next.spot!);
  const route = adverse.throughFlip
    ? `through the gamma flip toward the **${adverse.label}** ($${fmtPriceLevel(adverse.level)})`
    : `toward the **${adverse.label}** ($${fmtPriceLevel(adverse.level)})`;
  const downgradeClause = downgradeTo
    ? ` — that combination is why the desk downgraded to **${downgradeTo}**`
    : "";
  return `${thesisFact}, and ${spotFact} ${route}${downgradeClause}`;
}

/** Rule 2 of the cross-field synthesis: P&L building AND a desk upgrade, read as one line —
 *  the two facts tracking together is the point, not two adjacent unconnected bullets. */
function synthesizePnlAndUpgrade(prev: BriefSnapshot, next: BriefSnapshot): string {
  const pnlFact = narratePnlShift(prev.pnlPct!, next.pnlPct!);
  return `${pnlFact}, and the **desk upgraded** — **${prev.recommendation}** → **${next.recommendation}** — tracking together`;
}

/**
 * Derive the diff engine's raw inputs from a play-brief API response.
 *
 * spot/gammaFlip/callWall/putWall come from `envelope.levels` by label — those are
 * `BieLevel` price levels the envelope already carries for chart annotation, so re-deriving
 * them here (rather than duplicating the field) keeps one source of truth. HELIX flow premiums
 * are NOT price levels (a `BieLevel.price` means "a level on the chart"; a premium total is a
 * dollar sum), so they ride the response's own explicit `flowSnapshot` field instead of being
 * shoehorned into `levels` or string-matched out of rendered text.
 */
export function extrasFromBriefResponse(response: {
  envelope?: BieAnswerEnvelope;
  flowSnapshot?: { callPremium: number | null; putPremium: number | null } | null;
  trimsFired?: number | null;
}) {
  const levels = response.envelope?.levels ?? [];
  const price = (substr: string) =>
    levels.find((l) => l.label.toLowerCase().includes(substr))?.price ?? null;
  return {
    spot: price("spot"),
    gammaFlip: price("gamma flip"),
    callWall: price("call wall"),
    putWall: price("put wall"),
    flowCallPremium: response.flowSnapshot?.callPremium ?? null,
    flowPutPremium: response.flowSnapshot?.putPremium ?? null,
    trimsFired: response.trimsFired ?? null,
  };
}

/** Build a comparable snapshot from API response + live play overlay. */
export function snapshotFromBrief(
  envelope: BieAnswerEnvelope,
  play: TerminalPlay | null,
  extras?: {
    spot?: number | null;
    gammaFlip?: number | null;
    callWall?: number | null;
    putWall?: number | null;
    flowCallPremium?: number | null;
    flowPutPremium?: number | null;
    trimsFired?: number | null;
  },
): BriefSnapshot {
  return {
    headline: envelope.headline,
    recommendation: play?.recommendation ?? null,
    direction: play?.direction ?? null,
    thesisHealth:
      play?.thesisHealth && !thesisHealthUncalibrated(play.thesisHealth)
        ? fin(play.thesisHealth.health)
        : null,
    pnlPct: fin(play?.pnlPct),
    mark: fin(play?.mark),
    spot: fin(extras?.spot),
    gammaFlip: fin(extras?.gammaFlip),
    callWall: fin(extras?.callWall),
    putWall: fin(extras?.putWall),
    flowCallPremium: fin(extras?.flowCallPremium),
    flowPutPremium: fin(extras?.flowPutPremium),
    trimsFired: fin(extras?.trimsFired),
    rollCandidateReason: play?.rollCandidate?.reason ?? null,
    sectionTitles: envelope.sections.map((s) => s.title),
  };
}

/** Return human-readable change lines; empty when first load or no material delta. */
export function diffBriefSnapshots(prev: BriefSnapshot | null, next: BriefSnapshot): string[] {
  if (!prev) return [];
  const lines: string[] = [];

  // A direction flip invalidates the meaning of every other diffed field (a "spot drifted lower"
  // line reads as bearish news for a LONG and bullish news for a SHORT) — checked and narrated
  // FIRST, ahead of every other rule below, and never suppressed by a synthesis rule the way
  // recommendation/thesis/pnl can be, since it is not consumed by any of them. Only fires when
  // both sides have a real direction (a null on either side means one snapshot predates direction
  // being wired, not a real flip).
  const directionChanged = !!prev.direction && !!next.direction && prev.direction !== next.direction;
  if (directionChanged) {
    lines.push(`**Direction flipped** — ${prev.direction} → **${next.direction}** (net flow reversed)`);
  }

  // ---- raw facts (unchanged thresholds — same gates as before synthesis existed) ----
  const recommendationChanged =
    !!prev.recommendation && !!next.recommendation && prev.recommendation !== next.recommendation;
  const thesisMoved =
    prev.thesisHealth != null &&
    next.thesisHealth != null &&
    prev.thesisHealth !== next.thesisHealth &&
    Math.abs(prev.thesisHealth - next.thesisHealth) >= 3;
  const thesisFading = thesisMoved && next.thesisHealth! < prev.thesisHealth!;
  const pnlMoved = prev.pnlPct != null && next.pnlPct != null && Math.abs(prev.pnlPct - next.pnlPct) >= 0.5;
  const pnlBuilding = pnlMoved && next.pnlPct! > prev.pnlPct!;
  const spotMoved = prev.spot != null && next.spot != null && Math.abs(prev.spot - next.spot) >= 0.01;

  // ---- cross-field synthesis: connect CO-OCCURRING shifts into one causal read instead of
  // disconnected bullets (Ask Largo mandate — "narrating the live 'what changed' diff the same
  // trade-manager way instead of numeric deltas"). Each rule only fires when the shifts actually
  // plausibly relate; anything it doesn't consume falls through to the independent bullets below
  // exactly as before, so an unrelated pair of shifts never gets a forced causal link.
  let thesisConsumed = false;
  let spotConsumed = false;
  let recommendationConsumed = false;
  let pnlConsumed = false;

  if (thesisFading && spotMoved) {
    const adverse = adverseSpotDrift(prev, next);
    if (adverse) {
      const shift = recommendationChanged ? recommendationShiftKind(prev.recommendation, next.recommendation) : null;
      const downgradeTo = shift === "downgrade" ? next.recommendation : null;
      lines.push(synthesizeThesisAndPrice(prev, next, adverse, downgradeTo));
      thesisConsumed = true;
      spotConsumed = true;
      if (downgradeTo) recommendationConsumed = true;
    }
  }

  if (!recommendationConsumed && pnlBuilding && recommendationChanged) {
    if (recommendationShiftKind(prev.recommendation, next.recommendation) === "upgrade") {
      lines.push(synthesizePnlAndUpgrade(prev, next));
      pnlConsumed = true;
      recommendationConsumed = true;
    }
  }

  // ---- independent bullets — same content/order as before synthesis existed, skipping only
  // what a synthesis rule above already narrated as part of a connected line. ----
  if (!recommendationConsumed && recommendationChanged) {
    lines.push(`**Desk action shifted** — **${prev.recommendation}** → **${next.recommendation}**`);
  }
  if (!thesisConsumed && thesisMoved) {
    lines.push(narrateThesisShift(prev.thesisHealth!, next.thesisHealth!));
  }
  if (!pnlConsumed && pnlMoved) {
    lines.push(narratePnlShift(prev.pnlPct!, next.pnlPct!));
  }
  if (prev.mark != null && next.mark != null && Math.abs(prev.mark - next.mark) >= 0.05) {
    lines.push(narrateMarkShift(prev.mark, next.mark));
  }
  if (!spotConsumed && spotMoved) {
    lines.push(narrateSpotShift(prev.spot!, next.spot!));
  }
  if (prev.gammaFlip != null && next.gammaFlip != null && Math.abs(prev.gammaFlip - next.gammaFlip) >= 0.05) {
    lines.push(narrateStructuralLevelShift("Gamma flip", prev.gammaFlip, next.gammaFlip, prev.spot, next.spot));
  }
  if (prev.callWall != null && next.callWall != null && Math.abs(prev.callWall - next.callWall) >= 0.05) {
    lines.push(narrateStructuralLevelShift("Call wall", prev.callWall, next.callWall, prev.spot, next.spot));
  }
  if (prev.putWall != null && next.putWall != null && Math.abs(prev.putWall - next.putWall) >= 0.05) {
    lines.push(narrateStructuralLevelShift("Put wall", prev.putWall, next.putWall, prev.spot, next.spot));
  }
  const callMoved =
    prev.flowCallPremium != null &&
    next.flowCallPremium != null &&
    Math.abs(next.flowCallPremium - prev.flowCallPremium) > 50_000;
  const putMoved =
    prev.flowPutPremium != null &&
    next.flowPutPremium != null &&
    Math.abs(next.flowPutPremium - prev.flowPutPremium) > 50_000;
  if (callMoved && next.flowCallPremium! > prev.flowCallPremium! * 1.2) {
    lines.push("HELIX tape: call flow building");
  } else if (putMoved && next.flowPutPremium! > (prev.flowPutPremium ?? 0) * 1.2) {
    lines.push("HELIX tape: put flow building");
  } else if (callMoved || putMoved) {
    lines.push("HELIX tape: flow shifted");
  }
  if (
    prev.trimsFired != null &&
    next.trimsFired != null &&
    next.trimsFired > prev.trimsFired
  ) {
    lines.push(`Trim rail **banked** (${prev.trimsFired} → ${next.trimsFired} fired)`);
  }
  // Roll-candidate transitions (see BriefSnapshot.rollCandidateReason's own doc comment for the
  // gap this closes). Only the two EDGE crossings are narrated — a candidate reason simply
  // reading differently tick-to-tick (the same underlying watch, restated) is not a new fact
  // worth a "What changed" line, only "a roll wasn't being weighed and now is" or the reverse.
  if (!prev.rollCandidateReason && next.rollCandidateReason) {
    lines.push(`**Roll watch triggered** — theta outpacing thesis — ${next.rollCandidateReason}.`);
  } else if (prev.rollCandidateReason && !next.rollCandidateReason) {
    // Deliberately does NOT assert "theta/thesis balance back in range" — detectRollCandidate()
    // (manage.ts) returns roll:false for THREE distinct causes: back in range, thesis broken, or
    // the structural stop hit. The latter two are the capital-preservation gates, where a roll
    // clears because the position is being CLOSED, not because anything improved — and the
    // separate "Desk action shifted" rule above already narrates that exit accurately in the same
    // pulse. Asserting a specific cause here would contradict it. Peer review, PR #5191.
    lines.push(`**Roll watch cleared** — no longer being weighed.`);
  }
  // BUG FIX (Ask Largo standing mandate, 2026-09-18): the raw headline is
  // `${action?.label ?? play.recommendation ?? play.status} — ${playContractHeadline(play)}`
  // (play-brief.ts), and `playContractHeadline` bakes in the contract's own DTE, e.g.
  // "TRIM — CRWD 235C 7DTE" (adapters.ts stamps `${strike}${right} ${dte}DTE` straight into
  // `play.contract`). DTE decrements every session day on its own, with no other field moving —
  // so on a quiet refresh across a day rollover this bare `prev.headline !== next.headline`
  // check fired unconditionally, and the ONLY thing "What changed"/the narrative pulse had to
  // show was the content-free line "Verdict headline updated": no old value, no new value, no
  // reason. That is the exact same shape as the restatement-without-substance bugs already fixed
  // today elsewhere in this lane (a line that fires but tells the reader nothing they didn't
  // already know) — worse here, because unlike those it can be the ONLY line in the whole pulse,
  // i.e. the member sees "something changed" with zero information on what. Every other rule in
  // this function names the concrete before/after; this was the one exception. Fixed by
  // normalizing away the DTE segment before comparing — a pure day-rollover no longer fires this
  // line at all (the "Hold plan" section already surfaces live DTE continuously, so restating
  // "the DTE changed" here would itself be a second restatement, not new information); a headline
  // change from any OTHER cause (a roll changing strike, an action-label shift not already
  // captured by `recommendationChanged` above) still fires, since those genuinely are new facts.
  if (stripDteFromHeadline(prev.headline) !== stripDteFromHeadline(next.headline)) {
    lines.push(`Verdict headline updated`);
  }

  const newSections = next.sectionTitles.filter((t) => !prev.sectionTitles.includes(t));
  if (newSections.length) {
    lines.push(`New sections: ${newSections.join(", ")}`);
  }

  // GAP FOUND (Ask Largo standing mandate, 2026-09-20): `composeSwingPlayBrief` (play-brief.ts)
  // conditionally `sections.push(...)`s many intel sections only when the underlying data is
  // present — "Book context" only when `checkPortfolioOverlap` finds real theme/direction
  // concentration, "Cortex read" only when a cortex blob is pinned, "Catalysts & news"/"Meridian
  // catalysts" only when a catalyst read exists, "GEX posture"/"Wall dynamics" only when the
  // matrix is fresh, etc. (`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle — omitted
  // when a product genuinely has nothing to show, never padded). That means a section can
  // genuinely DISAPPEAR between two refreshes of the same play (the portfolio overlap clears, a
  // Cortex source starts timing out, a catalyst read goes stale and gets dropped) — a materially
  // informative fact for a member watching the "What changed" pulse. Until this fix, only ADDED
  // sections were ever narrated (`newSections` above); a section vanishing was silently identical
  // to a refresh where nothing changed at all, the exact same "misleading no-op" shape already
  // fixed elsewhere in this file for the roll-candidate and headline-DTE cases. Symmetric with the
  // addition case: a plain named list, no fabricated reason for WHY it left (the same reasons a
  // wall's own drift is reported direction-neutral in `narrateStructuralLevelShift` — naming the
  // fact honestly beats guessing a cause this diff engine cannot see).
  const removedSections = prev.sectionTitles.filter((t) => !next.sectionTitles.includes(t));
  if (removedSections.length) {
    lines.push(`No longer showing: ${removedSections.join(", ")}`);
  }

  return lines.slice(0, 8);
}

/**
 * Stable content key for SSE dedupe — excludes time-only fields.
 *
 * BUG FIXED 2026-09-11 (Ask Largo standing mandate, raw-float check): this used to
 * `JSON.stringify` the raw `BriefSnapshot` numbers directly, e.g. `pnlPct: -56.18644067796611`
 * for a real AAPL closed play. The API route (`route.ts`) wraps its whole response in
 * `roundFloats({ available: true, ...brief })` specifically to round every float before it
 * reaches a client — but `roundFloats` walks objects/arrays/numbers and treats a string as an
 * opaque leaf, and by the time `roundFloats` runs, `briefContentKey` is ALREADY a JSON string
 * (built here, at compose time, before the route ever sees it). So the raw, unrounded floats
 * baked into that string sailed straight through the route's own rounding pass untouched — the
 * exact "systemic: several endpoints serve unrounded floats" class this repo's CLAUDE.md already
 * names, just hiding one layer deeper than a top-level numeric field. `briefContentKey` is an
 * internal SSE-dedupe/diff-baseline key (see `useSwingPlayBrief.ts`), never rendered to a member
 * or read by Largo chat, so the blast radius was contained — but it's still real, unrounded data
 * leaving the API surface, and a full-precision float in a "stable key" is also fragile: two
 * refreshes computing the same logical P&L through a different floating-point path (e.g. a
 * blended-vs-plain P&L branch) could now produce different keys over noise in the 10th decimal
 * place, causing a spurious "content changed" SSE push. Rounding here — to the same 2dp the route
 * already applies to everything else — fixes both: no raw float leaves the API, and the key is
 * stable to the precision a trader actually reads.
 */
export function briefContentKey(snap: BriefSnapshot): string {
  return JSON.stringify(
    roundFloats({
      headline: snap.headline,
      recommendation: snap.recommendation,
      thesisHealth: snap.thesisHealth,
      pnlPct: snap.pnlPct,
      mark: snap.mark,
      spot: snap.spot,
      gammaFlip: snap.gammaFlip,
      callWall: snap.callWall,
      putWall: snap.putWall,
      trimsFired: snap.trimsFired,
      sectionTitles: snap.sectionTitles,
    }),
  );
}

/** Inject live refresh pulse into Trade manager read; overflow goes to What changed. */
export function envelopeWithNarrativePulse(
  envelope: BieAnswerEnvelope,
  changes: string[],
): BieAnswerEnvelope {
  if (!changes.length) return envelope;

  const narrativeIdx = envelope.sections.findIndex((s) => s.title === "Trade manager read");
  if (narrativeIdx < 0) return envelopeWithDiffSection(envelope, changes);

  const pulseLines = changes.slice(0, 3).map((c) => `• **Since last read** — ${c}`);
  const overflow = changes.slice(3);

  const sections = [...envelope.sections];
  const narrative = sections[narrativeIdx]!;
  const alreadyHasPulse = narrative.body.includes("Since last read");
  sections[narrativeIdx] = {
    ...narrative,
    body: alreadyHasPulse
      ? narrative.body
      : `${pulseLines.join("\n")}\n${narrative.body}`,
  };

  const base = { ...envelope, sections };
  return overflow.length ? envelopeWithDiffSection(base, overflow) : base;
}

/** Inject a "What changed" section at the top of an envelope when deltas exist. */
export function envelopeWithDiffSection(
  envelope: BieAnswerEnvelope,
  changes: string[],
): BieAnswerEnvelope {
  if (!changes.length) return envelope;
  if (envelope.sections.some((s) => s.title === "What changed")) return envelope;
  return {
    ...envelope,
    sections: [
      {
        title: "What changed",
        body: changes.map((c) => `• ${c}`).join("\n"),
        bias: "neutral",
      },
      ...envelope.sections,
    ],
  };
}

const BRIEF_SNAP_STORAGE_PREFIX = "swing-brief-snap:";

/** Session-scoped key for persisting brief diff baselines across remounts. */
export function briefSnapshotStorageKey(
  playId: string,
  sessionDate: string | null | undefined,
): string | null {
  if (!playId || !sessionDate) return null;
  return `${BRIEF_SNAP_STORAGE_PREFIX}${playId}:${sessionDate}`;
}

export function loadPersistedBriefSnapshot(key: string): BriefSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BriefSnapshot;
    // `sectionTitles` is read unconditionally by diffBriefSnapshots (`prev.sectionTitles.includes`)
    // with no null guard, unlike every other field here. sessionStorage outlives a deploy — a
    // snapshot written by an older schema, or corrupted by devtools/an extension, must be rejected
    // as unusable rather than handed back and crashing the diff on the next read.
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.headline !== "string" ||
      !Array.isArray(parsed.sectionTitles)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function persistBriefSnapshot(key: string, snap: BriefSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(snap));
  } catch {
    /* quota / private mode — diff still works in-memory */
  }
}
