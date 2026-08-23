import { test } from "node:test";
import assert from "node:assert/strict";

import { computeGexProximity, enrichFlowWithGex } from "@/lib/flow-gex-proximity";

const print = (strike: number) => ({ ticker: "NVDA", strike });
const levels = { flip: 100, call_wall: 120, put_wall: 80 };

test("computeGexProximity: 'at' is tighter than 'near', and flip outranks both walls", () => {
  assert.equal(computeGexProximity(100, 100, 120, 80), "at_gamma_flip");
  assert.equal(computeGexProximity(120, 100, 120, 80), "at_call_wall");
  assert.equal(computeGexProximity(80, 100, 120, 80), "at_put_wall");
  // within 0.5% but outside 0.15% → "near", not "at"
  assert.equal(computeGexProximity(120.4, 100, 120, 80), "near_call_wall");
  assert.equal(computeGexProximity(79.7, 100, 120, 80), "near_put_wall");
  // beyond 0.5% of anything → no label at all
  assert.equal(computeGexProximity(110, 100, 120, 80), null);
});

test("computeGexProximity refuses to compare against a level it does not have", () => {
  assert.equal(computeGexProximity(100, null, null, null), null);
  assert.equal(computeGexProximity(100, 0, 0, 0), null);
  assert.equal(computeGexProximity(100, Number.NaN, null, null), null);
});

/**
 * The §9.3 invariant. An absent `gex_proximity` used to mean three different things — not near a
 * level / lookup timed out / ticker past the enrichment cap — and no consumer could tell them
 * apart. `gex_evaluated` splits "checked, not near" from "never checked".
 */
test("a print compared against real levels is marked evaluated — even when nothing is near", () => {
  const far = enrichFlowWithGex(print(110), levels);
  assert.equal(far.gex_evaluated, true, "reaching this function means the comparison happened");
  assert.equal("gex_proximity" in far, false, "...and 'not near' is still no label");
});

test("a print that IS near a level carries both the label and the evaluated flag", () => {
  const near = enrichFlowWithGex(print(120), levels);
  assert.equal(near.gex_proximity, "at_call_wall");
  assert.equal(near.gex_evaluated, true);
});

test("enrichment never mutates the print it was handed", () => {
  const original = print(120);
  const enriched = enrichFlowWithGex(original, levels);
  assert.equal("gex_evaluated" in original, false);
  assert.notEqual(enriched, original);
  assert.equal(enriched.ticker, "NVDA");
  assert.equal(enriched.strike, 120);
});

/**
 * The CAP, which is the branch that matters most: measured live, 173 of 273 tickers on one
 * 5000-row page were past it, so "never evaluated" is the common case, not an edge one.
 *
 * Tested through the pure helper because `flow-gex-enrichment.ts` reaches `server-only` and cannot
 * be imported by a test at all — which is precisely how this cap went unmeasured for so long.
 */
test("tickersToEvaluate splits a page at the cap and names what it skipped", async () => {
  const { tickersToEvaluate } = await import("@/lib/flow-gex-proximity");
  const flows = [
    { ticker: "NVDA" }, { ticker: "TSLA" }, { ticker: "NVDA" }, { ticker: "SPY" }, { ticker: "AMD" },
  ];
  const { evaluated, skipped } = tickersToEvaluate(flows, 2);
  assert.deepEqual(evaluated, ["NVDA", "TSLA"], "first-appearance order, deduped");
  assert.deepEqual(skipped, ["SPY", "AMD"], "the rest are named, not silently dropped");
});

test("tickersToEvaluate: a cap at or above the ticker count skips nothing", async () => {
  const { tickersToEvaluate } = await import("@/lib/flow-gex-proximity");
  const flows = [{ ticker: "NVDA" }, { ticker: "TSLA" }];
  assert.deepEqual(tickersToEvaluate(flows, 100).skipped, []);
  assert.deepEqual(tickersToEvaluate(flows, 2).skipped, []);
});

test("tickersToEvaluate: a zero or nonsense cap evaluates nothing and admits it", async () => {
  const { tickersToEvaluate } = await import("@/lib/flow-gex-proximity");
  const flows = [{ ticker: "NVDA" }, { ticker: "TSLA" }];
  for (const cap of [0, -1, Number.NaN]) {
    const { evaluated, skipped } = tickersToEvaluate(flows, cap);
    assert.deepEqual(evaluated, [], `cap ${cap} evaluates nothing`);
    assert.deepEqual(skipped, ["NVDA", "TSLA"], `cap ${cap} still names the skipped`);
  }
});

test("tickersToEvaluate ignores blank tickers rather than counting them against the cap", async () => {
  const { tickersToEvaluate } = await import("@/lib/flow-gex-proximity");
  const { evaluated } = tickersToEvaluate([{ ticker: "" }, { ticker: "NVDA" }], 1);
  assert.deepEqual(evaluated, ["NVDA"]);
});
