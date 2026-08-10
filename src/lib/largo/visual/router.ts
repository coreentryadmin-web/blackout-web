/**
 * VISUAL TEMPLATE ROUTER — question + evidence decide the layout.
 *
 * TWO GATES, AND THE SECOND ONE IS THE IMPORTANT ONE.
 *
 *   1. INTENT: what is the question asking for? ("why did SPX dump" → a market move; "how did
 *      Slayer catch it" → a trade recap; "what happened at 7800" → a level.)
 *   2. SUFFICIENCY: does the bundle actually CARRY what that template needs to draw?
 *
 * A router that only did (1) would confidently select TRADE_RECAP for "how did Slayer catch
 * today's move" on a day where no trade was committed, and the template would then render a
 * lifecycle with empty steps — a graphic implying a trade that never happened. So intent PROPOSES
 * and sufficiency DISPOSES: a template that cannot be filled is skipped, and the router falls back
 * down an ordered preference list to one that can. When nothing can be filled, it returns null and
 * the caller offers no visual at all. Refusing to draw is always available and always correct.
 *
 * UNIMPLEMENTED TEMPLATES ARE NEVER SELECTED. `implemented: false` excludes a template from every
 * code path, so a half-built template can never be reached by a keyword match — which is exactly
 * how a mediocre graphic ships. Every template in the registry is now built; the flag stays because
 * it is the mechanism that let the library grow three at a time without the unfinished ones
 * leaking into member-facing output.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import type { VisualBundle, VisualTemplateId } from "./types";

export type TemplateSpec = {
  id: VisualTemplateId;
  label: string;
  implemented: boolean;
  /** Question wording that proposes this template. */
  match: RegExp;
  /** Can this bundle actually fill the template? */
  sufficient: (b: VisualBundle) => boolean;
  /** What is missing, for the caller's explanation when nothing fits. */
  needs: string;
};

/** A level question names a number: "what happened at 7800", "did 7725 hold". */
const LEVEL_RE =
  /\b(at|around|near)\s+\$?\d[\d,.]{2,}|\b(level|wall|strike|support|resistance|gamma flip|max pain)\b|\b(hold|held|break|broke|reject|bounce)\b/i;

const TRADE_RE =
  /\b(trade|play|recap|entry|exit|catch|caught|position|ledger|committed|p&?l|pnl|return|how did .* (catch|do|perform))\b/i;

const MOVE_RE =
  /\b(why|what happened|dump|drop|rip|rally|sell.?off|spike|move|reversal|crash|squeeze|explain)\b/i;

/**
 * TEMPLATES, in fallback preference order — most specific first.
 *
 * Order matters twice: it is the tie-break when two intents match, and it is the descent order
 * when the proposed template is not sufficient. LEVEL_ANALYSIS leads because a level question
 * names a specific number and is the narrowest claim; MARKET_MOVE must stay LAST among the
 * implemented entries because it is the most general and the most likely to be fillable, which
 * makes it the right last resort and the wrong first guess. `router.test.ts` asserts that position
 * — inserting a template after it once broke the fallback silently, in the sense that every card
 * still rendered and the wrong one was chosen.
 */
export const TEMPLATES: TemplateSpec[] = [
  {
    id: "LEVEL_ANALYSIS",
    label: "Level Map",
    implemented: true,
    match: LEVEL_RE,
    // Needs a spot to anchor the map and at least one real level to draw against it. One level
    // with no spot is a number floating in space; spot with no levels is not a level analysis.
    sufficient: (b) => !!b.spot && (b.levels?.length ?? 0) >= 1,
    needs: "a spot price and at least one dealer level",
  },
  {
    id: "TRADE_RECAP",
    label: "Trade Recap",
    implemented: true,
    match: TRADE_RE,
    // Needs a real trade with an entry. Peak/exit may be absent (an open position is a legitimate
    // recap) but a lifecycle with no entry is not a trade.
    sufficient: (b) => !!b.trade && !!b.trade.entry,
    needs: "a committed trade with a recorded entry",
  },

  {
    id: "SCREENER",
    label: "Screener",
    implemented: true,
    match: /\b(screen(er)?|scan(ner)?|which names|nearest flip|most pinned|most explosive|ranked|top \d+)\b/i,
    // THREE rows minimum. Two names ordered by one metric is a comparison; calling it a market
    // screen overstates how much of the universe was actually looked at.
    sufficient: (b) => (b.screen?.rows.length ?? 0) >= 3,
    needs: "at least three ranked names from the universe snapshot",
  },
  {
    id: "REJECTION",
    label: "Rejections",
    implemented: true,
    match: /\b(reject(ed|ion|ions)?|passed on|held|skip(ped)?|gate|didn.t take|why not)\b/i,
    // Every row must name the gate that fired. A "we passed" with no rule behind it is a claim
    // about judgement, and this card exists to show a RULE.
    sufficient: (b) =>
      (b.rejections?.rows.length ?? 0) >= 2 && (b.rejections?.rows ?? []).every((r) => !!r.gateFailed),
    needs: "at least two gate-rejection rows, each naming the gate that fired",
  },
  {
    id: "EM_CONE",
    label: "Expected Move",
    implemented: true,
    match: /\b(expected move|em cone|cone|sigma|1σ|band|stay(ed)? inside|range day)\b/i,
    // Needs a REALISED path — an intraday render would imply a result that has not happened yet.
    // This is what makes it a post-close card by construction rather than by convention.
    sufficient: (b) => !!b.cone && b.cone.path.length >= 2 && b.cone.upper > b.cone.lower,
    needs: "an expected-move band plus the realised path (post-close only)",
  },

  {
    id: "GAMMA_MAP",
    label: "Gamma Map",
    implemented: true,
    match: /\bgamma (map|profile|distribution)\b|\bwhere is (the )?gamma\b|\bgamma stacked\b/i,
    // FIVE strikes minimum. A gamma PROFILE's claim is about the shape of the book; three bars is
    // a bar chart of three numbers and LEVEL_ANALYSIS already draws named levels better.
    sufficient: (b) => (b.gammaProfile?.rows.length ?? 0) >= 5,
    needs: "at least five strikes of dealer gamma exposure",
  },
  {
    id: "FLOW_RECAP",
    label: "Flow Recap",
    implemented: true,
    match: /\bflow recap\b|\b(premium|sweep|sweeps|tape|prints?)\b|\bwho.s buying\b/i,
    // Rows AND a gross total. Rows without the totals would present a sample as the whole tape.
    sufficient: (b) => (b.flow?.rows.length ?? 0) >= 3 && !!b.flow?.grossDisplay,
    needs: "at least three tape prints plus the window's premium totals",
  },
  {
    id: "TRADE_LEADERBOARD",
    label: "Leaderboard",
    implemented: true,
    match: /\b(leaderboard|best trades?|top trades?|track record|how did .* do this (week|month)|results)\b/i,
    // The denominator must exist and must be consistent: `graded` cannot be smaller than the rows
    // being shown, or the card would print "3 of 2 graded trades". Two rows minimum, because one
    // row ranked against nothing is a TRADE_RECAP wearing a leaderboard's frame.
    sufficient: (b) =>
      !!b.leaderboard &&
      b.leaderboard.rows.length >= 2 &&
      b.leaderboard.graded >= b.leaderboard.rows.length &&
      b.leaderboard.wins + b.leaderboard.losses <= b.leaderboard.graded,
    needs: "at least two graded trades plus the full graded/win/loss tally",
  },
  {
    id: "SYSTEM_COMPARISON",
    label: "System Comparison",
    implemented: true,
    match: /\bcompare (systems|products|tools)\b|\bdo (they|the systems) agree\b|\bagree|disagree|consensus|conflict(ing)?\b/i,
    // THREE systems. Two systems agreeing or disagreeing is a pair, not a consensus, and the
    // verdict vocabulary ("DIVIDED", "AGREEMENT") overstates what two reads can establish.
    sufficient: (b) => (b.systemReads?.length ?? 0) >= 3,
    needs: "directional reads from at least three systems",
  },
  {
    id: "BEFORE_AFTER",
    label: "Before / After",
    implemented: true,
    match: /\b(what changed|changed since|before and after|since (the )?(open|last)|last \d+ (min(ute)?s?|hours?))\b/i,
    // BOTH endpoint labels are required — a change card with one timestamp cannot be checked.
    sufficient: (b) =>
      (b.beforeAfter?.rows.length ?? 0) >= 2 && !!b.beforeAfter?.beforeLabel && !!b.beforeAfter?.afterLabel,
    needs: "at least two measurements captured at two labelled instants",
  },
  {
    id: "SESSION_RECAP",
    label: "Session Recap",
    implemented: true,
    match: /\bsession recap\b|\btoday.s recap\b|\bhow did (the )?(day|session) (go|end)\b|\bclose(d)? (today|the day)\b/i,
    // A settled close is what makes this a recap rather than a forecast. All four OHLC displays
    // are required because the card's geometry is the relationship between them.
    sufficient: (b) =>
      !!b.session?.closeDisplay && !!b.session?.openDisplay && !!b.session?.highDisplay && !!b.session?.lowDisplay,
    needs: "a settled session open/high/low/close (post-close only)",
  },
  {
    id: "SIGNAL_TIMELINE",
    label: "Timeline",
    implemented: true,
    match: /\btimeline\b|\bin what order\b|\bsequence\b|\bwhat happened (first|next|when)\b|\bplay.?by.?play\b/i,
    // FOUR steps. Three is a lifecycle, and TRADE_RECAP renders that better inside its own frame.
    sufficient: (b) => (b.timeline?.length ?? 0) >= 4,
    needs: "at least four recorded events with real timestamps",
  },
  {
    id: "MARKET_MOVE",
    label: "Market Card",
    implemented: true,
    match: MOVE_RE,
    // Needs a headline conclusion plus at least two supporting measurements. One metric under a
    // headline is a claim with a decoration, not evidence.
    sufficient: (b) => !!b.headline && ((b.metrics?.length ?? 0) + (b.levels?.length ?? 0)) >= 2,
    needs: "a conclusion plus at least two supporting measurements",
  },
];

export const IMPLEMENTED_TEMPLATES = TEMPLATES.filter((t) => t.implemented);

export type RouteResult = {
  template: VisualTemplateId;
  /** True when the question's own wording proposed this template, false when it was reached by
   *  fallback. Surfaced in the preview so a member can see the router was not certain. */
  matchedIntent: boolean;
  /** Templates the intent proposed but the evidence could not fill. */
  rejected: { template: VisualTemplateId; needs: string }[];
};

/**
 * Choose a template for a question + bundle. Returns null when NOTHING can be honestly drawn.
 *
 * `preferred` is the member's explicit pick from the preview ("Trade Recap" rather than "Auto").
 * It still passes through the sufficiency gate: an explicit choice is a request, not an override
 * of whether the data exists. When a preferred template cannot be filled, the router falls back
 * and reports it in `rejected` so the UI can say why the pick was not honoured.
 */
export function routeVisual(
  question: string,
  bundle: VisualBundle,
  preferred?: VisualTemplateId | "AUTO" | null
): RouteResult | null {
  const rejected: { template: VisualTemplateId; needs: string }[] = [];
  const q = question ?? "";

  const consider = (spec: TemplateSpec | undefined, matchedIntent: boolean): RouteResult | null => {
    if (!spec || !spec.implemented) return null;
    if (!spec.sufficient(bundle)) {
      if (!rejected.some((r) => r.template === spec.id)) rejected.push({ template: spec.id, needs: spec.needs });
      return null;
    }
    return { template: spec.id, matchedIntent, rejected };
  };

  // 1. An explicit pick is tried first — but still gated.
  if (preferred && preferred !== "AUTO") {
    const hit = consider(IMPLEMENTED_TEMPLATES.find((t) => t.id === preferred), true);
    if (hit) return hit;
  }

  // 2. Intent, in registry order (most specific first).
  for (const spec of IMPLEMENTED_TEMPLATES) {
    if (!spec.match.test(q)) continue;
    const hit = consider(spec, true);
    if (hit) return hit;
  }

  // 3. Fallback: anything the evidence CAN fill, same preference order.
  for (const spec of IMPLEMENTED_TEMPLATES) {
    const hit = consider(spec, false);
    if (hit) return hit;
  }

  // 4. Nothing is drawable. Offering no visual is a valid outcome and the only honest one here.
  return null;
}
