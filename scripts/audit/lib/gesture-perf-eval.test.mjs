import { test } from "node:test";
import assert from "node:assert/strict";

import { computeFunctionShares, evaluateGesturePerfGuard } from "./gesture-perf-eval.mjs";

// Builds a synthetic CDP `.cpuprofile`-shaped object: `spec` is [functionName, url, sampleCount][].
function fakeProfile(spec) {
  const nodes = spec.map(([functionName, url], i) => ({
    id: i + 1,
    callFrame: { functionName, url },
  }));
  const samples = [];
  spec.forEach(([, , count], i) => {
    for (let n = 0; n < count; n++) samples.push(i + 1);
  });
  return { nodes, samples };
}

test("computeFunctionShares: aggregates samples by functionName|url, sorted descending", () => {
  const profile = fakeProfile([
    ["render", "wall-rail.ts", 70],
    ["project", "wall-rail.ts", 20],
    ["(idle)", "", 10],
  ]);
  const shares = computeFunctionShares(profile);
  assert.equal(shares.length, 3);
  assert.equal(shares[0].key, "render|wall-rail.ts");
  assert.equal(shares[0].count, 70);
  assert.equal(shares[0].sharePct, 70);
  assert.equal(shares[1].sharePct, 20);
  assert.equal(shares[2].key, "(idle)|");
});

test("computeFunctionShares: sums a function across multiple call-tree nodes at different sites", () => {
  const profile = fakeProfile([
    ["renderer", "wall-rail.ts", 30],
    ["renderer", "wall-rail.ts", 40], // same function, different node id — must be summed together
    ["other", "chart.ts", 30],
  ]);
  const shares = computeFunctionShares(profile);
  const renderer = shares.find((s) => s.key === "renderer|wall-rail.ts");
  assert.equal(renderer.count, 70);
  assert.equal(renderer.sharePct, 70);
});

test("computeFunctionShares: empty profile returns empty array, no division by zero", () => {
  assert.deepEqual(computeFunctionShares({ nodes: [], samples: [] }), []);
  assert.deepEqual(computeFunctionShares({}), []);
});

test("evaluateGesturePerfGuard: no samples captured is a hard FAIL, not a clean pass", () => {
  const result = evaluateGesturePerfGuard({ nodes: [], samples: [] });
  assert.equal(result.pass, false);
  assert.match(result.reason, /no samples captured/);
  assert.equal(result.totalSamples, 0);
});

test("evaluateGesturePerfGuard: passes when the hottest real function is under the cap", () => {
  const profile = fakeProfile([
    ["(idle)", "", 800], // excluded by default ignore list — mostly idle is fine, the opposite of the bug
    ["render", "chart.ts", 100],
    ["project", "wall-rail.ts", 100],
  ]);
  const result = evaluateGesturePerfGuard(profile, { maxSharePct: 15 });
  assert.equal(result.pass, true);
  assert.equal(result.reason, null);
  assert.equal(result.hottest.key, "render|chart.ts");
});

test("evaluateGesturePerfGuard: fails and names the offender when one function dominates — the original bug's signature", () => {
  // Mirrors the measured wall-rail regression: one function at 31% of all samples during a gesture.
  const profile = fakeProfile([
    ["renderer", "vector-wall-rail-primitive.ts", 310],
    ["a", "chart.ts", 200],
    ["b", "chart.ts", 200],
    ["c", "chart.ts", 200],
    ["(idle)", "", 90],
  ]);
  const result = evaluateGesturePerfGuard(profile, { maxSharePct: 15 });
  assert.equal(result.pass, false);
  assert.equal(result.hottest.key, "renderer|vector-wall-rail-primitive.ts");
  assert.equal(result.hottest.sharePct, 31);
  assert.match(result.reason, /renderer\|vector-wall-rail-primitive\.ts consumed 31\.0% of all samples \(cap 15%\)/);
});

test("evaluateGesturePerfGuard: boundary is inclusive — exactly maxSharePct passes", () => {
  const profile = fakeProfile([
    ["render", "chart.ts", 15], // hottest real function, exactly at the cap
    ["a", "chart.ts", 5],
    ["(idle)", "", 80],
  ]);
  const result = evaluateGesturePerfGuard(profile, { maxSharePct: 15 });
  assert.equal(result.hottest.key, "render|chart.ts");
  assert.equal(result.pass, true);
});

test("evaluateGesturePerfGuard: idle/program/GC pseudo-frames never fail the guard on their own", () => {
  const profile = fakeProfile([["(idle)", "", 1000]]);
  const result = evaluateGesturePerfGuard(profile, { maxSharePct: 15 });
  assert.equal(result.pass, true);
  assert.equal(result.hottest, null);
});

test("evaluateGesturePerfGuard: custom ignoreKeys and maxSharePct are honored", () => {
  const profile = fakeProfile([
    ["knownSlowThirdParty", "vendor.js", 700],
    ["render", "chart.ts", 200],
    ["(idle)", "", 100],
  ]);
  const result = evaluateGesturePerfGuard(profile, {
    maxSharePct: 25,
    ignoreKeys: ["knownSlowThirdParty|vendor.js"],
  });
  assert.equal(result.pass, true);
  assert.equal(result.hottest.key, "render|chart.ts");
  assert.equal(result.hottest.sharePct, 20);
});
