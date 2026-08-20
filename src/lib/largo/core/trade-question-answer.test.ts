import test from "node:test";
import assert from "node:assert/strict";

import { formatTradeAnswerBlock, isPlayQuestion } from "./trade-question";

/**
 * "The board has no committed play" is an INVENTORY STATUS, not an answer.
 *
 * PRODUCTION, 2026-08-20. A member asked "how is SPX looking for 8/23? what is a good play?" and
 * got back, after ~20s: "there's no committed desk play on SPX … wait for the open and the macro
 * print." The reply held spot, both walls, the flip, net GEX and the 0DTE flow skew — every input
 * a read needs — and still named no contract.
 *
 * It was doing what it was told. The old empty-board instruction read:
 *
 *     "you may discuss what *could* play out from flow/GEX/structure, but label it clearly as
 *      not on the board / conditional"
 *
 * "may discuss" permits vagueness, and nothing asked for a strike, a right, an expiry or a
 * probability. Declining was the compliant answer.
 *
 * These tests pin the replacement: an empty board changes the CONFIDENCE and the LABEL of the
 * answer, never whether one is given.
 */

const BLOCK = formatTradeAnswerBlock("SPX");

test("the member's actual phrasing is recognised as a play question", () => {
  // If this ever stops matching, the whole block below is never injected and every assertion
  // here becomes vacuous — so it is asserted rather than assumed.
  assert.equal(isPlayQuestion("how is SPX looking for 8/23? what is a good play?"), true);
});

test("REGRESSION: a ticker between the qualifier and the noun must not break routing", () => {
  // TRADE_RE required the qualifier and noun ADJACENT, so "best SPX play" did not match — the
  // most natural phrasing there is. formatTradeAnswerBlock was never injected for it, meaning the
  // contract/probability/empty-board rules simply did not apply to the question they exist for.
  // Found by asserting routing here, not by reading the regex.
  for (const q of [
    "what's the best SPX play today?",
    "best 3DTE SPX setup?",
    "which SPX trade looks good",
    "any good 0dte play",
    "best play for spx today",
    "what options play should i take",
  ]) {
    assert.equal(isPlayQuestion(q), true, `should route as a play question: ${q}`);
  }
});

test("the widened gap does not swallow ordinary prose", () => {
  // The gap is bounded (two tokens, ≤6 chars, non-greedy) precisely so that widening recall does
  // not turn every sentence containing "trade" into a recommendation request.
  for (const q of [
    "how did my trade do yesterday?",
    "what happened to my trade",
    "what is the gamma flip?",
    "where are the walls",
    "show me the trade history",
    "what were the results of that trade last week",
    "what's TICK saying",
  ]) {
    assert.equal(isPlayQuestion(q), false, `should NOT route as a play question: ${q}`);
  }
});

test("REGRESSION: an empty board must not license a non-answer", () => {
  assert.match(
    BLOCK,
    /inventory status,? not an answer/i,
    "must say outright that an empty board is not an answer"
  );
  assert.match(
    BLOCK,
    /STILL answer the question/i,
    "the empty-board branch must require an answer"
  );
  // The specific dodge the member received.
  assert.match(BLOCK, /never end on ["“]?wait for the open/i);
  // The permissive phrasing that caused it must be gone.
  assert.doesNotMatch(
    BLOCK,
    /you may discuss what \*?could\*? play out/i,
    "the old permissive 'may discuss' wording must not survive"
  );
});

test("it demands a concrete contract, not a direction", () => {
  assert.match(BLOCK, /strike, right and expiry/i);
  // A worked example is what separates "be specific" from a shape the model can copy.
  assert.match(BLOCK, /SPX 7800C/i, "must show a concrete contract example");
  assert.match(BLOCK, /not ["“]?a call above the wall/i, "must name the vague form it rejects");
  assert.match(BLOCK, /invalidation/i);
});

test("probability must be sourced from live delta, never invented", () => {
  assert.match(BLOCK, /get_options_chain|get_greeks/, "must say where the number comes from");
  assert.match(BLOCK, /delta/i);
  assert.match(BLOCK, /never invent a percentage/i);
  // An unavailable read must be disclosed, matching the system prompt's non-omission guarantee.
  assert.match(
    BLOCK,
    /could not read a delta[\s\S]{0,80}unavailable/i,
    "a missing delta must be disclosed, not filled in"
  );
});

test("delta is labelled as P(ITM), not as probability of profit", () => {
  // The subtle way this fix could itself become a fabrication: delta approximates the chance of
  // finishing IN THE MONEY. A long option also has to clear its premium, so presenting delta as
  // "chance this trade wins" would overstate every long call the desk ever suggests.
  assert.match(BLOCK, /finishes? in the money|finish ITM/i);
  assert.match(
    BLOCK,
    /not probability of profit/i,
    "must distinguish P(ITM) from P(profit)"
  );
  assert.match(BLOCK, /breakeven/i, "must require the breakeven alongside the probability");
});

test("the honest label survives — this is a read, not a committed play", () => {
  // Making Largo more decisive must not let its own read be mistaken for a scanner commitment.
  assert.match(BLOCK, /not on the board/i);
  assert.match(BLOCK, /never as a committed scanner play/i);
});

test("expiry selection is bound to the trading calendar", () => {
  // Naming a contract without this would let the Sunday bug back in through a new door: an
  // invented expiry attached to a concrete-looking strike.
  assert.match(
    BLOCK,
    /never name a date that is not a session/i,
    "contract expiry must be pinned to the calendar block"
  );
});
