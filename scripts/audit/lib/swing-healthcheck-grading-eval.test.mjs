import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSwingGradingRecord } from "./swing-healthcheck-grading-eval.mjs";

test("evaluateSwingGradingRecord reads the REAL swing shape — summary block", () => {
  // Captured live 2026-09-13, GET /api/market/swing/record.
  const real = {
    available: true,
    summary: {
      chains: 21,
      resolved_chains: 21,
      wins: 5,
      losses: 16,
      breakevens: 5,
      opens: 0,
      win_rate_pct: 23.8,
      avg_compounded_return_pct: -0.1,
      low_n: false,
    },
  };
  const checks = evaluateSwingGradingRecord(real);
  const graded = checks.find((c) => c.label === "graded positions");
  assert.equal(graded.status, "GREEN");
  assert.match(graded.detail, /21 resolved chain\(s\) of 21/);
  assert.match(graded.detail, /WR 23\.8%/);
  assert.match(graded.detail, /breakevens=5/);
  assert.equal(checks.find((c) => c.label === "wins+losses mismatch"), undefined);
  const sampleSize = checks.find((c) => c.label === "sample size");
  assert.equal(sampleSize.status, "GREEN");
});

// This is the exact regression: the OLD stage G code fetched the Legacy record endpoint
// instead and happily parsed its flat, DIFFERENTLY-SHAPED response (no `summary` key at
// all) without ever noticing it was reading the wrong product. A response with no
// `summary` block must now read as an honest AMBER, not silently produce Legacy's numbers
// under a swing-labeled check.
test("evaluateSwingGradingRecord reports AMBER (not a silent wrong-product read) when the response has no summary block — the Legacy-endpoint regression shape", () => {
  const legacyShaped = {
    available: true,
    total_resolved: 68,
    win_rate_pct: 66.7,
    methodology: "v2_fillability",
    pending_count: 2,
    segments: { current: { scoreable: 54, wins: 2, losses: 1, win_rate_pct: 66.7 } },
    by_conviction: [{ conviction: "A", n: 5 }],
  };
  const checks = evaluateSwingGradingRecord(legacyShaped);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, "AMBER");
  assert.equal(checks[0].label, "no summary block");
});

test("evaluateSwingGradingRecord reports AMBER when there is no record response at all", () => {
  const checks = evaluateSwingGradingRecord(null);
  assert.equal(checks[0].status, "AMBER");
  assert.equal(checks[0].label, "record endpoint");
});

test("evaluateSwingGradingRecord reports AMBER when available:false", () => {
  const checks = evaluateSwingGradingRecord({ available: false, error: "db timeout" });
  assert.equal(checks[0].status, "AMBER");
  assert.equal(checks[0].label, "record unavailable");
  assert.match(checks[0].detail, /db timeout/);
});

test("evaluateSwingGradingRecord reports AMBER when no chains have resolved yet", () => {
  const checks = evaluateSwingGradingRecord({
    available: true,
    summary: { chains: 3, resolved_chains: 0, wins: 0, losses: 0, breakevens: 0, opens: 3, win_rate_pct: null, low_n: true },
  });
  const graded = checks.find((c) => c.label === "no graded positions");
  assert.ok(graded);
  assert.equal(graded.status, "AMBER");
  // No sample-size or mismatch check when there is nothing resolved to size.
  assert.equal(checks.length, 1);
});

test("evaluateSwingGradingRecord flags a wins+losses accounting mismatch rather than trusting it silently", () => {
  const checks = evaluateSwingGradingRecord({
    available: true,
    summary: { chains: 10, resolved_chains: 10, wins: 4, losses: 4, breakevens: 1, opens: 0, win_rate_pct: 40, low_n: false },
  });
  const mismatch = checks.find((c) => c.label === "wins+losses mismatch");
  assert.ok(mismatch, "4+4=8 != resolved_chains=10 must be flagged");
  assert.equal(mismatch.status, "AMBER");
});

test("evaluateSwingGradingRecord flags low_n as AMBER on a thin resolved population", () => {
  const checks = evaluateSwingGradingRecord({
    available: true,
    summary: { chains: 4, resolved_chains: 4, wins: 1, losses: 3, breakevens: 0, opens: 0, win_rate_pct: 25, low_n: true },
  });
  const sampleSize = checks.find((c) => c.label === "sample size");
  assert.equal(sampleSize.status, "AMBER");
  assert.match(sampleSize.detail, /low_n=true/);
});
