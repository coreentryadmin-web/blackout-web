import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveMarketState,
  deriveActionState,
  marketStateToBias,
  isConflicted,
  MARKET_STATE_LABEL,
} from "./market-state";

/**
 * The live regression. This verdict was badged BULLISH by the old `firstMatch(verdict, BIAS_WORDS)`
 * because `bullish` was the first key in the word table — the badge said the opposite of the text
 * beneath it.
 */
const CONFLICTED_VERDICT =
  "Bearish price structure overwhelms bullish options flow — the signals genuinely conflict, " +
  "SPX is sideways with no clean entry.";

test("a verdict naming both sides is MIXED, never the first word in the table", () => {
  assert.equal(deriveMarketState(CONFLICTED_VERDICT), "mixed");
  assert.equal(marketStateToBias(deriveMarketState(CONFLICTED_VERDICT)), "mixed");
  assert.equal(isConflicted(deriveMarketState(CONFLICTED_VERDICT)), true);
});

test("word ORDER in the sentence does not change the state", () => {
  const a = "Bullish flow is overwhelmed by bearish structure.";
  const b = "Bearish structure overwhelms bullish flow.";
  assert.equal(deriveMarketState(a), "mixed");
  assert.equal(deriveMarketState(b), "mixed");
});

test("repetition does not let a majority bury the other side", () => {
  // Counting would resolve this bearish and drop the clause a member most needs.
  const v = "Bearish. Bearish breadth, bearish internals — but genuinely bullish 0DTE flow.";
  assert.equal(deriveMarketState(v), "mixed");
});

test("explicit conflict language wins outright", () => {
  assert.equal(deriveMarketState("Bullish, though the read is conflicted."), "mixed");
  assert.equal(deriveMarketState("Systems disagree on SPX right now."), "mixed");
});

test("one-sided reads keep their direction and their strength", () => {
  assert.equal(deriveMarketState("Bullish — SPX reclaimed VWAP."), "bullish");
  assert.equal(deriveMarketState("Clearly bullish; dealers are pinned."), "strong-bullish");
  assert.equal(deriveMarketState("Bearish — breadth is rolling."), "bearish");
  assert.equal(deriveMarketState("Decisively bearish across every lane."), "strong-bearish");
});

test("a hedged read lands on the unconfirmed rung, not on mixed", () => {
  const s = deriveMarketState("Bullish lean, but unconfirmed until SPX reclaims the gamma flip.");
  assert.equal(s, "bullish-unconfirmed");
  // Still bullish for legacy consumers — "not confirmed" is not "conflicted".
  assert.equal(marketStateToBias(s), "bullish");
  assert.equal(isConflicted(s), false);
});

test("neutral is a finding; silence is not", () => {
  assert.equal(deriveMarketState("SPX is balanced and rangebound into the close."), "neutral");
  // The old code defaulted to neutral here, reporting "we looked and it's balanced" for an
  // answer that stated no direction at all.
  assert.equal(deriveMarketState("The board refreshed 20 minutes ago."), "no-read");
  assert.equal(deriveMarketState(""), "no-read");
});

test("action state is independent of direction", () => {
  // A strong direction that is still a wait — the case a single collapsed badge cannot express.
  const v = "Clearly bullish, but no clean entry until the wall breaks.";
  assert.equal(deriveMarketState(v), "bullish-unconfirmed");
  assert.equal(deriveActionState(v), "wait");
  assert.equal(deriveActionState("BLACKOUT state: SCANNING."), "scanning");
  // Nothing invented: no action language means no action line, not a default "WAIT".
  assert.equal(deriveActionState("SPX spot 7752.65."), "unknown");
});

test("every state has a label", () => {
  for (const s of Object.keys(MARKET_STATE_LABEL)) {
    assert.equal(typeof MARKET_STATE_LABEL[s as keyof typeof MARKET_STATE_LABEL], "string");
  }
  assert.equal(MARKET_STATE_LABEL.mixed, "MIXED");
  assert.equal(MARKET_STATE_LABEL["bullish-unconfirmed"], "BULLISH BIAS · UNCONFIRMED");
});
