import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCKS,
  composeCard,
  composeForRender,
  dropDuplicateFacts,
  blockGap,
  heightBudget,
  levelOnSameScale,
  parseEmphasis,
  scoreBlock,
  subjectFirst,
  type BlockId,
} from "./compose";
import { detectVisualIntent, questionSubject } from "./intent";
import { balancedBySide } from "./templates/composed";
import { sizeSpec } from "./sizes";
import type { VisualBundle } from "./types";
import { FIXTURE_QUESTION, richFixtureBundle } from "./fixture-bundle";

/**
 * COMPOSITION — the engine that builds a layout instead of picking one.
 *
 * These assert the ORDERING AND HONESTY INVARIANTS, not the tuning constants. `MATCH_BOOST` and
 * `DENSITY_WEIGHT` will move; "a block the question asked for outranks a merely-dense one" and
 * "truncation is reported" are the contract.
 */

const base: VisualBundle = { systemsQueried: ["THERMAL"], asOf: "2026-08-11T15:42:00Z" };

const rich: VisualBundle = {
  ...base,
  ticker: "TSLA",
  headline: "TSLA is coiled under the 355 call wall",
  spot: { value: 348.22, display: "348.22", source: "THERMAL" },
  regime: { label: "SHORT GAMMA", source: "THERMAL" },
  systemReads: [
    { system: "HELIX", stance: "bullish", detail: "+$18.4M" },
    { system: "THERMAL", stance: "regime", detail: "short gamma" },
    { system: "VECTOR", stance: "bullish", detail: "above OR" },
  ],
  levels: [
    { label: "Call wall", price: 355, display: "355.00", kind: "resistance", source: "THERMAL" },
    { label: "Put wall", price: 330, display: "330.00", kind: "support", source: "THERMAL" },
  ],
  flow: {
    windowLabel: "last 60 min",
    netDisplay: "+$18.4M",
    grossDisplay: "$44.1M",
    callShare: 0.71,
    printCount: 38,
    rows: [
      { ticker: "TSLA", side: "call", premiumDisplay: "$8.2M" },
      { ticker: "TSLA", side: "call", premiumDisplay: "$4.1M" },
      { ticker: "TSLA", side: "put", premiumDisplay: "$2.9M" },
    ],
  },
  metrics: [{ label: "IV rank", value: "38", source: "THERMAL" }],
};

// ── Selection is question-driven ────────────────────────────────────────────────────────────

test("the SAME evidence composes DIFFERENT cards for different questions", () => {
  const spec = sizeSpec("x_landscape");
  const flowCard = composeCard({ question: "what does the flow look like on TSLA", bundle: rich, spec });
  const levelCard = composeCard({ question: "where is the TSLA call wall", bundle: rich, spec });

  const flowRank = flowCard.blocks.findIndex((b) => b.id === "flow_tape");
  const levelRank = levelCard.blocks.findIndex((b) => b.id === "levels");
  assert.ok(flowRank >= 0, "a flow question must draw the flow block");
  assert.ok(levelRank >= 0, "a level question must draw the level block");

  // The distinguishing assertion: not merely that both appear, but that each question SELECTED
  // its own subject. Identical block sets for both questions would mean the composer is a
  // template wearing a different name.
  assert.notDeepEqual(
    flowCard.blocks.map((b) => b.id),
    levelCard.blocks.map((b) => b.id),
    "two different questions over one bundle must not compose the identical card",
  );
});

test("a block the question ASKED FOR outranks a merely-dense one", () => {
  const q = "what does the flow look like";
  const flow = scoreBlock(BLOCKS.find((b) => b.id === "flow_tape")!, q, rich);
  const levels = scoreBlock(BLOCKS.find((b) => b.id === "levels")!, q, rich);
  assert.ok(flow.matchedIntent, "flow must match a flow question");
  assert.ok(!levels.matchedIntent);
  assert.ok(flow.weight > levels.weight, "intent must beat intrinsic priority");
});

test("a cross-product question reaches for the consensus strip", () => {
  for (const q of ["how does TSLA look today", "what does NVDA look like", "give me an overview of TSLA"]) {
    const spec = sizeSpec("x_portrait");
    const c = composeCard({ question: q, bundle: rich, spec });
    assert.ok(c.blocks.some((b) => b.id === "consensus"), `"${q}" must draw what each system sees`);
  }
});

test("the verdict leads regardless of what the question asked", () => {
  // Selection is by relevance; READING ORDER is by intrinsic priority. A card whose sections
  // appear in relevance order reads as a ranked list rather than as a brief.
  const c = composeCard({ question: "what does the flow look like", bundle: rich, spec: sizeSpec("x_portrait") });
  assert.equal(c.blocks[0]!.id, "verdict");
});

// ── The honesty spine survives the dynamic layer ────────────────────────────────────────────

test("emphasis can REORDER but can never CONJURE a block", () => {
  // The single most important property of letting a model steer this. Emphasis is applied after
  // availability, so a hallucinated block id changes nothing.
  const c = composeCard({
    question: "anything",
    bundle: base, // carries no evidence at all
    spec: sizeSpec("story"),
    emphasis: ["playbook", "leaderboard", "counterfactual", "flow_tape"],
  });
  assert.deepEqual(c.blocks, [], "emphasis on absent evidence draws nothing");
});

test("emphasis DOES lift a block that the evidence supports", () => {
  const spec = sizeSpec("x_landscape");
  const without = composeCard({ question: "tell me about TSLA", bundle: rich, spec });
  const withIt = composeCard({ question: "tell me about TSLA", bundle: rich, spec, emphasis: ["flow_tape"] });
  const rank = (c: typeof without) => c.blocks.findIndex((b) => b.id === "flow_tape");
  assert.ok(rank(withIt) >= 0, "an emphasised, available block must be drawn");
  assert.ok(withIt.blocks.find((b) => b.id === "flow_tape")!.weight > (without.blocks.find((b) => b.id === "flow_tape")?.weight ?? 0));
});

test("unknown emphasis ids are dropped rather than trusted", () => {
  assert.deepEqual(parseEmphasis(["flow_tape", "not_a_block", 7, null]), ["flow_tape"]);
  assert.equal(parseEmphasis("flow_tape"), null);
  assert.equal(parseEmphasis([]), null);
});

test("an empty bundle composes NOTHING — no frame around no evidence", () => {
  const c = composeCard({ question: "how does TSLA look", bundle: base, spec: sizeSpec("story") });
  assert.deepEqual(c.blocks, []);
});

// ── Packing ─────────────────────────────────────────────────────────────────────────────────

test("the packer never exceeds its budget", () => {
  for (const id of ["x_landscape", "x_portrait", "square", "story"] as const) {
    const spec = sizeSpec(id);
    const c = composeCard({ question: "how does TSLA look today", bundle: rich, spec });
    assert.ok(c.used <= c.budget, `${id}: used ${c.used} > budget ${c.budget}`);
  }
});

test("a tall block that does not fit does NOT veto the shorter blocks behind it", () => {
  // With `break` instead of `continue`, one oversized block would take the whole remaining budget
  // with it and leave the canvas blank below.
  const spec = sizeSpec("x_landscape");
  const c = composeCard({ question: "how does TSLA look today", bundle: rich, spec });
  assert.ok(c.blocks.length >= 3, "short blocks must still be reachable past a dropped tall one");
});

test("dropped blocks are REPORTED, never silently lost", () => {
  const c = composeCard({ question: "how does TSLA look today", bundle: rich, spec: sizeSpec("x_landscape") });
  for (const d of c.dropped) {
    assert.ok(d.label, "every dropped block must be nameable on the card");
    assert.equal(d.reason, "no_room");
  }
  // And a dropped block is never also drawn.
  const drawn = new Set(c.blocks.map((b) => b.id));
  for (const d of c.dropped) assert.ok(!drawn.has(d.id), `${d.id} both drawn and dropped`);
});

test("a block is DEGRADED before it is dropped", () => {
  // Measured: on a landscape TSLA card the flow block (244px) did not fit the 219px remaining and
  // was dropped, while the substitutable metric rail (110px) fitted and was kept. Elasticity is
  // what makes the packer trade rows instead of whole blocks.
  //
  // ASSERTED ON THE STORY SURFACE, and the move is the point. This used to assert the tape survived
  // on a 630px LANDSCAPE, which it did — at an estimate of 128px compact. Rendering the block and
  // measuring it (`scripts/audit/largo-card-deadspace.mjs`) put its real drawn height at ~375px, so
  // that "survival" was the packer fitting a block that would have run into the pinned footer. The
  // honest heights make landscape too small for the tape and story large enough to degrade it,
  // which is exactly the behaviour this test exists to protect.
  const c = composeCard({ question: "how does TSLA look today", bundle: rich, spec: sizeSpec("story") });
  assert.ok(c.blocks.some((b) => b.id === "flow_tape"), "the tape must survive, compact if necessary");

  // And with a tape too tall to fit whole, it is DEGRADED rather than dropped — the actual claim.
  const dense = composeCard({ question: FIXTURE_QUESTION, bundle: richFixtureBundle(), spec: sizeSpec("story") });
  const tape = dense.blocks.find((b) => b.id === "flow_tape");
  assert.ok(tape, "a tape that cannot fit whole must still appear");
  assert.equal(tape!.compact, true, "it survives by being degraded, not by being dropped");
});

test("a shrunk block carries the row budget it was CHARGED for", () => {
  const c = composeCard({ question: "how does TSLA look today", bundle: rich, spec: sizeSpec("x_landscape") });
  for (const b of c.blocks) {
    if (b.compact || b.rowBudget != null) {
      assert.ok(b.rowBudget == null || b.rowBudget >= 1, "a costed row budget must be drawable");
    }
  }
});

test("the budget reserves the footer, which carries the mandatory disclaimer", () => {
  for (const id of ["x_landscape", "story"] as const) {
    const spec = sizeSpec(id);
    assert.ok(heightBudget(spec) * spec.scale < spec.height - spec.footer, `${id} must not spend the footer`);
  }
});

// ── Flow truncation must not become a directional claim ─────────────────────────────────────

test("truncating the tape keeps BOTH sides — the highlight-reel guard", () => {
  // Rows arrive premium-ordered, which on a bullish tape puts every call ahead of every put. A
  // cap of two then shows two call sweeps under a "+$18.4M net" headline with the put flow
  // invisible: technically the top two prints, and a directional claim the tape does not support.
  const rows = [
    { side: "call" as const, id: 1 },
    { side: "call" as const, id: 2 },
    { side: "call" as const, id: 3 },
    { side: "put" as const, id: 4 },
  ];
  const kept = balancedBySide(rows, 2);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((r) => r.side === "put"), "the put side must survive the cap");
});

test("a genuinely one-sided tape still fills the card", () => {
  // Balance must not mean padding: with no puts to show, the calls take the whole budget.
  const rows = [1, 2, 3].map((id) => ({ side: "call" as const, id }));
  assert.equal(balancedBySide(rows, 3).length, 3);
});

// ── Auto-generation intent ──────────────────────────────────────────────────────────────────

test("an explicit request generates without asking", () => {
  for (const q of [
    "Create a image for tomorrow NH plays",
    "generate an image for todays top 5 performing 0dte board plays",
    "make me a card for TSLA",
    "build a graphic showing the SPX levels",
  ]) {
    assert.equal(detectVisualIntent(q).wanted, true, `"${q}" must auto-generate`);
    assert.equal(detectVisualIntent(q).kind, "explicit");
  }
});

test("an incidental request generates too", () => {
  for (const q of ["how does TSLA look — post this on X", "SPX levels, something I can share"]) {
    assert.equal(detectVisualIntent(q).wanted, true, `"${q}" must auto-generate`);
  }
});

test("a question that merely COULD have a card does not auto-generate", () => {
  // Rendering every answer would spend a satori render on most turns and put an unrequested asset
  // under an answer that was fine as prose.
  for (const q of [
    "how does TSLA look today",
    "what is the SPX gamma flip",
    "the image shows dealers short gamma",
    "what does the chart say about NVDA",
  ]) {
    assert.equal(detectVisualIntent(q).wanted, false, `"${q}" must NOT auto-generate`);
  }
});

test("the named platform picks the aspect", () => {
  assert.equal(detectVisualIntent("make a card for my instagram story").size, "story");
  assert.equal(detectVisualIntent("generate an image for instagram").size, "square");
  assert.equal(detectVisualIntent("create an image for tomorrow's plays").size, "x_landscape");
});

test("the request framing is stripped before composition scores the question", () => {
  // "card" and "post" collide with the trade and flow vocabularies, so the framing can outvote
  // the subject if it reaches the composer.
  const subject = questionSubject("Create an image for todays top 5 performing 0dte board plays");
  assert.ok(!/create|image/i.test(subject), `framing survived: "${subject}"`);
  assert.match(subject, /top 5 performing 0dte board plays/i, "the subject must survive intact");
});

// ── Routing: when does composition beat a designed template? ────────────────────────────────

test("BROAD evidence composes; NARROW evidence keeps its designed card", async () => {
  const { routeVisual } = await import("./router");

  // Six evidence blocks and no intent match. The descent would have reached LEVEL_ANALYSIS
  // (spot + levels, both present) and drawn the levels while discarding the consensus strip,
  // the tape and the regime — on a question that was about all of them.
  assert.equal(routeVisual("Generate how TSLA looks today", rich)!.template, "COMPOSED");

  // Two evidence blocks, one subject. The designed leaderboard renders this better than a generic
  // section can: its geometry pins the graded/wins/losses denominator, which is an honesty rule
  // rather than a layout choice.
  const narrow: VisualBundle = {
    ...base,
    headline: "Five green out of nine graded",
    leaderboard: {
      source: "NIGHT HAWK",
      windowLabel: "today",
      graded: 9,
      wins: 5,
      losses: 4,
      winRateDisplay: "55.6%",
      rows: [
        { ticker: "SPXW", returnValue: 112, returnDisplay: "+112.0%" },
        { ticker: "NVDA", returnValue: 88.4, returnDisplay: "+88.4%" },
      ],
    },
    metrics: [{ label: "Board size", value: "9", source: "NIGHT HAWK" }],
  };
  assert.equal(routeVisual("todays top 5 performing 0dte board plays", narrow)!.template, "TRADE_LEADERBOARD");
});

test("INTENT still outranks composition — a named subject keeps its designed card", async () => {
  const { routeVisual } = await import("./router");
  // `rich` is broad enough to compose, but a question that names its subject has already been
  // answered by a layout designed for it.
  assert.equal(routeVisual("where is the TSLA call wall", rich)!.template, "LEVEL_ANALYSIS");
});

test("a bare headline plus one number is still REFUSED", async () => {
  const { routeVisual } = await import("./router");
  // The composer must not repeal "one metric under a headline is a decoration, not evidence".
  const thin: VisualBundle = { ...base, headline: "SPX is bid", metrics: [{ label: "VIX", value: "14.8", source: "THERMAL" }] };
  assert.equal(routeVisual("make me a card", thin), null);
});

// ── Cross-instrument contamination — a failure COMPOSITION introduced ───────────────────────

test("a level from a DIFFERENT instrument is never drawn against this spot", () => {
  // A turn that touched both names — "compare TSLA to SPX", or an NH answer naming several.
  // A designed template was narrow by construction and could not do this; a composed card draws
  // whatever the bundle carries, so the guard has to live below the templates.
  const tslaSpot = 348.22;
  assert.equal(levelOnSameScale(355, tslaSpot), true, "TSLA's own call wall");
  assert.equal(levelOnSameScale(330, tslaSpot), true, "TSLA's own put wall");
  // SPX. Real numbers, and stacking them above a 348 spot would label the arrangement a dealer
  // ladder — every value true, the relationship between them fiction.
  assert.equal(levelOnSameScale(7800, tslaSpot), false, "an SPX wall must not draw against TSLA spot");
  assert.equal(levelOnSameScale(7725, tslaSpot), false);
  // And the reverse pairing, which is the same bug with the instruments swapped.
  assert.equal(levelOnSameScale(355, 7757.58), false, "a TSLA wall must not draw against SPX spot");
});

test("with no spot to anchor against, nothing is excluded", () => {
  // There is nothing to compare to. A map with no anchor is a different problem, handled by the
  // level block's own sufficiency gate rather than by silently emptying the map here.
  assert.equal(levelOnSameScale(7800, null), true);
  assert.equal(levelOnSameScale(7800, undefined), true);
  assert.equal(levelOnSameScale(7800, 0), true);
});

test("a distant-but-real level is KEPT — the guard must not overshoot", () => {
  // A put wall 15% away is ordinary. Only a different PRICE SCALE is excluded, and the 3x
  // threshold sits far outside any real dealer level.
  const wide: VisualBundle = {
    ...base,
    spot: { value: 100, display: "100.00", source: "THERMAL" },
    levels: [
      { label: "Far put wall", price: 62, display: "62.00", kind: "support", source: "THERMAL" },
      { label: "Far call wall", price: 190, display: "190.00", kind: "resistance", source: "THERMAL" },
    ],
  };
  const c = composeCard({ question: "where are the walls", bundle: wide, spec: sizeSpec("story") });
  assert.ok(c.blocks.some((b) => b.id === "levels"));
});

/**
 * FACT DE-DUPLICATION.
 *
 * Measured on a live NVDA card: the dealer posture appeared three times (regime block, consensus
 * strip, metric tile) and the net premium three times alongside it. Individually correct, sourced,
 * and impossible to spot in review — which is why it needs a test rather than a style note.
 */

const duped: VisualBundle = {
  ...base,
  ticker: "NVDA",
  headline: "NVDA is pinned under 180",
  regime: { label: "SHORT GAMMA", source: "THERMAL" },
  flow: { rows: [{ label: "NVDA 180C", value: "+$4.1M" }], net: 18_400_000, gross: 40_000_000, count: 62 },
  systemReads: [
    { system: "HELIX", stance: "bullish", detail: "+$18.4M", fact: "net_premium" },
    { system: "THERMAL", stance: "regime", detail: "short gamma", fact: "gamma_posture" },
    { system: "VECTOR", stance: "bullish", detail: "above OR" },
  ],
  metrics: [
    { label: "Net premium", value: "+$18.4M", source: "HELIX", fact: "net_premium" },
    { label: "Dealer gamma", value: "SHORT", source: "THERMAL", fact: "gamma_posture" },
    { label: "IV rank", value: "62", source: "THERMAL" },
  ],
};

test("the most SPECIFIC chosen block keeps the fact; the rest drop it", () => {
  const out = dropDuplicateFacts(duped, new Set<BlockId>(["regime", "flow_tape", "consensus", "metrics"]));
  // regime outranks consensus outranks metrics for the posture; flow_tape outranks both for premium.
  assert.deepEqual(out.systemReads?.map((r) => r.system), ["VECTOR"]);
  assert.deepEqual(out.metrics?.map((m) => m.label), ["IV rank"]);
});

test("an UNTAGGED row asserts nothing shared and is never dropped", () => {
  const out = dropDuplicateFacts(duped, new Set<BlockId>(["regime", "flow_tape", "metrics"]));
  assert.ok(out.metrics?.some((m) => m.label === "IV rank"), "untagged metric must survive");
  assert.ok(out.systemReads?.some((r) => r.system === "VECTOR"), "untagged read must survive");
});

test("a fact whose owners are ALL absent is left alone, never deleted", () => {
  // The one outcome worse than showing a number twice is showing it zero times while the answer's
  // prose refers to it. With neither regime nor flow_tape nor consensus on the card, the metric
  // rail is the last place the member can read either number.
  const out = dropDuplicateFacts(duped, new Set<BlockId>(["metrics"]));
  assert.deepEqual(out.metrics?.map((m) => m.label), ["Net premium", "Dealer gamma", "IV rank"]);
});

test("de-duplication does not MUTATE the caller's bundle", () => {
  // The renderer composes twice; the first pass must see untouched evidence.
  const before = duped.metrics?.length;
  dropDuplicateFacts(duped, new Set<BlockId>(["regime", "flow_tape", "metrics"]));
  assert.equal(duped.metrics?.length, before);
});

test("composeForRender never trades a repeated number for BLANK CANVAS", () => {
  // THE MEASUREMENT THAT KILLED THE FIRST VERSION OF THIS FIX. Unconditional de-duplication is the
  // obviously-correct rule and it made the card worse: on this bundle it went from 478px of a 520px
  // budget to 374px, because the height freed by dropping two rows had no unshown evidence to grow
  // into. A fifth of the canvas left blank reads as broken just as readily as a doubled figure.
  const spec = sizeSpec("x_landscape");
  const plain = composeCard({ question: "how does NVDA look", bundle: duped, spec, emphasis: null });
  const { composition } = composeForRender({ question: "how does NVDA look", bundle: duped, spec, emphasis: null });
  assert.ok(
    composition.used >= plain.used - spec.height * 0.02,
    `de-duplication surrendered canvas: ${plain.used} -> ${composition.used} of ${composition.budget}`,
  );
});

test("de-duplication only happens when the canvas does not pay for it", () => {
  // THE INVARIANT, NOT THE OUTCOME. This used to assert that NOTHING was de-duplicated on this
  // bundle — true under the old block heights, where every tier lost canvas. With heights corrected
  // against what the blocks actually draw, the aggressive tier now costs nothing here and correctly
  // wins, so the old assertion was locking in a consequence of the mis-estimation rather than a
  // rule. The rule is: whatever tier is chosen, it must not surrender canvas to do it.
  const spec = sizeSpec("x_landscape");
  const plain = composeCard({ question: "how does NVDA look", bundle: duped, spec, emphasis: null });
  const { bundle, composition } = composeForRender({ question: "how does NVDA look", bundle: duped, spec, emphasis: null });
  assert.ok(
    composition.used >= plain.used - spec.height * 0.02,
    `de-duplication surrendered canvas: ${plain.used} -> ${composition.used}`,
  );
  // And it can only ever REMOVE repeats — never invent or reorder evidence.
  assert.ok((bundle.metrics?.length ?? 0) <= (duped.metrics?.length ?? 0));
});

test("when there IS more evidence to show, the freed height buys rows", () => {
  // Same duplication, but with levels the packer was truncating. Here full de-duplication costs
  // nothing, so the aggressive tier wins on its own merits rather than by fiat.
  const spec = sizeSpec("x_landscape");
  const withRows: VisualBundle = {
    ...duped,
    levels: Array.from({ length: 9 }, (_, i) => ({
      label: `Strike ${5800 + i * 25}`,
      price: 5800 + i * 25,
      kind: "wall" as const,
      source: "THERMAL" as const,
    })),
  };
  const { bundle } = composeForRender({ question: "NVDA levels and flow", bundle: withRows, spec, emphasis: null });
  assert.ok((bundle.metrics?.length ?? 0) < (duped.metrics?.length ?? 0), "duplicates must be gone");
});

test("a bundle with nothing TAGGED comes back untouched", () => {
  // `rich`'s rows carry no `fact`, so no tier can remove anything and every candidate composes the
  // same card. Asserted on CONTENT, not identity: the walk builds a shallow copy per tier and may
  // legitimately return one of those copies.
  const spec = sizeSpec("x_landscape");
  const { composition, bundle } = composeForRender({ question: "SPX levels", bundle: rich, spec, emphasis: null });
  assert.deepEqual(bundle.systemReads, rich.systemReads);
  assert.deepEqual(bundle.metrics, rich.metrics);
  assert.ok(composition.blocks.length > 0);
});

test("a fact is never lost — the least-specific rendering survives when the owners do not", () => {
  // The failure mode worth guarding: a card that drops "SHORT GAMMA" everywhere because the regime
  // block did not fit. The keeper resolves against CHOSEN blocks, so with no owner on the card the
  // fact is left exactly where it was.
  const out = dropDuplicateFacts(duped, new Set<BlockId>(["metrics"]), "all");
  assert.ok(out.metrics?.some((m) => m.fact === "gamma_posture"), "posture must survive somewhere");
  assert.ok(out.metrics?.some((m) => m.fact === "net_premium"), "net premium must survive somewhere");
});

/**
 * ESTIMATES ARE NOW ACCOUNTABLE TO PIXELS.
 *
 * The packer works from per-block height ESTIMATES, and until 2026-08-11 nothing had ever compared
 * one of them to what satori draws. Two were wrong by roughly 2×: `verdict` priced a 3-line
 * headline as 4 lines of the wrong height (354 est / 259 drawn), and `playbook` priced a row at
 * 128px that draws at ~48px (290 est / 146 drawn for two plays). A third, `flow_tape`, was wrong in
 * the dangerous direction — 302 est against 375 drawn, i.e. a block packed at a size that would run
 * into the pinned footer.
 *
 * The visible result was a card printing "ALSO MEASURED, NO ROOM ON THIS CARD: …" above a quarter
 * of blank canvas. Both statements cannot be true, and the member sees the contradiction.
 *
 * The numbers below are MEASURED, by rendering one block at a time and scanning the PNG:
 *   node --import tsx scripts/audit/largo-card-deadspace.mjs --calibrate
 *
 * Drawn values include the section gap the packer now charges separately (`blockGap`), so an
 * estimate slightly UNDER its drawn figure is correct. The tolerance catches the failure that
 * actually happened — an estimate off by a factor — not the last few pixels of leading.
 */
const DRAWN_PX: Record<string, Record<string, number>> = {
  x_portrait: { verdict: 259, spot: 132, consensus: 132, regime: 90, levels: 307, playbook: 146, flow_tape: 395, gamma_profile: 145, metrics: 130 },
  x_landscape: { verdict: 144, spot: 109, consensus: 119, regime: 79, levels: 279, playbook: 121, flow_tape: 374, gamma_profile: 131, metrics: 116 },
};

test("every block's height estimate matches what it actually draws", () => {
  const bundle = richFixtureBundle();
  for (const [size, drawnBySize] of Object.entries(DRAWN_PX)) {
    const spec = sizeSpec(size);
    for (const [id, drawn] of Object.entries(drawnBySize)) {
      const block = BLOCKS.find((b) => b.id === id);
      assert.ok(block, `${id} must still exist`);
      assert.ok(block!.available(bundle), `${id} must be fillable by the fixture, or it measures nothing`);
      const est = block!.height(bundle, spec);
      const ratio = drawn / est;
      assert.ok(
        ratio >= 0.85 && ratio <= 1.35,
        `${size}/${id}: estimated ${est}px, draws ${drawn}px (ratio ${ratio.toFixed(2)}) — re-run the calibration harness`,
      );
    }
  }
});

test("the packer charges for the space BETWEEN blocks", () => {
  // It did not, which is an UNDER-estimate: five blocks on a portrait card consume 80px of section
  // margin that the budget never knew about, and the block that overflows is the last one packed.
  const spec = sizeSpec("x_portrait");
  const bundle = richFixtureBundle();
  const c = composeCard({ question: FIXTURE_QUESTION, bundle, spec });
  const blockSum = c.blocks.reduce((n, b) => n + b.estHeight, 0);
  assert.ok(c.blocks.length >= 2, "needs a multi-block card to have any gap at all");
  assert.equal(c.used, blockSum + blockGap(spec) * (c.blocks.length - 1));
});

/**
 * SUBJECT RELEVANCE — the live NVDA card drew a playbook of NET, NVDA and CRM.
 *
 * Every row was real and the block was correctly chosen; two of the three had nothing to do with
 * the question. The composer ranks BLOCKS by relevance and then draws each block's ROWS in whatever
 * order the engine published, so a question about one name gets the whole edition's top of book.
 */
const PB = (...tickers: string[]) => tickers.map((ticker, i) => ({ ticker, rank: i + 1 }));

test("the subject's play is promoted only when the cap would have cut it", () => {
  const rows = PB("NET", "NVDA", "CRM", "AXON", "UBER");
  // Cap 2: NVDA is at index 1 and already drawn, so the published order must stand.
  assert.deepEqual(subjectFirst(rows, "NVDA", 2), rows);
  // Cap 1: NVDA would be invisible on a card generated for a question about NVDA.
  assert.deepEqual(
    subjectFirst(rows, "NVDA", 1).map((r) => r.ticker),
    ["NVDA", "NET", "CRM", "AXON", "UBER"],
  );
});

test("promotion is a stable partition — it never re-ranks or drops", () => {
  const rows = PB("NET", "CRM", "AXON", "NVDA", "UBER", "NVDA");
  const out = subjectFirst(rows, "nvda", 2);
  assert.equal(out.length, rows.length, "no row may be lost");
  assert.deepEqual(out.map((r) => r.ticker), ["NVDA", "NVDA", "NET", "CRM", "AXON", "UBER"]);
  // Relative order WITHIN each group is untouched: the two NVDA rows keep ranks 4 then 6.
  assert.deepEqual(out.filter((r) => r.ticker === "NVDA").map((r) => r.rank), [4, 6]);
  assert.deepEqual(out.filter((r) => r.ticker !== "NVDA").map((r) => r.rank), [1, 2, 3, 5]);
});

test("no subject, or no matching row, leaves the order exactly as published", () => {
  const rows = PB("NET", "CRM", "AXON");
  assert.deepEqual(subjectFirst(rows, null, 1), rows);
  assert.deepEqual(subjectFirst(rows, "", 1), rows);
  assert.deepEqual(subjectFirst(rows, "TSLA", 1), rows);
  assert.deepEqual(subjectFirst(rows, "NET", 0), rows);
});
