import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMetrics, compare, CATEGORY_TOLERANCE, METRIC_TOLERANCE_PCT } from "./cwv-regression-eval.mjs";

function fakePsi({ performance = 0.9, lcp = 2000 } = {}) {
  return {
    lighthouseResult: {
      categories: {
        performance: { score: performance },
        accessibility: { score: 1 },
        "best-practices": { score: 1 },
        seo: { score: 1 },
      },
      audits: {
        "largest-contentful-paint": { numericValue: lcp },
        "cumulative-layout-shift": { numericValue: 0 },
        "total-blocking-time": { numericValue: 50 },
        "first-contentful-paint": { numericValue: 1000 },
        "speed-index": { numericValue: 1500 },
      },
    },
  };
}

test("extractMetrics reads scores and timing metrics from a PSI response", () => {
  const extracted = extractMetrics(fakePsi({ performance: 0.72, lcp: 5807 }));
  assert.equal(extracted.scores.performance, 0.72);
  assert.equal(extracted.scores.accessibility, 1);
  assert.equal(extracted.metrics.lcpMs, 5807);
});

test("compare returns no regressions when there is no baseline yet", () => {
  const current = extractMetrics(fakePsi());
  assert.deepEqual(compare(undefined, current), []);
  assert.deepEqual(compare(null, current), []);
});

test("compare returns no regressions when scores/metrics are within tolerance", () => {
  const baseline = extractMetrics(fakePsi({ performance: 0.72, lcp: 5807 }));
  const current = extractMetrics(fakePsi({ performance: 0.72 - CATEGORY_TOLERANCE, lcp: 5807 * (1 + METRIC_TOLERANCE_PCT) }));
  assert.deepEqual(compare(baseline, current), []);
});

test("compare flags a category score drop beyond tolerance", () => {
  const baseline = extractMetrics(fakePsi({ performance: 0.72 }));
  const current = extractMetrics(fakePsi({ performance: 0.5 }));
  const regressions = compare(baseline, current);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0], /performance score dropped/);
});

test("compare flags a timing metric regression beyond tolerance", () => {
  const baseline = extractMetrics(fakePsi({ lcp: 4000 }));
  const current = extractMetrics(fakePsi({ lcp: 4000 * (1 + METRIC_TOLERANCE_PCT + 0.01) }));
  const regressions = compare(baseline, current);
  assert.equal(regressions.length, 1);
  assert.match(regressions[0], /lcpMs regressed/);
});

test("compare skips a metric that regressed to/from null (missing data)", () => {
  const baseline = { scores: {}, metrics: { lcpMs: null } };
  const current = { scores: {}, metrics: { lcpMs: 5000 } };
  assert.deepEqual(compare(baseline, current), []);
});
