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
import type { VisualBundle } from "./types";

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
  | "before_after";

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
    height: (b, spec) => {
      const len = (b.headline ?? "").length;
      const lines = Math.ceil(len / (spec.stack ? 26 : 40));
      return 30 + lines * (spec.stack ? 70 : 58) + (b.summary ? 44 : 0);
    },
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
    height: (_b, spec) => (spec.dense ? 74 : 88),
  },
  {
    id: "levels",
    label: "Dealer levels",
    available: (b) => (b.levels?.length ?? 0) >= 1,
    match: /\b(level|wall|strike|support|resistance|gamma flip|max pain|pin|where is|hold|held|break|broke)\b/i,
    base: 74,
    density: (b) => b.levels?.length ?? 0,
    height: (b, spec) => 34 + rows((b.levels?.length ?? 0) + (b.spot ? 1 : 0), spec, 7) * (spec.dense ? 52 : 60),
    minHeight: (_b, spec) => 34 + 3 * (spec.dense ? 52 : 60),
  },
  {
    id: "playbook",
    label: "Playbook",
    available: (b) => (b.playbook?.rows.length ?? 0) >= 1,
    match: /\b(playbook|edition|plays?|runbook|watch ?list|trading tomorrow|entries|entry|target|stop)\b/i,
    base: 72,
    density: (b) => (b.playbook?.rows.length ?? 0) * 3,
    height: (b, spec) => 34 + rows(b.playbook?.rows.length ?? 0, spec, spec.stack ? 6 : 4) * (spec.dense ? 96 : 128),
    minHeight: (_b, spec) => 34 + 2 * (spec.dense ? 96 : 128),
  },
  {
    id: "flow_tape",
    label: "Flow",
    available: (b) => (b.flow?.rows.length ?? 0) >= 1,
    match: /\b(flow|premium|sweep|prints?|tape|whale|dark ?pool|who.s buying|unusual)\b/i,
    base: 70,
    density: (b) => b.flow?.rows.length ?? 0,
    height: (b, spec) => 70 + rows(b.flow?.rows.length ?? 0, spec, 5) * (spec.dense ? 50 : 58),
    // The net/gross chips plus one print. The TOTALS are the honest core of a flow read; the
    // individual prints are the illustration, so the prints are what shrinks.
    minHeight: (_b, spec) => 70 + 1 * (spec.dense ? 50 : 58),
  },
  {
    id: "gamma_profile",
    label: "Gamma profile",
    available: (b) => (b.gammaProfile?.rows.length ?? 0) >= 3,
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

  for (const c of candidates) {
    // FULL, THEN COMPACT, THEN DROP. Degrading a block beats losing it — see `minHeight`.
    if (used + c.estHeight <= budget) {
      chosen.push({ ...c, compact: false, height: c.estHeight });
      used += c.estHeight;
      continue;
    }
    const min = c.spec.minHeight?.(bundle, spec);
    if (min != null && used + min <= budget) {
      chosen.push({ ...c, compact: true, height: min });
      used += min;
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
    if (c.spec.id === "playbook" || c.spec.id === "leaderboard" || c.spec.id === "rejections") return 2;
    if (c.spec.id === "levels" || c.spec.id === "screen") return 3;
    return Math.min(total, 4);
  }
  return Math.min(total, spec.dense ? 4 : 6);
}

/** Parse an emphasis list from untrusted input (Largo's own spec block), dropping unknown ids. */
export function parseEmphasis(value: unknown): BlockId[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((v): v is BlockId => typeof v === "string" && v in BLOCK_BY_ID);
  return out.length ? out : null;
}
