import test from "node:test";
import assert from "node:assert/strict";
import { routeVisual, TEMPLATES, IMPLEMENTED_TEMPLATES } from "./router";
import type { VisualBundle } from "./types";

const base: VisualBundle = { systemsQueried: ["THERMAL"], asOf: "2026-08-10T14:38:22Z" };

const withLevels: VisualBundle = {
  ...base,
  spot: { value: 7757.58, display: "7,757.58", source: "THERMAL" },
  levels: [{ label: "Put wall", price: 7725, display: "7,725", kind: "support", source: "THERMAL" }],
};

/**
 * A REAL trade: an entry AND something that says how it is doing.
 *
 * This fixture used to carry an entry alone, which encoded the old TRADE_RECAP gate. That gate
 * shipped a live failure — a published Night Hawk play (entry premium, no mark, no status, because
 * it has not been taken yet) satisfied it and rendered a recap frame around one number on an
 * otherwise empty canvas. `status` is what makes this a position rather than a plan; see the
 * PLAYBOOK fixtures below for the other side of that split.
 */
const withTrade: VisualBundle = {
  ...base,
  trade: {
    ticker: "META",
    direction: "long",
    entry: { value: 3.18, display: "$3.18", source: "NIGHT HAWK" },
    status: "OPEN",
    source: "NIGHT HAWK",
  },
};

/** A PLAN, not a trade — an entry premium and nothing about an outcome. */
const planShapedRow: VisualBundle = {
  ...base,
  trade: {
    ticker: "NET",
    direction: "long",
    entry: { value: 13.35, display: "$13.35", source: "NIGHT HAWK" },
    source: "NIGHT HAWK",
  },
};

const withPlaybook: VisualBundle = {
  ...base,
  playbook: {
    editionFor: "2026-08-11",
    publishedAt: "2026-08-10T23:10:21Z",
    totalPlays: 5,
    source: "NIGHT HAWK",
    rows: [
      { rank: 1, ticker: "NVDA", direction: "long", conviction: "high", entryRange: "$217.10-218.40", target: "$224.00", stop: "$213.80", optionsPlay: "Aug 12 217.5C", entryPremium: 2.42, entryPremiumDisplay: "$2.42", thesis: null, keySignal: null, rrRatio: 2.1, targetAtrMultiple: 1.2 },
      { rank: 2, ticker: "CRM", direction: "long", conviction: "medium", entryRange: "$268.20-269.90", target: "$277.50", stop: "$264.10", optionsPlay: "Aug 14 270C", entryPremium: 3.58, entryPremiumDisplay: "$3.58", thesis: null, keySignal: null, rrRatio: 1.8, targetAtrMultiple: 1.6 },
    ],
  },
};

const withMove: VisualBundle = {
  ...base,
  headline: "Dealers flipped short gamma into the close",
  metrics: [
    { label: "Net premium", value: "+$41.2M", source: "HELIX" },
    { label: "Dealer gamma", value: "SHORT", source: "THERMAL" },
  ],
};

test("only implemented templates are ever reachable", () => {
  // The flag is the mechanism that let the library grow three at a time without half-built
  // templates leaking into member-facing output. Every registered template is now built.
  assert.equal(IMPLEMENTED_TEMPLATES.length, 16);
  // ORDER IS BEHAVIOUR, not bookkeeping: it is the tie-break when two intents match AND the
  // descent order when a proposed template cannot be filled. MARKET_MOVE stays LAST among the
  // implemented set because it is the most general and the most likely to be fillable, which is
  // exactly what makes it the right last resort rather than a frequent winner.
  assert.deepEqual(IMPLEMENTED_TEMPLATES.map((t) => t.id), [
    "LEVEL_ANALYSIS",
    "PLAYBOOK",
    "TRADE_RECAP",
    "SCREENER",
    // COUNTERFACTUAL precedes REJECTION on purpose: both answer "what did we pass on", and
    // REJECTION's `held` keyword would otherwise swallow every counterfactual question. The
    // graded version of the same holds is the strictly stronger card, so it must win when its
    // evidence exists.
    "COUNTERFACTUAL",
    "GRADER_AGREEMENT",
    "REJECTION",
    "EM_CONE",
    "GAMMA_MAP",
    "FLOW_RECAP",
    "TRADE_LEADERBOARD",
    "SYSTEM_COMPARISON",
    "BEFORE_AFTER",
    "SESSION_RECAP",
    "SIGNAL_TIMELINE",
    "MARKET_MOVE",
  ]);
  assert.equal(TEMPLATES.length, 16, "all sixteen stay registered");
});

test("intent routes each of the brief's example questions", () => {
  assert.equal(routeVisual("Why did SPX dump?", withMove)!.template, "MARKET_MOVE");
  assert.equal(routeVisual("How did Slayer catch today's move?", withTrade)!.template, "TRADE_RECAP");
  assert.equal(routeVisual("What happened at 7800?", withLevels)!.template, "LEVEL_ANALYSIS");
  assert.equal(routeVisual("Show me the META Night Hawk trade", withTrade)!.template, "TRADE_RECAP");
});

test("SUFFICIENCY OVERRIDES INTENT — the guard that stops a fabricated graphic", () => {
  // "How did Slayer catch today's move" on a day with NO committed trade. Intent says
  // TRADE_RECAP; the evidence cannot fill it. A router that only matched intent would render a
  // lifecycle with empty steps — a graphic implying a trade that never happened.
  const r = routeVisual("How did Slayer catch today's move?", withLevels)!;
  assert.notEqual(r.template, "TRADE_RECAP");
  assert.equal(r.template, "LEVEL_ANALYSIS", "falls back to what the evidence supports");
  assert.equal(r.matchedIntent, false, "and reports that it was not the intended template");
  assert.ok(r.rejected.some((x) => x.template === "TRADE_RECAP"));
});

test("a trade with no entry is not a trade", () => {
  const noEntry: VisualBundle = {
    ...base,
    trade: { ticker: "META", direction: "long", entry: null, source: "NIGHT HAWK" },
  };
  assert.equal(routeVisual("show the META trade", noEntry), null);
});

test("a level question needs BOTH a spot and a level", () => {
  const spotOnly: VisualBundle = { ...base, spot: { value: 7757, display: "7,757", source: "THERMAL" } };
  // Spot with no levels is not a level analysis; a level with no spot is a number in space.
  assert.equal(routeVisual("what happened at 7800", spotOnly), null);
  const levelOnly: VisualBundle = {
    ...base,
    levels: [{ label: "Call wall", price: 7800, display: "7,800", kind: "resistance", source: "THERMAL" }],
  };
  assert.equal(routeVisual("what happened at 7800", levelOnly), null);
});

test("one metric under a headline is a decoration, not evidence", () => {
  const thin: VisualBundle = {
    ...base,
    headline: "SPX sold off",
    metrics: [{ label: "Net premium", value: "+$1M", source: "HELIX" }],
  };
  assert.equal(routeVisual("why did SPX dump", thin), null);
});

test("an EMPTY bundle yields NO visual — refusing to draw is always available", () => {
  assert.equal(routeVisual("why did SPX dump?", base), null);
  assert.equal(routeVisual("", base), null);
});

test("an explicit pick is a request, not an override of whether the data exists", () => {
  // The member chose Trade Recap in the preview, but no trade exists this turn.
  const r = routeVisual("what happened at 7800", withLevels, "TRADE_RECAP")!;
  assert.equal(r.template, "LEVEL_ANALYSIS");
  assert.ok(r.rejected.some((x) => x.template === "TRADE_RECAP"), "and the UI can say why the pick was not honoured");
});

/**
 * PLAYBOOK — the forward runbook, and the split from TRADE_RECAP that made it necessary.
 *
 * Live failure this pins: "Give me tomorrows NH legacy plays" returned a correct five-play answer
 * beside a card showing ONE ticker and ONE number. Two causes, and both are asserted below.
 */
test("a plays question routes to PLAYBOOK, not to a single-trade recap", () => {
  for (const q of [
    "Give me tomorrows NH legacy plays",
    "what is in tonight's playbook",
    "show me the edition",
    "what are we trading tomorrow",
  ]) {
    assert.equal(routeVisual(q, withPlaybook)!.template, "PLAYBOOK", `"${q}" must route to PLAYBOOK`);
  }
});

test("PLAYBOOK outranks TRADE_RECAP when both could be filled", () => {
  // TRADE_RE matches `play` and `entry`, so without the ordering the recap swallows every
  // playbook question — which is exactly what happened in production.
  const both: VisualBundle = { ...base, ...withPlaybook, trade: withTrade.trade };
  assert.equal(routeVisual("give me tomorrows plays", both)!.template, "PLAYBOOK");
});

test("a PLAN-shaped row is REFUSED by TRADE_RECAP — the empty-card bug", () => {
  // An entry premium with no mark, no return and no status describes a play that has not been
  // taken. TRADE_RECAP reads exit/return/status, so it would render a frame of empty cells.
  assert.equal(routeVisual("how did that trade do", planShapedRow), null, "nothing else is fillable, so nothing is drawn");

  // And when there IS something else to draw, the refusal is reported rather than silent — the
  // preview can then say why the recap was not the card it got.
  const alongsideLevels: VisualBundle = { ...withLevels, trade: planShapedRow.trade };
  const r = routeVisual("how did that trade do", alongsideLevels)!;
  assert.notEqual(r.template, "TRADE_RECAP", "a plan must never fill the performance template");
  assert.ok(
    r.rejected.some((x) => x.template === "TRADE_RECAP"),
    "and the refusal must be reported, not silent",
  );
});

test("an open position is STILL a valid recap — the guard did not overshoot", () => {
  // The point of requiring an outcome-side field is to exclude plans, not open trades. A position
  // with a status but no booked return must still route to TRADE_RECAP.
  assert.equal(routeVisual("how did Slayer catch today's move?", withTrade)!.template, "TRADE_RECAP");
});

test("an explicit pick IS honoured when the evidence supports it", () => {
  const both: VisualBundle = { ...withLevels, ...withTrade, ...base, spot: withLevels.spot, levels: withLevels.levels, trade: withTrade.trade };
  const r = routeVisual("what happened at 7800", both, "TRADE_RECAP")!;
  assert.equal(r.template, "TRADE_RECAP");
  assert.equal(r.matchedIntent, true);
});

test("AUTO behaves exactly like no preference", () => {
  assert.deepEqual(routeVisual("why did SPX dump?", withMove, "AUTO")!.template, routeVisual("why did SPX dump?", withMove)!.template);
});

test("an unrecognised question still routes when evidence supports a card", () => {
  // Fallback, explicitly flagged as not-intent-matched so the preview can show it was a guess.
  const r = routeVisual("tell me something", withLevels)!;
  assert.equal(r.matchedIntent, false);
  assert.equal(r.template, "LEVEL_ANALYSIS");
});
