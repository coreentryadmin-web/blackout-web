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
 * UNIMPLEMENTED TEMPLATES ARE NEVER SELECTED. The registry lists all ten from the brief so the
 * shape is visible, but `implemented: false` excludes a template from every code path — the three
 * built end-to-end are the only ones reachable. A half-built template selected by a keyword match
 * is exactly how a mediocre graphic ships.
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
 * names a specific number and is the narrowest claim; MARKET_MOVE trails the three because it is
 * the most general and the most likely to be fillable, which makes it the right last resort.
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
    id: "MARKET_MOVE",
    label: "Market Card",
    implemented: true,
    match: MOVE_RE,
    // Needs a headline conclusion plus at least two supporting measurements. One metric under a
    // headline is a claim with a decoration, not evidence.
    sufficient: (b) => !!b.headline && ((b.metrics?.length ?? 0) + (b.levels?.length ?? 0)) >= 2,
    needs: "a conclusion plus at least two supporting measurements",
  },

  // ── Registered, not yet built. Never selected while `implemented` is false. ──
  { id: "GAMMA_MAP", label: "Gamma Map", implemented: false, match: /\bgamma (map|profile)\b/i, sufficient: () => false, needs: "not yet implemented" },
  { id: "FLOW_RECAP", label: "Flow Recap", implemented: false, match: /\bflow recap\b/i, sufficient: () => false, needs: "not yet implemented" },
  { id: "TRADE_LEADERBOARD", label: "Leaderboard", implemented: false, match: /\b(best|top|leaderboard|ranked)\b/i, sufficient: () => false, needs: "not yet implemented" },
  { id: "SYSTEM_COMPARISON", label: "System Comparison", implemented: false, match: /\bcompare (systems|products)\b/i, sufficient: () => false, needs: "not yet implemented" },
  { id: "BEFORE_AFTER", label: "Before / After", implemented: false, match: /\b(changed|before|since|last \d+ minutes)\b/i, sufficient: () => false, needs: "not yet implemented" },
  { id: "SESSION_RECAP", label: "Session Recap", implemented: false, match: /\bsession recap\b|\btoday.s recap\b/i, sufficient: () => false, needs: "not yet implemented" },
  { id: "SIGNAL_TIMELINE", label: "Timeline", implemented: false, match: /\btimeline\b/i, sufficient: () => false, needs: "not yet implemented" },
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
