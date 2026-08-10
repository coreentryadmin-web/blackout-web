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

const withTrade: VisualBundle = {
  ...base,
  trade: {
    ticker: "META",
    direction: "long",
    entry: { value: 3.18, display: "$3.18", source: "NIGHT HAWK" },
    source: "NIGHT HAWK",
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
  assert.equal(IMPLEMENTED_TEMPLATES.length, 13);
  // ORDER IS BEHAVIOUR, not bookkeeping: it is the tie-break when two intents match AND the
  // descent order when a proposed template cannot be filled. MARKET_MOVE stays LAST among the
  // implemented set because it is the most general and the most likely to be fillable, which is
  // exactly what makes it the right last resort rather than a frequent winner.
  assert.deepEqual(IMPLEMENTED_TEMPLATES.map((t) => t.id), [
    "LEVEL_ANALYSIS",
    "TRADE_RECAP",
    "SCREENER",
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
  assert.equal(TEMPLATES.length, 13, "all thirteen stay registered");
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
