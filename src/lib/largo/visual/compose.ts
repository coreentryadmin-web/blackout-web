/**
 * CARD COMPOSITION — build the layout for THIS question, instead of picking one of sixteen.
 *
 * WHY THIS EXISTS, and why the template router is not enough.
 *
 * `router.ts` matches a question to one of a fixed set of layouts, and each layout demands one
 * specific bundle block. That works when the question is one the library anticipated ("what
 * happened at 7800" → LEVEL_ANALYSIS) and fails in a characteristic way when it is not: the intent
 * matches nothing, the router descends its fallback list, and the member gets whichever card
 * happened to be fillable. That is how "give me tomorrow's plays" produced a single-trade recap,
 * and it is how "how does TSLA look today" — a question that spans five products and matches no
 * template at all — would produce a MARKET_MOVE card carrying two metrics.
 *
 * The router asks "which layout fits?". A layout is the wrong unit. The right unit is the BLOCK:
 * a level map, a flow tape, a consensus strip, a runbook row. A card is then a SELECTION of blocks
 * ordered by what the question asked and bounded by what fits on the canvas. Two different
 * questions over the same evidence produce two different cards, at runtime, without either being
 * a template.
 *
 * THE HONESTY SPINE IS UNCHANGED, AND THAT IS THE POINT OF THE SPLIT.
 *
 * Composition decides WHICH blocks appear and in WHAT ORDER. It never decides what a number is.
 * Every block renders from `VisualBundle`, which is assembled from the turn's own tool output by
 * `bundle.ts` under the omission rule — absent data yields no entry, never a zero and never a
 * placeholder. So the dynamic layer can reorder, emphasise and drop; it has no mechanism for
 * inventing, because it never touches a value. A model steering this (see `emphasis` below) can
 * make a card about the wrong thing; it cannot make a card about a thing that is not there.
 *
 * HEIGHT IS ESTIMATED, NOT MEASURED, and the estimates are deliberately generous. satori lays out
 * at render time and this runs before it, so the packer works from per-block estimates. Every one
 * of them rounds UP: under-estimating overflows the canvas, and the block that falls off the
 * bottom is the last one packed — which, since packing is by descending relevance, is the LEAST
 * relevant. Overflow costs the right thing. Under-filling merely wastes space.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import type { SizeSpec } from "./sizes";
import type { VisualBundle, VisualFact } from "./types";

/** A composable unit of a card. */
export type BlockId =
  | "verdict"
  | "spot"
  | "regime"
  | "metrics"
  | "levels"
  | "gex_shifts"
  | "gamma_profile"
  | "flow_tape"
  | "consensus"
  | "playbook"
  | "trade"
  | "leaderboard"
  | "screen"
  | "rejections"
  | "counterfactual"
  | "grader_agreement"
  | "session"
  | "timeline"
  | "cone"
  | "before_after"
  | "generic_stats"
  | "generic_ranked"
  | "generic_events";

export type BlockSpec = {
  id: BlockId;
  /** Member-facing section label, when the block draws one. */
  label: string;
  /** Can this bundle fill it AT ALL? Same discipline as the router's sufficiency gates. */
  available: (b: VisualBundle) => boolean;
  /**
   * Question wording that makes this block the point of the card rather than context for it.
   * Absent for blocks that are never the subject (`verdict`, `spot`) — those earn their place
   * from `base` instead.
   */
  match?: RegExp;
  /**
   * Intrinsic priority, 0-100, independent of the question.
   *
   * This is what stops a composed card becoming an arbitrary pile. `verdict` outranks everything
   * because a card with no conclusion is a data dump; `spot` and `consensus` are next because they
   * are the context every other block is read against.
   */
  base: number;
  /** How much a block adds per unit of evidence it holds — used to break ties. */
  density: (b: VisualBundle) => number;
  /** Generous height estimate in unscaled px at PREFERRED size. See the header on why it rounds up. */
  height: (b: VisualBundle, spec: SizeSpec) => number;
  /**
   * Height in COMPACT form — the block drawn with fewer rows, or its headline figures only.
   *
   * Elasticity is what stops the packer making bad trades. Measured on a "how does TSLA look
   * today" card: the flow block (244px, weight 73.6) did not fit the 219px remaining, so it was
   * dropped — and the metric rail (110px, weight 42.4) fitted and was kept. The card therefore
   * carried a substitutable rail of two numbers instead of the tape, on a question about a name
   * whose flow was the most distinctive thing about it. Every number in the rail was already
   * available elsewhere on the card; the tape was not.
   *
   * With a compact form the block is offered at reduced height before it is abandoned, so the
   * packer degrades a block rather than losing it. Default is `height` — a block that cannot
   * shrink honestly (a leaderboard without its denominator would be a different, worse claim)
   * simply does not implement one.
   */
  minHeight?: (b: VisualBundle, spec: SizeSpec) => number;
};

/** Rows a block would draw, capped by what the surface can show. */
function rows(n: number, spec: SizeSpec, cap = 6): number {
  return Math.min(n, spec.dense ? Math.min(cap, 4) : cap);
}

/**
 * Vertical space BETWEEN blocks, in unscaled px.
 *
 * `Section` (and the verdict/spot cases, which are not Sections) each apply a top margin to every
 * block after the first. The packer used to ignore that entirely: on a five-block card it packed
 * against a budget that was 80px short of what the layout would consume, which is an
 * UNDER-estimate — the direction that pushes evidence into the pinned footer.
 *
 * It is charged per block rather than folded into each `height()` because the FIRST block does not
 * pay it, and a per-block constant cannot express that.
 */
export function blockGap(spec: SizeSpec): number {
  return spec.dense ? 14 : 20;
}

/**
 * The verdict block's height, derived from the SAME decisions `Headline` makes.
 *
 * WHY IT IS NOT A CONSTANT-PER-LINE ANY MORE. The old estimate assumed 26 characters per line on a
 * stacked surface and 70px per line. `Headline` actually steps its font DOWN as the text gets
 * longer (78 → 64 → 52 unscaled at 30 and 46 characters), so a long headline draws MORE characters
 * per line and SHORTER lines than the estimate priced — both errors in the same direction. On the
 * live NVDA card that mispriced a 3-line headline as 4 lines of the wrong height: 354px estimated
 * against 259px drawn, and the 95px difference was reported to the member as "no room on this
 * card" for four blocks that would have fitted.
 *
 * The character-width and line-height factors are empirical (Anton at these sizes, measured by
 * rendering — see `scripts/audit/largo-card-deadspace.mjs`), which is why they live next to the
 * step-down they mirror rather than being spread across the callers.
 */
export function verdictHeight(b: VisualBundle, spec: SizeSpec): number {
  const text = b.headline ?? "";
  const font = text.length > 46 ? 52 : text.length > 30 ? 64 : 78;
  /** Content box in the unscaled px the packer works in. */
  const contentWidth = (spec.width - spec.pad * 2) / spec.scale;
  const perLine = Math.max(1, Math.floor(contentWidth / (font * 0.45)));
  const lines = Math.max(1, Math.ceil(text.length / perLine));
  // Summary is mono at 18/1.5 and is NOT drawn on a dense surface — the template drops it, so
  // pricing it there was pure phantom height.
  const summary = b.summary && !spec.dense ? Math.max(1, Math.ceil(b.summary.length / Math.floor(contentWidth / 11))) : 0;
  return lines * Math.round(font * 1.02) + (summary ? 12 + summary * 27 : 0) + 30;
}

/**
 * THE BLOCK CATALOGUE.
 *
 * Ordered by `base` descending for readability only — `composeCard` sorts explicitly, so the
 * literal order here carries no behaviour and a new block can be appended anywhere.
 */
export const BLOCKS: BlockSpec[] = [
  {
    id: "verdict",
    label: "Verdict",
    available: (b) => !!b.headline,
    base: 100,
    density: () => 1,
    height: (b, spec) => verdictHeight(b, spec),
  },
  {
    id: "spot",
    label: "Spot",
    available: (b) => !!b.spot,
    base: 88,
    density: () => 1,
    height: (_b, spec) => (spec.dense ? 96 : 116),
  },
  {
    id: "consensus",
    // The cross-product row. Highest-base evidence block because "what do all five products say"
    // is the question the desk exists to answer, and no single-product block can substitute.
    label: "System consensus",
    available: (b) => (b.systemReads?.length ?? 0) >= 2,
    match: /\b(agree|disagree|consensus|conflict|all (the )?(systems|products|tools)|cross.?desk|everything|overall|how does .* look|what does .* look like|picture|snapshot|overview|brief)\b/i,
    base: 84,
    density: (b) => (b.systemReads?.length ?? 0),
    height: (_b, spec) => (spec.dense ? 104 : 124),
  },
  {
    id: "regime",
    label: "Dealer regime",
    available: (b) => !!b.regime,
    match: /\b(regime|gamma (environment|state)|short gamma|long gamma|pinned|stabilis|destabilis)\b/i,
    base: 76,
    density: () => 1,
    height: (_b, spec) => (spec.dense ? 68 : 80),
  },
  {
    id: "levels",
    label: "Dealer levels",
    available: (b) => (b.levels?.length ?? 0) >= 1,
    match: /\b(level|wall|strike|support|resistance|gamma flip|max pain|pin|where is|hold|held|break|broke)\b/i,
    base: 74,
    density: (b) => b.levels?.length ?? 0,
    height: (b, spec) => 34 + rows((b.levels?.length ?? 0) + (b.spot ? 1 : 0), spec, 7) * (spec.dense ? 58 : 64),
    minHeight: (_b, spec) => 34 + 3 * (spec.dense ? 58 : 64),
  },
  {
    id: "playbook",
    label: "Playbook",
    available: (b) => (b.playbook?.rows.length ?? 0) >= 1,
    match: /\b(playbook|edition|plays?|runbook|watch ?list|trading tomorrow|entries|entry|target|stop)\b/i,
    base: 72,
    density: (b) => (b.playbook?.rows.length ?? 0) * 3,
    // MEASURED, not guessed: a row is padding(9×2) + a 20px line + a 6px gap ≈ 48 unscaled px. The
    // 96/128 that used to sit here priced every row at nearly three times what it draws, which on a
    // two-play card wasted 144px — over a tenth of a portrait canvas — and then reported the blocks
    // that height would have fitted as "no room on this card".
    height: (b, spec) => 34 + rows(b.playbook?.rows.length ?? 0, spec, spec.stack ? 6 : 4) * (spec.dense ? 46 : 52),
    minHeight: (_b, spec) => 34 + 2 * (spec.dense ? 46 : 52),
  },
  {
    id: "flow_tape",
    label: "Flow",
    available: (b) => (b.flow?.rows.length ?? 0) >= 1,
    match: /\b(flow|premium|sweep|prints?|tape|whale|dark ?pool|who.s buying|unusual)\b/i,
    base: 70,
    density: (b) => b.flow?.rows.length ?? 0,
    // The 70px base under-counted the totals header (net/gross chips AND the call/put split bar),
    // and 58 under-counted a print row. Measured at 4 prints the block drew ~375 against a 302
    // estimate — an UNDER-estimate, which is the dangerous direction: it packs a block that then
    // pushes later evidence into the pinned footer.
    height: (b, spec) => 118 + rows(b.flow?.rows.length ?? 0, spec, 5) * (spec.dense ? 60 : 64),
    // The net/gross chips plus one print. The TOTALS are the honest core of a flow read; the
    // individual prints are the illustration, so the prints are what shrinks.
    minHeight: (_b, spec) => 118 + 1 * (spec.dense ? 60 : 64),
  },
  {
    id: "gamma_profile",
    label: "Gamma profile",
    /**
     * FIVE strikes AND at least one non-zero exposure.
     *
     * The row count alone was not enough. A profile of all-zero rows passed the gate and drew a
     * bar chart in which every bar rendered at the 3% minimum width — a chart asserting a flat,
     * MEASURED distribution where the real reading is "no dealer exposure anywhere". Those are
     * different claims, and the bar chart makes the wrong one look like data.
     *
     * A legitimately flat book is a real state; it is just not a bar chart. It reaches the member
     * through the regime block and the answer's prose instead.
     */
    available: (b) =>
      (b.gammaProfile?.rows.length ?? 0) >= 3 && (b.gammaProfile?.rows ?? []).some((r) => r.gamma !== 0),
    match: /\bgamma (map|profile|distribution|stacked)\b|\bwhere is (the )?gamma\b|\b(gex|dealer gamma)\b/i,
    base: 68,
    density: (b) => b.gammaProfile?.rows.length ?? 0,
    height: (b, spec) => 34 + rows(b.gammaProfile?.rows.length ?? 0, spec, 8) * (spec.dense ? 30 : 36),
    minHeight: (_b, spec) => 34 + 4 * (spec.dense ? 30 : 36),
  },
  {
    id: "trade",
    label: "Trade",
    available: (b) => !!b.trade?.entry && (!!b.trade.exit || !!b.trade.returnPct || !!b.trade.status),
    match: /\b(trade|recap|position|committed|p&?l|pnl|return|catch|caught|how did .* (do|perform))\b/i,
    base: 66,
    density: () => 3,
    height: (_b, spec) => (spec.dense ? 180 : 230),
  },
  {
    id: "leaderboard",
    label: "Graded results",
    available: (b) => (b.leaderboard?.rows.length ?? 0) >= 2,
    match: /\b(leaderboard|best|top \d+|top performing|worst|track record|results|win rate|how did we do)\b/i,
    base: 65,
    density: (b) => (b.leaderboard?.rows.length ?? 0) * 2,
    height: (b, spec) => 110 + rows(b.leaderboard?.rows.length ?? 0, spec, 7) * (spec.dense ? 48 : 58),
    // The 110px floor is the graded/wins/losses tally and it does NOT shrink. Rows are the
    // illustration; the denominator is the claim, and a leaderboard without it is the #1911
    // failure — a true card that is dishonest because the population is missing.
    minHeight: (_b, spec) => 110 + 2 * (spec.dense ? 48 : 58),
  },
  {
    id: "counterfactual",
    label: "Counterfactual",
    available: (b) => !!b.counterfactual && b.counterfactual.gradedCount > 0,
    match: /\b(counterfactual|firewall|would have|what did (it|the gate|the rules) (hold|stop|block)|guards? (held|cost|paid))\b/i,
    base: 64,
    density: (b) => (b.counterfactual?.rows.length ?? 0) + 4,
    height: (b, spec) => 150 + rows(b.counterfactual?.rows.length ?? 0, spec, 6) * (spec.dense ? 42 : 50),
  },
  {
    id: "screen",
    label: "Screen",
    available: (b) => (b.screen?.rows.length ?? 0) >= 3,
    match: /\b(screen(er)?|scan(ner)?|which names|ranked|most|nearest|across the (market|universe))\b/i,
    base: 62,
    density: (b) => b.screen?.rows.length ?? 0,
    height: (b, spec) => 34 + rows(b.screen?.rows.length ?? 0, spec, 8) * (spec.dense ? 42 : 50),
    minHeight: (_b, spec) => 34 + 3 * (spec.dense ? 42 : 50),
  },
  {
    id: "grader_agreement",
    label: "Grader agreement",
    available: (b) => !!b.graderAgreement && b.graderAgreement.comparable > 0,
    match: /\b(grader|grading|agreement|cross.?check|audit(ed)?|how do (you|we) (know|verify)|independently)\b/i,
    base: 60,
    density: (b) => (b.graderAgreement?.rows.length ?? 0) + 4,
    height: (b, spec) => 150 + rows(b.graderAgreement?.rows.length ?? 0, spec, 5) * (spec.dense ? 42 : 50),
  },
  {
    id: "rejections",
    label: "Rejections",
    available: (b) => (b.rejections?.rows.length ?? 0) >= 2,
    match: /\b(reject|passed on|held|skip(ped)?|gate|didn.t take|why not|blocked)\b/i,
    base: 58,
    density: (b) => b.rejections?.rows.length ?? 0,
    height: (b, spec) => 34 + rows(b.rejections?.rows.length ?? 0, spec, 6) * (spec.dense ? 42 : 50),
    minHeight: (_b, spec) => 34 + 2 * (spec.dense ? 42 : 50),
  },
  {
    id: "gex_shifts",
    label: "Gamma change",
    available: (b) => (b.gexShifts?.length ?? 0) >= 1,
    match: /\b(changed|shift|since|moved|last \d+ ?(min|hour)|repositioned)\b/i,
    base: 56,
    density: (b) => b.gexShifts?.length ?? 0,
    height: (b, spec) => 34 + rows(b.gexShifts?.length ?? 0, spec, 5) * (spec.dense ? 34 : 40),
  },
  {
    id: "session",
    label: "Session",
    available: (b) => !!b.session?.closeDisplay,
    match: /\b(session|today.s (recap|close)|how did (the )?(day|session) (go|end)|closed?)\b/i,
    base: 54,
    density: () => 4,
    height: (_b, spec) => (spec.dense ? 150 : 190),
  },
  {
    id: "cone",
    label: "Expected move",
    available: (b) => !!b.cone && b.cone.path.length >= 2,
    match: /\b(expected move|em|cone|sigma|1σ|band|range day|stay(ed)? inside)\b/i,
    base: 52,
    density: () => 4,
    height: (_b, spec) => (spec.dense ? 190 : 250),
  },
  {
    id: "before_after",
    label: "Before / after",
    available: (b) => (b.beforeAfter?.rows.length ?? 0) >= 2 && !!b.beforeAfter?.beforeLabel,
    match: /\b(what changed|changed since|before and after|since (the )?(open|last))\b/i,
    base: 50,
    density: (b) => b.beforeAfter?.rows.length ?? 0,
    height: (b, spec) => 60 + rows(b.beforeAfter?.rows.length ?? 0, spec, 5) * (spec.dense ? 44 : 52),
  },
  {
    id: "timeline",
    label: "Timeline",
    available: (b) => (b.timeline?.length ?? 0) >= 2,
    match: /\b(timeline|sequence|in what order|what happened (first|next|when)|play.?by.?play)\b/i,
    base: 48,
    density: (b) => b.timeline?.length ?? 0,
    height: (b, spec) => 34 + rows(b.timeline?.length ?? 0, spec, 6) * (spec.dense ? 54 : 64),
  },
  /**
   * THE GENERIC BLOCKS sit BELOW every purpose-built one and ABOVE the metric rail.
   *
   * Below, because a block that knows what it is reading renders it better — the counterfactual's
   * symmetric columns and the leaderboard's pinned denominator are honesty mechanisms built into
   * their geometry, and a generic grid of the same numbers would lose them.
   *
   * Above the metric rail, because these carry evidence from tools that previously reached NO
   * block at all. That is the difference between a card with 150px of dead canvas and a card that
   * answers the question — see `generic-extract.ts` on the 7-matchers / 121-tools gap.
   */
  {
    id: "generic_events",
    label: "Calendar",
    available: (b) => (b.genericEvents?.rows.length ?? 0) >= 2,
    match: /\b(earnings|calendar|when|upcoming|schedule|catalyst|ipo|fda|econ(omic)?|report(ing)?|news)\b/i,
    base: 55,
    density: (b) => b.genericEvents?.rows.length ?? 0,
    height: (b, spec) => 34 + rows(b.genericEvents?.rows.length ?? 0, spec, 6) * (spec.dense ? 40 : 46),
    minHeight: (_b, spec) => 34 + 2 * (spec.dense ? 40 : 46),
  },
  {
    id: "generic_ranked",
    label: "Ranked",
    available: (b) => (b.genericRanked?.rows.length ?? 0) >= 3,
    match: /\b(top|best|worst|biggest|most|ranked|leaders|laggards|movers|breadth|sector|hottest|unusual)\b/i,
    base: 53,
    density: (b) => b.genericRanked?.rows.length ?? 0,
    height: (b, spec) => 34 + rows(b.genericRanked?.rows.length ?? 0, spec, 8) * (spec.dense ? 42 : 48),
    minHeight: (_b, spec) => 34 + 3 * (spec.dense ? 42 : 48),
  },
  {
    id: "generic_stats",
    label: "Readings",
    available: (b) => (b.genericStats?.rows.length ?? 0) >= 3,
    match: /\b(stats?|readings?|numbers?|iv|vol(atility)?|technicals?|fundamentals?|financials?|breadth|seasonality|short interest)\b/i,
    base: 51,
    density: (b) => b.genericStats?.rows.length ?? 0,
    // Four per row on wide surfaces, two when stacked.
    height: (b, spec) => {
      const n = Math.min(b.genericStats?.rows.length ?? 0, 8);
      const perRow = spec.stack ? 2 : 4;
      return 34 + Math.ceil(n / perRow) * (spec.dense ? 78 : 92);
    },
    minHeight: (_b, spec) => 34 + 1 * (spec.dense ? 78 : 92),
  },
  {
    id: "metrics",
    // LAST on purpose. The metric rail is the most substitutable block on the card — every number
    // in it is also available in a more specific block — so it is the right thing to fill leftover
    // space with and the right thing to lose when a sharper block wants the room.
    label: "Metrics",
    available: (b) => (b.metrics?.length ?? 0) >= 1,
    base: 40,
    density: (b) => b.metrics?.length ?? 0,
    height: (_b, spec) => (spec.dense ? 92 : 110),
  },
];

export const BLOCK_BY_ID: Record<BlockId, BlockSpec> = Object.fromEntries(
  BLOCKS.map((b) => [b.id, b])
) as Record<BlockId, BlockSpec>;

/** Weight boosts, in the units `base` is expressed in. */
const MATCH_BOOST = 45;
const EMPHASIS_BOOST = 30;
/** Density is a tie-break, not a driver — a fat block must not outrank a directly-asked one. */
const DENSITY_WEIGHT = 1.2;
const DENSITY_CAP = 12;

export type ComposeInput = {
  question: string;
  bundle: VisualBundle;
  spec: SizeSpec;
  /**
   * Blocks Largo asked for, from the answer it just wrote.
   *
   * A HINT, NOT A COMMAND, and the asymmetry is deliberate. Emphasis BOOSTS a block's weight; it
   * cannot conjure one, because `available()` still gates every candidate against the bundle. So
   * the worst a wrong or hallucinated emphasis can do is order a card badly. It can never put a
   * number on the card that the evidence does not carry, and it can never name a system that was
   * not consulted.
   */
  emphasis?: readonly BlockId[] | null;
  /** Blocks the caller has already drawn elsewhere and does not want repeated. */
  exclude?: readonly BlockId[] | null;
};

export type ComposedBlock = {
  id: BlockId;
  label: string;
  weight: number;
  estHeight: number;
  /** True when the question's own wording asked for this block. */
  matchedIntent: boolean;
  /** Drawn in reduced form because the canvas could not take it at full height. */
  compact: boolean;
  /**
   * Rows this block may draw. `null` = the surface's own cap.
   *
   * Set when the packer either SHRANK a block to fit or GREW one into leftover budget, so the
   * renderer draws exactly what was costed rather than re-deciding and overflowing.
   */
  rowBudget: number | null;
};

export type Composition = {
  blocks: ComposedBlock[];
  /** Available and relevant, but no room left. Reported so truncation is never silent. */
  dropped: { id: BlockId; label: string; reason: "no_room" }[];
  /** Unscaled px the packer had to spend, and what it actually spent. */
  budget: number;
  used: number;
};

/**
 * Score one block for this question.
 *
 * Exported for the tests, which assert the ORDERING RULES rather than specific numbers — the
 * constants above are tuning and will move; the invariants ("a directly-asked block outranks a
 * merely-dense one") are the contract.
 */
export function scoreBlock(spec: BlockSpec, question: string, bundle: VisualBundle, emphasis?: readonly BlockId[] | null): {
  weight: number;
  matchedIntent: boolean;
} {
  const matchedIntent = spec.match?.test(question ?? "") ?? false;
  const density = Math.min(spec.density(bundle), DENSITY_CAP);
  const weight =
    spec.base +
    (matchedIntent ? MATCH_BOOST : 0) +
    (emphasis?.includes(spec.id) ? EMPHASIS_BOOST : 0) +
    density * DENSITY_WEIGHT;
  return { weight, matchedIntent };
}

/**
 * The vertical budget a composed card has for evidence.
 *
 * Chrome and the pinned footer are subtracted first and are NOT negotiable — the footer carries
 * the mandatory educational disclaimer, and `CardShell` pins it precisely so a long card sheds
 * evidence instead of compliance text. The margin below is the packer's own safety factor on top
 * of that, since block heights are estimates.
 */
export function heightBudget(spec: SizeSpec): number {
  const chrome = 30; // header strip
  const safety = 24;
  // Estimates are in unscaled px; the canvas is in real px. Divide by the type scale to compare.
  return (spec.height - spec.footer - spec.pad - chrome - safety) / spec.scale;
}

/**
 * Compose a card: choose the blocks, in order, that answer THIS question and fit THIS canvas.
 *
 * ORDER OF OPERATIONS MATTERS AND IS NOT THE OBVIOUS ONE. Blocks are selected by weight, then
 * RE-SORTED for presentation by `base`. Selection and reading order are different problems:
 * relevance decides what earns a place, but a card whose sections appear in relevance order reads
 * as a ranked list rather than as a brief. The verdict belongs at the top whether or not the
 * question asked for it, and the metric rail belongs at the bottom even when it was the reason the
 * card exists.
 *
 * Returns an empty `blocks` array when nothing is available. That is a real answer — the caller
 * declines to draw rather than producing a frame around nothing, which is the failure the Night
 * Hawk playbook bug shipped.
 */
/**
 * WHICH BLOCK OWNS EACH FACT, most specific first.
 *
 * MEASURED ON A LIVE NVDA CARD. The dealer posture was drawn three times — as the regime block's
 * whole subject, as a row of the consensus strip, and as a metric tile — and the net premium three
 * times alongside it. Every one of those renderings was individually correct and sourced, which is
 * what made it hard to see in review: nothing was wrong, there was just three times as much of it.
 *
 * ORDER IS SPECIFICITY, NOT IMPORTANCE. The regime block says "SHORT GAMMA" with the positioning
 * read underneath it; the consensus strip says "THERMAL: short gamma" as one of five; the metric
 * tile says "Dealer gamma / SHORT". The first tells a member the most, so it wins when it is on
 * the card — and when it is NOT, the next one down picks the fact up rather than the card losing
 * it. That fallback is why this resolves against the CHOSEN blocks rather than being applied to
 * the bundle up front.
 */
const FACT_OWNERS: Record<VisualFact, BlockId[]> = {
  gamma_posture: ["regime", "consensus", "metrics"],
  net_premium: ["flow_tape", "consensus", "metrics"],
  session_change: ["spot", "metrics"],
};

/**
 * How aggressively to strip repeats. Ordered MOST aggressive first — `composeForRender` walks this
 * list and takes the first tier that does not cost canvas.
 *
 *  - `all`       one rendering per fact, full stop.
 *  - `consensus` strip the consensus strip's copy but leave the metric rail's.
 *  - `none`      draw everything, as before this shipped.
 *
 * WHY THE MIDDLE TIER EXISTS, and it is the part I got wrong first. Full de-duplication is the
 * obviously-correct rule and it MEASURED WORSE: on the NVDA fixture the re-packed card fell from
 * 478px of a 520px budget to 374px, because the height freed by dropping two rows had no unshown
 * evidence to grow into. Trading a repeated number for a fifth of the canvas left blank is not an
 * improvement — a member reads dead space as a broken card just as readily as a doubled figure.
 *
 * The metric rail is the right place to relax, and by its own design note: it is "the most
 * substitutable block on the card — every number in it is also available in a more specific
 * block", already positioned as what fills leftover space. Restating a fact there when there is
 * genuinely nothing else to show is that block doing its job. Restating it while real rows go
 * untruncated is not, which is exactly the distinction the tier walk measures.
 */
const DEDUPE_TIERS = ["all", "consensus", "none"] as const;
export type DedupeTier = (typeof DEDUPE_TIERS)[number];

/** Blocks a tier is willing to strip a duplicate FROM. The owning block is never stripped. */
const TIER_TARGETS: Record<DedupeTier, BlockId[]> = {
  all: ["consensus", "metrics"],
  consensus: ["consensus"],
  none: [],
};

/**
 * Strip duplicate renderings of a fact, keeping the one on the most specific CHOSEN block.
 *
 * Pure — returns a shallow copy and never mutates the caller's bundle, which matters because the
 * renderer composes several times and each pass must see the untouched evidence.
 *
 * A fact whose owners are ALL absent from `chosen` is left completely alone. Removing it would be
 * the one outcome worse than repeating it: the card would silently lose a number the answer's
 * prose refers to.
 */
export function dropDuplicateFacts(
  bundle: VisualBundle,
  chosen: Set<BlockId>,
  tier: DedupeTier = "all"
): VisualBundle {
  const targets = new Set(TIER_TARGETS[tier]);
  /** For each fact, the single block allowed to render it — or null when no owner was chosen. */
  const keeper = new Map<VisualFact, BlockId | null>();
  for (const [fact, owners] of Object.entries(FACT_OWNERS) as [VisualFact, BlockId[]][]) {
    keeper.set(fact, owners.find((id) => chosen.has(id)) ?? null);
  }
  const kept = (fact: VisualFact | undefined, self: BlockId): boolean => {
    if (!fact) return true; // untagged rows assert nothing shared — always kept
    if (!targets.has(self)) return true; // this tier does not touch this block
    const owner = keeper.get(fact);
    return owner == null || owner === self;
  };

  return {
    ...bundle,
    metrics: bundle.metrics?.filter((m) => kept(m.fact, "metrics")),
    systemReads: bundle.systemReads?.filter((r) => kept(r.fact, "consensus")),
  };
}

/**
 * Compose, then take the LEAST-REPETITIVE layout that still fills the canvas.
 *
 * One composition pass establishes which blocks are on the card, because de-duplication is defined
 * against the chosen set (see FACT_OWNERS). Each tier is then applied to the evidence and
 * re-composed, and the walk stops at the first tier whose card uses as much canvas as the best
 * candidate does. Since the tiers run most-aggressive first, that is by construction the fewest
 * repeats that costs nothing.
 *
 * The re-pack is what makes the de-duplication pay: freed height goes back through the packer's
 * growth phase and is spent on rows that already exist in the bundle and were being truncated. It
 * also lets a block that lost its last row disappear honestly — `consensus` requires two reads, so
 * a strip left holding one is correctly unavailable rather than drawing a one-product "consensus".
 *
 * NEVER ITERATES ON ITS OWN OUTPUT. Each tier is composed from the ORIGINAL chosen set, so the
 * walk terminates in exactly `DEDUPE_TIERS.length` passes and cannot oscillate.
 */
export function composeForRender(input: ComposeInput): { composition: Composition; bundle: VisualBundle } {
  const first = composeCard(input);
  const chosen = new Set<BlockId>(first.blocks.map((b) => b.id));

  const candidates = DEDUPE_TIERS.map((tier) => {
    if (tier === "none") return { tier, bundle: input.bundle, composition: first };
    const bundle = dropDuplicateFacts(input.bundle, chosen, tier);
    const composition = composeCard({ ...input, bundle });
    return { tier, bundle, composition };
  })
    // A tier that empties the card is a bug in the fact table, not a layout worth shipping.
    .filter((c) => c.composition.blocks.length > 0);

  const best = Math.max(...candidates.map((c) => c.composition.used));
  // TOLERANCE, not equality. Block heights are estimates (see the header), so demanding an exact
  // match would reject a tier that lost a few pixels of padding while removing a whole repeated
  // row. 2% of the budget is below what is visible and well under one row of any block.
  const floor = best - input.spec.height * 0.02;
  const pick = candidates.find((c) => c.composition.used >= floor) ?? candidates[candidates.length - 1]!;
  return { composition: pick.composition, bundle: pick.bundle };
}

export function composeCard(input: ComposeInput): Composition {
  const { question, bundle, spec } = input;
  const excluded = new Set(input.exclude ?? []);
  const budget = heightBudget(spec);

  const candidates = BLOCKS.filter((s) => !excluded.has(s.id) && s.available(bundle))
    .map((s) => {
      const { weight, matchedIntent } = scoreBlock(s, question, bundle, input.emphasis);
      return { spec: s, weight, matchedIntent, estHeight: s.height(bundle, spec), rowBudget: null as number | null };
    })
    .sort((a, b) => b.weight - a.weight);

  type Picked = (typeof candidates)[number] & { compact: boolean; height: number };
  const chosen: Picked[] = [];
  const dropped: Composition["dropped"] = [];
  let used = 0;

  const gap = blockGap(spec);
  for (const c of candidates) {
    // Every block after the first pays the section margin. Charged here rather than inside each
    // `height()` because the first block does not pay it.
    const lead = chosen.length === 0 ? 0 : gap;
    // FULL, THEN COMPACT, THEN DROP. Degrading a block beats losing it — see `minHeight`.
    if (used + lead + c.estHeight <= budget) {
      chosen.push({ ...c, compact: false, height: c.estHeight });
      used += lead + c.estHeight;
      continue;
    }
    const min = c.spec.minHeight?.(bundle, spec);
    if (min != null && used + lead + min <= budget) {
      chosen.push({ ...c, compact: true, height: min });
      used += lead + min;
      continue;
    }
    // NOT `break`. A tall block that does not fit must not veto every shorter block behind it —
    // a 250px expected-move cone would otherwise take the whole remaining budget with it and
    // leave 90px of canvas blank rather than drawing the 88px regime block ranked below it.
    dropped.push({ id: c.spec.id, label: c.spec.label, reason: "no_room" });
  }

  /**
   * SPEND THE LEFTOVER, highest-weight block first.
   *
   * Measured: "today's top 5 performing 0DTE plays" composed to verdict + leaderboard + metrics
   * and used 680 of 1061px — a third of the canvas blank while the leaderboard was drawing five
   * of the rows it had. A packer that only ever shrinks under-fills every card whose evidence is
   * narrower than its surface, which on a story-sized export is most of them.
   *
   * Growth is granted in whole rows and ONLY to blocks that have unshown rows to give, so it can
   * never pad — the extra space is filled with evidence that already existed or not at all.
   */
  let slack = budget - used;
  for (const c of [...chosen].sort((a, b) => b.weight - a.weight)) {
    const total = rowCount(c.spec.id, bundle);
    if (total == null) continue;
    const drawn = drawnRows(c, bundle, spec);
    if (drawn >= total) continue;
    const perRow = rowHeight(c.spec.id, spec);
    const extra = Math.min(total - drawn, Math.floor(slack / perRow));
    if (extra <= 0) continue;
    c.rowBudget = drawn + extra;
    slack -= extra * perRow;
    used += extra * perRow;
  }

  chosen.sort((a, b) => b.spec.base - a.spec.base);

  return {
    blocks: chosen.map((c) => ({
      id: c.spec.id,
      label: c.spec.label,
      weight: Math.round(c.weight * 10) / 10,
      estHeight: Math.round(c.height),
      matchedIntent: c.matchedIntent,
      compact: c.compact,
      rowBudget: c.rowBudget ?? null,
    })),
    dropped,
    budget: Math.round(budget),
    used: Math.round(used),
  };
}

/** How many rows this block's evidence actually holds. Null for blocks that are not row-based. */
function rowCount(id: BlockId, b: VisualBundle): number | null {
  switch (id) {
    case "levels": return (b.levels?.length ?? 0) + (b.spot ? 1 : 0);
    case "playbook": return b.playbook?.rows.length ?? null;
    case "flow_tape": return b.flow?.rows.length ?? null;
    case "gamma_profile": return b.gammaProfile?.rows.length ?? null;
    case "leaderboard": return b.leaderboard?.rows.length ?? null;
    case "screen": return b.screen?.rows.length ?? null;
    case "rejections": return b.rejections?.rows.length ?? null;
    case "gex_shifts": return b.gexShifts?.length ?? null;
    case "timeline": return b.timeline?.length ?? null;
    case "generic_ranked": return b.genericRanked?.rows.length ?? null;
    case "generic_events": return b.genericEvents?.rows.length ?? null;
    default: return null;
  }
}

/** Unscaled px one more row of this block costs. */
function rowHeight(id: BlockId, spec: SizeSpec): number {
  switch (id) {
    case "playbook": return spec.dense ? 96 : 128;
    case "levels": return spec.dense ? 52 : 60;
    case "flow_tape": return spec.dense ? 50 : 58;
    case "leaderboard": return spec.dense ? 48 : 58;
    case "timeline": return spec.dense ? 54 : 64;
    case "gamma_profile": return spec.dense ? 30 : 36;
    case "gex_shifts": return spec.dense ? 34 : 40;
    case "generic_ranked": return spec.dense ? 42 : 48;
    case "generic_events": return spec.dense ? 40 : 46;
    default: return spec.dense ? 42 : 50;
  }
}

/** Rows the block was costed for, before any growth. */
function drawnRows(
  c: { spec: BlockSpec; compact: boolean; rowBudget?: number | null },
  b: VisualBundle,
  spec: SizeSpec
): number {
  if (c.rowBudget != null) return c.rowBudget;
  const total = rowCount(c.spec.id, b) ?? 0;
  if (c.compact) {
    // Mirrors the per-block minHeight row counts above.
    if (c.spec.id === "flow_tape") return 1;
    if (c.spec.id === "generic_events") return 2;
    if (c.spec.id === "generic_ranked") return 3;
    if (c.spec.id === "playbook" || c.spec.id === "leaderboard" || c.spec.id === "rejections") return 2;
    if (c.spec.id === "levels" || c.spec.id === "screen") return 3;
    return Math.min(total, 4);
  }
  return Math.min(total, spec.dense ? 4 : 6);
}

/**
 * Is this level on the SAME PRICE SCALE as spot — i.e. plausibly the same instrument?
 *
 * THIS GUARD EXISTS BECAUSE COMPOSITION CREATED THE FAILURE MODE. A designed template was narrow
 * by construction: LEVEL_ANALYSIS was selected for a level question and drew that instrument's
 * levels. A composed card draws whatever the bundle carries, and a turn that touched two
 * instruments — "compare TSLA to SPX", or a Night Hawk answer naming several names — carries
 * levels for both. The map would stack a 7,800 SPX call wall above a 348 TSLA spot and label the
 * arrangement a dealer ladder. It is the most misleading thing this library can draw: every
 * number on it is real, and the relationship between them is fiction.
 *
 * The test is SCALE, not ticker, because `VisualLevel` carries no ticker and adding one would
 * enforce nothing — levels arrive from shape-matched tool output that does not reliably name its
 * instrument either. A factor of three is far outside any real dealer level (a distant put wall
 * is single-digit percent away, an OPEX magnet rarely past 15%) and far inside the gap between
 * two instruments' price scales.
 *
 * With no spot there is nothing to compare against, so nothing is excluded — a level map with no
 * anchor is a different problem, and one the level block's own sufficiency gate handles.
 */
export function levelOnSameScale(price: number, spotValue: number | null | undefined): boolean {
  if (spotValue == null || !Number.isFinite(spotValue) || spotValue <= 0) return true;
  return price >= spotValue / 3 && price <= spotValue * 3;
}

/** Parse an emphasis list from untrusted input (Largo's own spec block), dropping unknown ids. */
export function parseEmphasis(value: unknown): BlockId[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is BlockId => typeof v === "string" && v in BLOCK_BY_ID);
  return out.length ? out : null;
}

/**
 * Move the SUBJECT's rows to the front — but only when doing so changes what is visible.
 *
 * THE PROBLEM. A playbook block draws `rows.slice(0, cap)` in rank order. Asked "generate how NVDA
 * looks today", the live card drew a playbook of NET, NVDA and CRM: the edition's top three, of
 * which two have nothing to do with the question. The evidence was correct and the selection was
 * off-topic, which on a shareable asset is its own kind of wrong.
 *
 * WHY IT IS CONDITIONAL, AND NOT JUST A SORT. Rank carries meaning — a runbook whose first row is
 * not the highest-conviction play is misleading in a different way. So the reorder happens ONLY
 * when the subject's row would otherwise be CUT OFF by the cap. If NVDA is already drawn, the
 * order is exactly what the engine published. Nothing is added, nothing is dropped, and rows keep
 * their relative order within each group (a stable partition, not a re-rank).
 *
 * With no subject, or no matching row, the input is returned untouched.
 */
export function subjectFirst<T extends { ticker: string }>(
  rows: readonly T[],
  subject: string | null | undefined,
  cap: number
): readonly T[] {
  const t = subject?.trim().toUpperCase();
  if (!t || cap <= 0) return rows;
  const matches = (r: T) => r.ticker?.trim().toUpperCase() === t;
  if (!rows.some(matches)) return rows;
  // Already visible: the published order stands.
  if (rows.slice(0, cap).some(matches)) return rows;
  return [...rows.filter(matches), ...rows.filter((r) => !matches(r))];
}
