import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggressorSide,
  flowDirection,
  directionalPremium,
  directionLabel,
  ASK_SIDE_BOUGHT_PCT,
  ASK_SIDE_SOLD_PCT,
} from "./helix-flow-aggression";
import { aggressorRead, printBias } from "./helix-print-detail";

test("aggressorSide thresholds, at the boundaries in both directions", () => {
  assert.equal(aggressorSide(100), "bought");
  assert.equal(aggressorSide(ASK_SIDE_BOUGHT_PCT), "bought");
  assert.equal(aggressorSide(ASK_SIDE_BOUGHT_PCT - 0.01), "undetermined");
  assert.equal(aggressorSide(50), "undetermined");
  assert.equal(aggressorSide(ASK_SIDE_SOLD_PCT + 0.01), "undetermined");
  assert.equal(aggressorSide(ASK_SIDE_SOLD_PCT), "sold");
  assert.equal(aggressorSide(0), "sold");
  for (const bad of [null, undefined, Number.NaN, "x" as unknown as number]) {
    assert.equal(aggressorSide(bad as number | null), "undetermined", `${String(bad)}`);
  }
});

test("the four-way direction table", () => {
  assert.equal(flowDirection({ option_type: "CALL", ask_pct: 95 }), "bullish");
  assert.equal(flowDirection({ option_type: "CALL", ask_pct: 5 }), "bearish");
  assert.equal(flowDirection({ option_type: "PUT", ask_pct: 95 }), "bearish");
  assert.equal(flowDirection({ option_type: "PUT", ask_pct: 5 }), "bullish");
});

test("an unreadable print is undetermined, never folded into a side", () => {
  // A midpoint print is not a small bullish print.
  assert.equal(flowDirection({ option_type: "CALL", ask_pct: 50 }), "undetermined");
  assert.equal(flowDirection({ option_type: "CALL", ask_pct: null }), "undetermined");
  assert.equal(flowDirection({ option_type: "CALL" }), "undetermined");
  // An option type we cannot classify is undetermined too — never defaulted to CALL.
  assert.equal(flowDirection({ option_type: "UNKNOWN", ask_pct: 95 }), "undetermined");
  assert.equal(flowDirection({ option_type: null, ask_pct: 95 }), "undetermined");
  assert.equal(flowDirection({ option_type: "", ask_pct: 5 }), "undetermined");
});

test("this module and the shipped drilldown agree — they are the same claim on one screen", () => {
  // `printBias` is the copy already rendering to members in the contract drilldown. If these two
  // ever disagree, a member sees two directions for one print, which is the defect this closes.
  const cases = [
    { option_type: "CALL", ask_pct: 100 },
    { option_type: "CALL", ask_pct: 60 },
    { option_type: "CALL", ask_pct: 0 },
    { option_type: "PUT", ask_pct: 100 },
    { option_type: "PUT", ask_pct: 40 },
    { option_type: "PUT", ask_pct: 0 },
    { option_type: "CALL", ask_pct: 50 },
    { option_type: "PUT", ask_pct: 55 },
  ];
  for (const c of cases) {
    const mine = flowDirection(c);
    const theirs = printBias(c);
    const normalised = theirs === "neutral" ? "undetermined" : theirs;
    assert.equal(mine, normalised, `disagreement on ${JSON.stringify(c)}: ${mine} vs ${theirs}`);
  }
  // The thresholds themselves must match, not just the outcomes on these samples.
  assert.equal(aggressorRead(ASK_SIDE_BOUGHT_PCT)?.tone, "bull");
  assert.equal(aggressorRead(ASK_SIDE_SOLD_PCT)?.tone, "bear");
  assert.equal(aggressorRead(ASK_SIDE_BOUGHT_PCT - 0.01)?.tone, "neutral");
  assert.equal(aggressorRead(ASK_SIDE_SOLD_PCT + 0.01)?.tone, "neutral");
});

test("directionalPremium buckets by direction and keeps the unreadable separate", () => {
  const p = directionalPremium([
    { option_type: "CALL", ask_pct: 95, premium: 100 },
    { option_type: "PUT", ask_pct: 5, premium: 50 },
    { option_type: "CALL", ask_pct: 5, premium: 30 },
    { option_type: "PUT", ask_pct: 95, premium: 20 },
    { option_type: "CALL", ask_pct: 50, premium: 999 },
  ]);
  assert.deepEqual(p, { bullish: 150, bearish: 50, undetermined: 999 });
});

test("directionalPremium ignores premium that is not a positive number", () => {
  const p = directionalPremium([
    { option_type: "CALL", ask_pct: 95, premium: 0 },
    { option_type: "CALL", ask_pct: 95, premium: -5 },
    { option_type: "CALL", ask_pct: 95, premium: Number.NaN },
    { option_type: "CALL", ask_pct: 95, premium: 10 },
  ]);
  assert.deepEqual(p, { bullish: 10, bearish: 0, undetermined: 0 });
});

test("directionLabel: the margin, and the refusals", () => {
  assert.equal(directionLabel({ bullish: 60, bearish: 40, undetermined: 0 }), "bullish");
  assert.equal(directionLabel({ bullish: 40, bearish: 60, undetermined: 0 }), "bearish");
  assert.equal(directionLabel({ bullish: 55, bearish: 45, undetermined: 0 }), "mixed");
  // More unread than read: the verdict would rest on a minority of the premium.
  assert.equal(directionLabel({ bullish: 100, bearish: 0, undetermined: 101 }), "undetermined");
  // Exactly equal is still readable — the refusal triggers on a strict majority unread.
  assert.equal(directionLabel({ bullish: 100, bearish: 0, undetermined: 100 }), "bullish");
  // Nothing readable at all.
  assert.equal(directionLabel({ bullish: 0, bearish: 0, undetermined: 500 }), "undetermined");
  assert.equal(directionLabel({ bullish: 0, bearish: 0, undetermined: 0 }), "undetermined");
});
