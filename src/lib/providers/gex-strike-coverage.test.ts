import test from "node:test";
import assert from "node:assert/strict";
import { shouldEscalateToFullChain } from "./polygon-options-gex";

/**
 * MEASURED AGAINST THE LIVE CHAINS, 2026-08-12. The band is ±20% of spot for every non-SPX name,
 * and the escalation to a full chain pull only fired below $15 — so a mid-priced, high-vol name
 * silently served a fraction of its own chain:
 *
 *     ticker  spot     strikes in band   strikes listed
 *     ASTS    71.66    30                119     <- 68% of open interest never fetched
 *     SOFI    17.97    41                 —
 *     NVDA   218.04    78                 —
 *     SPY    770.56   266                 —
 *
 * On ASTS the single largest OI strike in the entire chain (100, 95,367 contracts) sat outside the
 * band, so Net GEX under-counted and the call wall could not be found even in principle.
 */

test("ASTS — the reported case — escalates", () => {
  // 30 strikes at $71.66: the old rule ignored it because the price gate was $15.
  assert.equal(shouldEscalateToFullChain(30, 71.66), true);
});

test("a rich ladder does NOT escalate — SPY and NVDA keep their current behaviour", () => {
  assert.equal(shouldEscalateToFullChain(266, 770.56), false);
  assert.equal(shouldEscalateToFullChain(78, 218.04), false);
});

test("the low-price rule still stands on its own", () => {
  // A $5 name may have few listed strikes in total; a tiny ladder there still escalates.
  assert.equal(shouldEscalateToFullChain(10, 5), true);
  // …but a $5 name with a healthy ladder does not need the full pull.
  assert.equal(shouldEscalateToFullChain(20, 5), true); // still under the 45 general threshold
  assert.equal(shouldEscalateToFullChain(60, 5), false);
});

test("the trigger is the LADDER, not the price — that was the original mistake", () => {
  // Same thin ladder, wildly different prices: all escalate. The old rule only caught the cheap one.
  for (const spot of [5, 71.66, 250, 900]) {
    assert.equal(shouldEscalateToFullChain(12, spot), true, `spot ${spot} should escalate on 12 strikes`);
  }
});

test("the boundary is exact", () => {
  assert.equal(shouldEscalateToFullChain(44, 100), true);
  assert.equal(shouldEscalateToFullChain(45, 100), false);
});

test("a non-positive spot never escalates — there is no chain to widen to", () => {
  assert.equal(shouldEscalateToFullChain(0, 0), false);
  assert.equal(shouldEscalateToFullChain(10, -1), false);
  assert.equal(shouldEscalateToFullChain(10, Number.NaN), false);
});
