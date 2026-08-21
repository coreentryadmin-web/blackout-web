import type { XIntelViewId } from "@/lib/x-intel/view-catalog";

/**
 * VISUAL MEMORY — what has been photographed recently, so the account does not photograph it again.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ─────────────────────────────────────────────────────────
 *
 * The operator named it precisely:
 *
 * > "Otherwise even a capable agent will eventually discover that one Thermal panel or one Helix
 * >  screen works well and lazily reuse it 20 times."
 *
 * That is not a hypothetical. Any selection process with a quality signal converges on whatever
 * scored well, and an attachment chooser with no memory converges hardest of all, because the same
 * view keeps being locally optimal. The feed then reads:
 *
 *     Helix · Helix · Helix · Thermal · Helix
 *
 * and a week of scrolling teaches a reader that BLACKOUT has two screens. The goal is the opposite:
 *
 * > "Holy shit, how many different tools does this platform have?"
 *
 * ── WHY A PENALTY AND NOT A BAN ────────────────────────────────────────────────────────────────
 *
 * Novelty is a real objective but it is subordinate to evidence. If the Thermal matrix genuinely is
 * the frame that proves today's gamma story, it must still be able to win — the alternative is a
 * post whose attachment does not support its claim, which is a worse failure than repetition.
 *
 * So repetition is a MULTIPLIER, not a filter. A view used an hour ago has to be clearly the best
 * evidence to be chosen again; a view not used in days is favoured at the margin. Same shape as
 * the franchise rotation penalty, and same reason: it composes with the ranker's other factors and
 * it can be replayed afterwards to explain why one frame beat another.
 *
 * ── WHY THE SIGNATURE IS MORE THAN THE VIEW ID ─────────────────────────────────────────────────
 *
 * Two captures of `thermal.matrix` on different tickers at different zooms are different frames and
 * should not fully penalise each other. Two captures of `thermal.matrix` on the SAME ticker with
 * the SAME filters are the same picture twice, however far apart the stories were. The signature
 * therefore carries the whole state the operator listed — product, page, panel, visualization,
 * ticker, timeframe, filter state, composition — and similarity is graded rather than binary.
 */

export type XIntelViewSignature = {
  /** Catalog entry this frame came from. */
  view_id: XIntelViewId;
  /** Denormalised so a signature is readable on its own in the admin panel and in a query result. */
  surface: string;
  page: string;
  panel: string;
  visualization: string;
  ticker: string;
  /** e.g. "15m", "0dte". Null when the view has no timeframe concept. */
  timeframe: string | null;
  /** Whatever was toggled, selected or filtered to produce this exact frame. */
  filters: Record<string, string>;
  /** How it was framed — crop, zoom, which region. Free text; the exemplars will make it concrete. */
  composition: string;
};

/** One remembered capture, newest-first in the lists below. */
export type XIntelVisualMemoryEntry = {
  signature: XIntelViewSignature;
  /** The package it was used in — so a reviewer can go and look at it. */
  cycle_key: string;
};

/**
 * How alike two frames are, 0..1.
 *
 * Weighted, because the components are not equally responsible for a frame looking the same. The
 * view and its visualization dominate: a Thermal Matrix and a Thermal Profile of the same ticker
 * are visibly different pictures, while two Matrix shots of different tickers are visibly the same
 * picture with different numbers in it — which is exactly the monotony being avoided.
 */
export function signatureSimilarity(
  a: XIntelViewSignature,
  b: XIntelViewSignature,
): number {
  let score = 0;

  // Same catalog entry is most of the story.
  if (a.view_id === b.view_id) score += 0.45;
  else if (a.surface === b.surface) score += 0.15;

  if (a.visualization === b.visualization) score += 0.15;
  if (a.panel === b.panel) score += 0.05;
  if (a.ticker === b.ticker) score += 0.15;
  if ((a.timeframe ?? "") === (b.timeframe ?? "")) score += 0.05;
  if (a.composition === b.composition) score += 0.05;
  if (sameFilters(a.filters, b.filters)) score += 0.10;

  return Math.min(1, score);
}

function sameFilters(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

/**
 * Multiplier in (0, 1] for how stale a candidate frame is against recent history.
 *
 * `recent` is newest-first. Recency and similarity both matter: an identical frame from the last
 * package is penalised hardest, the same frame from a week ago barely at all. The worst single
 * match decides — averaging would let one repeated view hide behind a crowd of novel ones, which
 * is precisely the drift being guarded against.
 */
export function visualNoveltyPenalty(
  candidate: XIntelViewSignature,
  recent: ReadonlyArray<XIntelVisualMemoryEntry>,
): number {
  let worst = 1;
  for (let i = 0; i < recent.length; i += 1) {
    const similarity = signatureSimilarity(candidate, recent[i]!.signature);
    if (similarity <= 0.35) continue;

    // Recency weight: 1.0 for the most recent entry, decaying with position. A frame is not
    // "used up" forever — it becomes available again as it recedes.
    const recencyWeight = 1 / (1 + i * 0.5);
    // similarity 1 at position 0 → 0.2. Never 0: an identical frame stays selectable when it is
    // overwhelmingly the best evidence, which is the point of a penalty rather than a ban.
    const penalty = 1 - 0.8 * similarity * recencyWeight;
    if (penalty < worst) worst = penalty;
  }
  return worst;
}

/**
 * Which surfaces are under-represented in recent history, most-starved first.
 *
 * The penalty above stops repetition; this is what actively pulls the feed across the platform,
 * which is the operator's stated goal — a follower should discover the platform's depth simply by
 * scrolling. Surfaces absent from `recent` sort first, so a surface that has not appeared at all is
 * always ahead of one that has.
 */
export function underexposedSurfaces(
  allSurfaces: ReadonlyArray<string>,
  recent: ReadonlyArray<XIntelVisualMemoryEntry>,
): string[] {
  const lastSeen = new Map<string, number>();
  recent.forEach((entry, i) => {
    const s = entry.signature.surface;
    if (!lastSeen.has(s)) lastSeen.set(s, i);
  });
  return [...allSurfaces].sort((a, b) => {
    const ia = lastSeen.get(a) ?? Number.POSITIVE_INFINITY;
    const ib = lastSeen.get(b) ?? Number.POSITIVE_INFINITY;
    if (ia !== ib) return ib - ia;
    return a.localeCompare(b);
  });
}

/**
 * Frame-quality rejects, from the operator's content spec. A capture matching any of these must be
 * refused and re-taken, not published with an apology in the caption.
 *
 * Kept as data rather than prose so the capture harness can assert against the list and a reviewer
 * can see exactly what was checked. `admin/private/debug` content is NOT in this list on purpose:
 * that is enforced separately and unconditionally by `capture-guard.ts`, which refuses at the
 * source URL. A quality reject means "take a better picture"; a capture-guard refusal means "this
 * picture must never exist".
 */
export const FRAME_QUALITY_REJECTS = [
  "irrelevant clutter",
  "unreadable text at timeline size",
  "cut-off panel",
  "loading skeleton",
  "stale state",
  "broken chart",
  "tooltip obscuring the cited value",
  "awkward scroll position",
  "excessive empty space",
] as const;

export type FrameQualityReject = (typeof FRAME_QUALITY_REJECTS)[number];
