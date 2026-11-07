import test from "node:test";
import assert from "node:assert/strict";
import { resolveBeatRateCohortCounts } from "./meridian-beat-rate-display";

test("resolveBeatRateCohortCounts: each bar gets its OWN cohort size, not a shared one", () => {
  // Live shape: a name with zero EPS-graded prints (no eps_estimate/eps_actual on file) but
  // several revenue-graded prints. A naive shared "graded" count derived from the EPS cohort
  // alone (prints.filter(p => p.beat != null).length) would be 0 here — which is exactly the
  // bug: RateBar hides a bar whenever n === 0, even though revenue_beat_rate is a real number.
  const rates = {
    eps_graded: 0,
    revenue_graded: 5,
    combined_graded: 5,
    prints_graded: 5,
  };
  const counts = resolveBeatRateCohortCounts(rates);
  assert.equal(counts.eps, 0);
  // THE BUG: this must be 5 (revenue's own cohort), never 0 (EPS's cohort).
  assert.equal(counts.revenue, 5);
  assert.equal(counts.combined, 5);
  assert.equal(counts.captionPrints, 5);
});

test("resolveBeatRateCohortCounts: distinguishes the pooled 'combined' reading count from the honest print count", () => {
  // 8 prints, each graded on BOTH eps and revenue -> combined_graded (readings) is 16, but
  // prints_graded (distinct prints) is 8. The caption must use the latter, never the former.
  const rates = {
    eps_graded: 8,
    revenue_graded: 8,
    combined_graded: 16,
    prints_graded: 8,
  };
  const counts = resolveBeatRateCohortCounts(rates);
  assert.equal(counts.eps, 8);
  assert.equal(counts.revenue, 8);
  assert.equal(counts.combined, 16);
  assert.equal(counts.captionPrints, 8);
});

test("resolveBeatRateCohortCounts: every field independently defaults to 0 when absent, never borrows a sibling's value", () => {
  assert.deepEqual(resolveBeatRateCohortCounts({}), {
    eps: 0,
    revenue: 0,
    combined: 0,
    captionPrints: 0,
  });
  assert.deepEqual(resolveBeatRateCohortCounts(null), {
    eps: 0,
    revenue: 0,
    combined: 0,
    captionPrints: 0,
  });
  assert.deepEqual(resolveBeatRateCohortCounts(undefined), {
    eps: 0,
    revenue: 0,
    combined: 0,
    captionPrints: 0,
  });
});

test("resolveBeatRateCohortCounts: mixed cohorts stay independent in the other direction too", () => {
  // EPS graded, revenue not — the mirror case of the first test, confirming eps never borrows
  // revenue's (or combined's) count either.
  const rates = {
    eps_graded: 6,
    revenue_graded: 0,
    combined_graded: 6,
    prints_graded: 6,
  };
  const counts = resolveBeatRateCohortCounts(rates);
  assert.equal(counts.eps, 6);
  assert.equal(counts.revenue, 0);
  assert.equal(counts.combined, 6);
  assert.equal(counts.captionPrints, 6);
});
