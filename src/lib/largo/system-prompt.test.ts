import test from "node:test";
import assert from "node:assert/strict";
import { LARGO_SYSTEM_PROMPT } from "./system-prompt";

/**
 * These lock the two rules that exist because Largo got them WRONG in production, in the same
 * confident voice it uses for verified facts. A prompt is easy to trim during an unrelated edit,
 * and a deleted rule fails silently — the answers just quietly get worse. These are the tripwire.
 */

test("dealer-gamma mechanics: the full convention chain is stated", () => {
  const p = LARGO_SYSTEM_PROMPT;
  // 1. data definition — the sign that creates the bipolar signal
  assert.match(p, /sign = \+1 for calls, −1 for puts/);
  // 2. sign -> dealer position
  assert.match(p, /Positive net GEX ⇒ dealers net \*\*LONG\*\* gamma/);
  assert.match(p, /Negative net GEX ⇒ dealers net \*\*SHORT\*\* gamma/);
  // 3. position -> hedge behaviour, in BOTH directions
  assert.match(p, /long gamma\*\* hedge COUNTER-cyclically: they SELL into rallies and BUY into dips/);
  assert.match(p, /short gamma\*\* hedge PRO-cyclically: they BUY into rallies and SELL into dips/);
});

test("dealer-gamma: DEX carries its own, opposite sign convention", () => {
  // The live error conflated a DELTA reading with a GAMMA response. Both halves must be present
  // for the distinction to be learnable from the prompt.
  assert.match(LARGO_SYSTEM_PROMPT, /dealerDelta = −Σ\(delta · OI\)/);
  assert.match(LARGO_SYSTEM_PROMPT, /GAMMA describes how dealers RESPOND to a move\. DELTA describes where they ARE/);
});

test("dealer-gamma: hedge behaviour may not be inferred from price or premium", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /Never infer it from price action, from a wall's location, or from a call\/put premium ratio/);
  // And the claim is bounded — an estimated book is not an observed one.
  assert.match(p, /the real book is not observable/);
});

test("evidence absent is not evidence of absence — with the exact live failure", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /Evidence absent is NOT evidence of absence/);
  // The sentence that shipped: "No dark pool prints today = no institutional conviction visible".
  assert.match(p, /No dark-pool prints surfaced in this window/);
  assert.match(p, /❌ "No institutional conviction\."/);
  // The reason it is wrong, not just the instruction.
  assert.match(p, /futures, baskets, swaps, execution algos and venues we do not see/);
  // And the constructive alternative, so the rule does not just produce silence.
  assert.match(p, /say what makes it informative \(the baseline\)/);
});

test("no hardcoded SPX level: a stale anchor becomes a reason to distrust live data", () => {
  const p = LARGO_SYSTEM_PROMPT;
  // The prompt claimed "spot price is in the 5000–6000 range" while SPX traded at 7760.
  assert.doesNotMatch(p, /spot price is in the 5000/);
  assert.match(p, /roughly \*\*10× SPY\*\*/);
  assert.match(p, /your prior is always stale/);
});
