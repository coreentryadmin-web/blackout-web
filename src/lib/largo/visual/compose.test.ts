import test from "node:test";
import assert from "node:assert/strict";
import { BLOCKS, composeCard, heightBudget, levelOnSameScale, parseEmphasis, scoreBlock } from "./compose";
import { detectVisualIntent, questionSubject } from "./intent";
import { balancedBySide } from "./templates/composed";
import { sizeSpec } from "./sizes";
import type { VisualBundle } from "./types";

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
  const c = composeCard({ question: "how does TSLA look today", bundle: rich, spec: sizeSpec("x_landscape") });
  assert.ok(c.blocks.some((b) => b.id === "flow_tape"), "the tape must survive, compact if necessary");
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
