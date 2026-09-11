/**
 * Swing play brief — "what changed" diff engine.
 * Pure, deterministic: compares successive brief snapshots on refresh.
 */
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { thesisHealthUncalibrated } from "./thesis-health";
import { roundFloats } from "@/lib/round-floats";

export type BriefSnapshot = {
  headline: string;
  recommendation: string | null;
  /** LONG/SHORT — carried through only so the diff engine can tell an "adverse" spot move
   *  (toward the put wall for a LONG, toward the call wall for a SHORT) from a favorable one.
   *  Not itself diffed (a play's direction doesn't change mid-life). */
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
  sectionTitles: string[];
};

function fin(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
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
  return `**Spot drifted ${dir}** — **$${next.toFixed(2)}** (${d >= 0 ? "+" : ""}${d.toFixed(2)} vs prior read)`;
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
    ? `through the gamma flip toward the **${adverse.label}** ($${adverse.level.toFixed(2)})`
    : `toward the **${adverse.label}** ($${adverse.level.toFixed(2)})`;
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
    sectionTitles: envelope.sections.map((s) => s.title),
  };
}

/** Return human-readable change lines; empty when first load or no material delta. */
export function diffBriefSnapshots(prev: BriefSnapshot | null, next: BriefSnapshot): string[] {
  if (!prev) return [];
  const lines: string[] = [];

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
    lines.push(`Option mark $${prev.mark.toFixed(2)} → $${next.mark.toFixed(2)}`);
  }
  if (!spotConsumed && spotMoved) {
    lines.push(narrateSpotShift(prev.spot!, next.spot!));
  }
  if (prev.gammaFlip != null && next.gammaFlip != null && Math.abs(prev.gammaFlip - next.gammaFlip) >= 0.05) {
    lines.push(`Gamma flip moved ${fmtDelta(prev.gammaFlip, next.gammaFlip)}`);
  }
  if (prev.callWall != null && next.callWall != null && Math.abs(prev.callWall - next.callWall) >= 0.05) {
    lines.push(`Call wall ${fmtDelta(prev.callWall, next.callWall)}`);
  }
  if (prev.putWall != null && next.putWall != null && Math.abs(prev.putWall - next.putWall) >= 0.05) {
    lines.push(`Put wall ${fmtDelta(prev.putWall, next.putWall)}`);
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
  if (prev.headline !== next.headline) {
    lines.push(`Verdict headline updated`);
  }

  const newSections = next.sectionTitles.filter((t) => !prev.sectionTitles.includes(t));
  if (newSections.length) {
    lines.push(`New sections: ${newSections.join(", ")}`);
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
    if (!parsed || typeof parsed !== "object" || typeof parsed.headline !== "string") return null;
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
