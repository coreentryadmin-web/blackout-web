import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBeta, fetchNameBeta, FETCH_NAME_BETA_DEFERRED, MIN_BETA_RETURNS, type CloseBar } from "./beta.ts";

/** Build a close series from a starting price and a list of daily returns. */
function closesFromReturns(start: number, returns: number[]): CloseBar[] {
  const bars: CloseBar[] = [{ c: start }];
  let px = start;
  for (const r of returns) {
    px = px * (1 + r);
    bars.push({ c: px });
  }
  return bars;
}

// A varied (non-constant) index return series so var(index) > 0.
const INDEX_RETURNS = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? 0.012 : i % 3 === 1 ? -0.006 : 0.02));

test("OLS beta recovers the exact slope on a synthetic series (name_ret = 2 × index_ret)", () => {
  const indexBars = closesFromReturns(100, INDEX_RETURNS);
  const nameBars = closesFromReturns(50, INDEX_RETURNS.map((r) => 2 * r));
  const res = computeBeta(nameBars, indexBars);
  assert.equal(res.betaMissing, false);
  assert.ok(res.beta != null);
  assert.ok(Math.abs((res.beta as number) - 2) < 1e-9, `beta ${res.beta} ≈ 2`);
  assert.equal(res.n, INDEX_RETURNS.length); // 30 returns
});

test("OLS beta ~0.5 on a half-tracking series", () => {
  const indexBars = closesFromReturns(100, INDEX_RETURNS);
  const nameBars = closesFromReturns(50, INDEX_RETURNS.map((r) => 0.5 * r));
  const res = computeBeta(nameBars, indexBars);
  assert.ok(res.beta != null && Math.abs(res.beta - 0.5) < 1e-9);
});

test("betaMissing on thin overlap (fewer than MIN_BETA_RETURNS pairs)", () => {
  const short = closesFromReturns(100, INDEX_RETURNS.slice(0, 8)); // 9 bars → 8 returns
  const res = computeBeta(short, short);
  assert.equal(res.betaMissing, true);
  assert.equal(res.beta, null);
  assert.ok(res.n < MIN_BETA_RETURNS);
});

test("betaMissing when the index has zero return variance (nothing to regress against)", () => {
  const flatIndex: CloseBar[] = Array.from({ length: 31 }, () => ({ c: 100 })); // all-flat → varX 0
  const nameBars = closesFromReturns(50, INDEX_RETURNS);
  const res = computeBeta(nameBars, flatIndex);
  assert.equal(res.betaMissing, true);
  assert.equal(res.beta, null);
});

test("timestamp-aligned inner join pairs the same sessions", () => {
  // Same returns but the name series carries an extra leading bar the index doesn't — join on t must drop it.
  const base = INDEX_RETURNS;
  const indexBars: CloseBar[] = closesFromReturns(100, base).map((b, i) => ({ t: i + 1, c: b.c }));
  const nameRaw = closesFromReturns(50, base.map((r) => 3 * r)).map((b, i) => ({ t: i + 1, c: b.c }));
  const nameBars: CloseBar[] = [{ t: 0, c: 49 }, ...nameRaw]; // extra unmatched bar at t=0
  const res = computeBeta(nameBars, indexBars);
  assert.ok(res.beta != null && Math.abs(res.beta - 3) < 1e-9);
});

test("fetchNameBeta is a documented DEFERRED stub — no IO, always betaMissing", async () => {
  assert.equal(FETCH_NAME_BETA_DEFERRED, true);
  const res = await fetchNameBeta("NVDA");
  assert.deepEqual(res, { beta: null, betaMissing: true, n: 0 });
});
