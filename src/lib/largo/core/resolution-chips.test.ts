import test from "node:test";
import assert from "node:assert/strict";
import {
  resolutionChipsForState,
  withResolutionChips,
  CONFIRM_LONG,
  CONFIRM_SHORT,
  WHAT_INVALIDATES,
} from "./resolution-chips";

/** The specific, excellent chips Largo writes itself — a template can never produce these. */
const MODEL_CHIPS = [
  "Does the call wall at 7800 hold if we break VWAP lower?",
  "What's the dealer delta if SPX closes below gamma flip?",
  "Which other indices show similar tape-price conflict?",
];

test("a MIXED answer gets BOTH resolution chips — they are its resolution criteria", () => {
  assert.deepEqual(resolutionChipsForState("mixed"), [CONFIRM_LONG, CONFIRM_SHORT]);
});

test("an unconfirmed lean asks only about ITS side", () => {
  // The open question is whether the lean confirms, not what the other side would need.
  assert.deepEqual(resolutionChipsForState("bullish-unconfirmed"), [CONFIRM_LONG]);
  assert.deepEqual(resolutionChipsForState("bearish-unconfirmed"), [CONFIRM_SHORT]);
});

test("an established direction asks what BREAKS it, not what confirms it", () => {
  for (const s of ["bullish", "strong-bullish", "bearish", "strong-bearish"] as const) {
    assert.deepEqual(resolutionChipsForState(s), [WHAT_INVALIDATES]);
  }
});

test("a no-read answer gets NO chips — a chip would imply a thesis never stated", () => {
  assert.deepEqual(resolutionChipsForState("no-read"), []);
});

test("balance resolves by breaking, so neutral offers both directions", () => {
  assert.deepEqual(resolutionChipsForState("neutral"), [CONFIRM_LONG, CONFIRM_SHORT]);
});

test("state chips lead, and the model's specific ones survive behind them", () => {
  const verdict = "Bearish structure overwhelms bullish flow — the signals genuinely conflict.";
  const out = withResolutionChips(MODEL_CHIPS, verdict);

  assert.deepEqual(out.slice(0, 2), [CONFIRM_LONG, CONFIRM_SHORT]);
  // The model's best chip is not evicted by the standing pair.
  assert.equal(out[2], MODEL_CHIPS[0]);
  assert.equal(out.length, 4);
});

test("an aligned answer keeps three model chips and one standing action", () => {
  const out = withResolutionChips(MODEL_CHIPS, "Clearly bullish — SPX reclaimed the flip on volume.");
  assert.equal(out[0], WHAT_INVALIDATES);
  assert.deepEqual(out.slice(1), MODEL_CHIPS);
});

test("a duplicate phrasing from the model is not shown twice", () => {
  // The model writes "What confirms a long?"; the constant says "What confirms LONG?".
  const out = withResolutionChips(["What confirms a long?", "Show strike stacks"], "Bullish lean, unconfirmed.");
  assert.equal(out.filter((c) => /confirms/i.test(c)).length, 1);
  assert.deepEqual(out, [CONFIRM_LONG, "Show strike stacks"]);
});

test("no verdict text means no state chips, and the model's chips pass through", () => {
  const out = withResolutionChips(MODEL_CHIPS, "");
  assert.deepEqual(out, MODEL_CHIPS);
});

test("empty and blank model chips are dropped, never rendered as empty buttons", () => {
  const out = withResolutionChips(["", "   ", "Real chip"], "");
  assert.deepEqual(out, ["Real chip"]);
  assert.deepEqual(withResolutionChips([], "The board refreshed 20 minutes ago."), []);
});

test("the limit is respected and is configurable", () => {
  assert.equal(withResolutionChips(MODEL_CHIPS, "Signals conflict.", 3).length, 3);
  assert.equal(withResolutionChips(MODEL_CHIPS, "Signals conflict.", 10).length, 5);
});
