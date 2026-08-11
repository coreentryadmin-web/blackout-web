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
    id: "PLAYBOOK",
    label: "Playbook",
    implemented: true,
    // AHEAD OF TRADE_RECAP DELIBERATELY. "tomorrow's plays", "the playbook", "tonight's edition"
    // all contain `play`/`entry`, so TRADE_RE swallows them — which is exactly what happened live,
    // producing a single-ticker recap for a five-play question. PLAYBOOK is the narrower claim
    // (a specific published edition) so it must be offered the question first.
    match:
      /\b(playbook|edition|tomorrow.?s? plays?|tonight.?s? plays?|the plays?|runbook|watch ?list|what (are|do) (we|you) (trading|playing|taking)|legacy plays?)\b/i,
    // At least one drawable play. Unlike a leaderboard there is no minimum of two: a one-play
    // edition is a real, publishable state and the card states the count, so it cannot mislead.
    sufficient: (b) => (b.playbook?.rows.length ?? 0) >= 1,
    needs: "a published edition with at least one play carrying entry, target or stop",
  },
  {
    id: "TRADE_RECAP",
    label: "Trade Recap",
    implemented: true,
    match: TRADE_RE,
    // A TRADE, not a PLAN — and the difference is what the row can say about its OUTCOME.
    //
    // The original gate was `entry != null`, on the reasoning that an open position is a
    // legitimate recap. That is true, but an open position still carries a live mark or a status.
    // A published play that has not been taken carries an entry premium and NOTHING else this
    // template reads, so it cleared the gate and rendered a frame of empty cells around one
    // number. Requiring any one outcome-side field separates the two without excluding the open
    // positions the card is meant to handle.
    sufficient: (b) =>
      !!b.trade && !!b.trade.entry && (!!b.trade.exit || !!b.trade.returnPct || !!b.trade.status),
    needs: "a committed trade with an entry AND a mark, return or status",
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
    id: "COUNTERFACTUAL",
    label: "Counterfactual",
    implemented: true,
    match:
      /\b(counterfactual|firewall|would have (happened|lost|won)|what did (it|the gate|the rules) (hold|stop|block)|guards? (held|cost|paid)|cost of (the )?(guard|firewall))\b/i,
    // AHEAD OF REJECTION DELIBERATELY. Both answer "what did we pass on", and REJECTION's `held`
    // keyword would otherwise swallow every counterfactual question. This is the strictly stronger
    // card — the same holds, GRADED — so when the graded evidence exists it must win.
    //
    // Both sides required: a counterfactual with only the avoided side is a highlight reel of a
    // guard, and `gradedCount` must be > 0 or nothing was actually measured.
    sufficient: (b) =>
      !!b.counterfactual &&
      b.counterfactual.gradedCount > 0 &&
      b.counterfactual.gradedCount <= b.counterfactual.heldCount &&
      !!b.counterfactual.losersAvoided &&
      !!b.counterfactual.winnersForgone,
    needs: "held plays graded on real bars, with BOTH the avoided and forgone sides",
  },
  {
    id: "GRADER_AGREEMENT",
    label: "Grader Agreement",
    implemented: true,
    match:
      /\b(grader|grading|agreement rate|agree with each other|cross.?check|audit(ed)?|how do (you|we) (know|verify)|independently verif)\b/i,
    // `comparable` must be a real, non-zero, non-inflated denominator: it cannot exceed the window
    // and cannot be smaller than the rows that agreed. A percentage against a broken denominator
    // is the exact way this measurement gets flattered.
    sufficient: (b) =>
      !!b.graderAgreement &&
      b.graderAgreement.comparable > 0 &&
      b.graderAgreement.comparable <= b.graderAgreement.totalPlays &&
      b.graderAgreement.agreed <= b.graderAgreement.comparable &&
      // Every disagreement must be enumerable. If the count implies more disagreements than there
      // are rows to show, the card would claim completeness it does not have.
      b.graderAgreement.rows.length >= b.graderAgreement.comparable - b.graderAgreement.agreed,
    needs: "a comparable population, an agreement count, and a row for every disagreement",
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

/**
 * COMPOSED is reachable but NOT in `TEMPLATES`, and that is deliberate.
 *
 * Every entry in `TEMPLATES` is offered to the intent matcher and to the fallback descent. COMPOSED
 * must be in neither: it would match nothing (it has no subject of its own) and it would win every
 * fallback (its sufficiency is one block), which would starve the designed templates that render
 * their subject better than a generic section can. It is selected explicitly at step 3, after the
 * designed layouts have had their chance, and by an explicit member pick.
 */
export const COMPOSED_SPEC: TemplateSpec = {
  id: "COMPOSED",
  label: "Composed",
  implemented: true,
  match: /$^/,
  sufficient: (b) => composableEvidenceCount(b) >= 2,
  needs: "at least two measurements the composer can draw",
};

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
    const hit = consider(
      preferred === "COMPOSED" ? COMPOSED_SPEC : IMPLEMENTED_TEMPLATES.find((t) => t.id === preferred),
      true
    );
    if (hit) return hit;
  }

  // 2. Intent, in registry order (most specific first).
  for (const spec of IMPLEMENTED_TEMPLATES) {
    if (!spec.match.test(q)) continue;
    const hit = consider(spec, true);
    if (hit) return hit;
  }

  // 3. BROAD EVIDENCE COMPOSES, before the designed descent gets a chance to narrow it.
  //
  // The descent below picks the first designed template the evidence can fill. When the evidence
  // is WIDE that is the wrong move by construction: every designed template draws one subject, so
  // whichever wins discards everything outside it.
  //
  // Measured on "Generate how TSLA looks today", with Helix flow, Thermal levels and regime,
  // Vector and a Night Hawk read all present — six evidence blocks. No intent matched, the
  // descent reached LEVEL_ANALYSIS (spot + levels, both present), and the card drew the levels
  // while discarding the consensus strip, the tape and the regime. The question was about all of
  // them.
  //
  // Four is the threshold because three is the most any designed template draws. At four or more
  // a single template is guaranteed to be leaving evidence on the floor, and composition is the
  // only thing that can use it. Below four the designed layouts win, and should: their geometry
  // carries honesty rules a generic section does not (the counterfactual's symmetric columns, the
  // leaderboard's fixed denominator).
  //
  // INTENT STILL OUTRANKS THIS. A question that names its subject has already been answered above.
  if (composableEvidenceCount(bundle) >= 4) {
    return { template: "COMPOSED", matchedIntent: false, rejected };
  }

  // 4. Fallback: a DESIGNED template the evidence can fill, in preference order.
  //
  // Kept, because a designed layout renders its own subject better than a generic section can —
  // the counterfactual's symmetric columns and the leaderboard's fixed denominator are honesty
  // mechanisms built into their geometry, not decoration.
  //
  // MARKET_MOVE IS EXCLUDED FROM THIS DESCENT and replaced by COMPOSED below. Its own registry
  // comment calls it "the most general and the most likely to be fillable, which makes it the
  // right last resort" — and COMPOSED is strictly the better version of that idea. Both are
  // "draw whatever the evidence supports"; MARKET_MOVE does it with a fixed arrangement of four
  // blocks, COMPOSED does it with whichever blocks this question and this evidence call for. A
  // question spanning five products ("how does TSLA look today") reached MARKET_MOVE here and got
  // a headline over two metrics, discarding the consensus strip, the levels and the tape it had.
  // MARKET_MOVE is still selected by INTENT — "why did SPX dump" is its question and it answers
  // it well — it is only no longer the thing that catches everything else.
  for (const spec of IMPLEMENTED_TEMPLATES) {
    if (spec.id === "MARKET_MOVE") continue;
    const hit = consider(spec, false);
    if (hit) return hit;
  }

  // 5. COMPOSE — the last resort, evidence-first.
  //
  // TWO EVIDENCE BLOCKS MINIMUM, and the headline does not count toward them.
  //
  // The first version of this gate asked for one drawable block of any kind, which quietly
  // repealed two guards the designed templates enforce: "one metric under a headline is a
  // decoration, not evidence" and "a level with no spot is a number floating in space". Both
  // would have composed — a verdict plus a single number — and a card is a claim about
  // MEASUREMENTS, so one measurement under a conclusion is a frame around an assertion.
  //
  // Counting only evidence also makes the gate honest about what it is measuring: a bundle
  // carrying nothing but a headline has no evidence at all, and no amount of composition changes
  // that.
  if (composableEvidenceCount(bundle) >= 2) {
    return { template: "COMPOSED", matchedIntent: false, rejected };
  }

  // 6. MARKET_MOVE, if COMPOSED could not reach its two-measurement bar but this can.
  //     Its sufficiency (a headline plus two supporting measurements) is a different shape from
  //     the composer's, so it is tried rather than assumed unreachable.
  {
    const hit = consider(IMPLEMENTED_TEMPLATES.find((t) => t.id === "MARKET_MOVE"), false);
    if (hit) return hit;
  }

  // 7. Nothing is drawable. Offering no visual is a valid outcome and the only honest one here.
  return null;
}

/**
 * How many EVIDENCE blocks this bundle can fill.
 *
 * The headline is deliberately absent from this list: it is the card's conclusion, not a
 * measurement, and counting it would let a bundle reach the threshold on a claim plus one number.
 *
 * Kept in the router rather than imported from `compose.ts` so the module stays free of the size
 * spec — composition needs a canvas, this check does not.
 */
function composableEvidenceCount(b: VisualBundle): number {
  const checks: boolean[] = [
    !!b.spot,
    !!b.regime,
    (b.levels?.length ?? 0) >= 1,
    (b.metrics?.length ?? 0) >= 1,
    (b.systemReads?.length ?? 0) >= 2,
    (b.gexShifts?.length ?? 0) >= 1,
    (b.gammaProfile?.rows.length ?? 0) >= 3,
    (b.flow?.rows.length ?? 0) >= 1,
    (b.playbook?.rows.length ?? 0) >= 1,
    (b.leaderboard?.rows.length ?? 0) >= 2,
    (b.screen?.rows.length ?? 0) >= 3,
    (b.rejections?.rows.length ?? 0) >= 2,
    (b.timeline?.length ?? 0) >= 2,
    !!b.session?.closeDisplay,
    (b.genericStats?.rows.length ?? 0) >= 3,
    (b.genericRanked?.rows.length ?? 0) >= 3,
    (b.genericEvents?.rows.length ?? 0) >= 2,
  ];
  return checks.filter(Boolean).length;
}
