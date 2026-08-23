import test from "node:test";
import assert from "node:assert/strict";

import { bucketLabel, bucketMaxTotal, barWidthPct } from "./ExpiryConcentration";

/**
 * Expiry Concentration's bars saturated exactly when one horizon started dominating.
 *
 * The buckets are built in CHRONOLOGICAL order — `["0DTE", "This week", "Monthly", "LEAPS"]` —
 * but the bar scale read its maximum off `buckets[0]`, i.e. the nearest-dated bucket that cleared
 * the $50k floor. That is the largest only by coincidence.
 *
 * Any bucket bigger than the first therefore computed a width over 100%. The rail is
 * `overflow-hidden`, so instead of overflowing they all clipped to FULL WIDTH and became visually
 * identical:
 *
 *   0DTE $1M / This week $3M / Monthly $5M
 *     before:  100%, 300%→clipped 100%, 500%→clipped 100%   (three equal-looking bars)
 *     labels:  11%,  33%,  56%                              (a 5x spread)
 *
 * The numbers were right and the picture was wrong, which is the worse way round — the bars are
 * what a member scans, and dominance is the single thing this panel exists to show.
 */

test("REGRESSION: the scale is the LARGEST bucket, not the first (chronological) one", () => {
  // Chronological order, with the biggest bucket last — the shipped ordering.
  const buckets = [{ total: 1_000_000 }, { total: 3_000_000 }, { total: 5_000_000 }];
  assert.equal(bucketMaxTotal(buckets), 5_000_000);
  assert.notEqual(bucketMaxTotal(buckets), buckets[0]!.total, "must not read the max off buckets[0]");
});

test("REGRESSION: bars stay inside the rail and remain distinguishable from each other", () => {
  const buckets = [{ total: 1_000_000 }, { total: 3_000_000 }, { total: 5_000_000 }];
  const max = bucketMaxTotal(buckets);
  const widths = buckets.map((b) => barWidthPct(b.total, max));

  for (const w of widths) assert.ok(w <= 100, `bar width ${w}% overflows the rail`);
  assert.deepEqual(widths, [20, 60, 100]);

  // The actual defect: they used to be three identical full-width bars.
  assert.equal(new Set(widths).size, 3, "three different premiums must render three different bars");
});

test("the widths are proportional to premium — the bar and the number tell the same story", () => {
  const buckets = [{ total: 2_000_000 }, { total: 8_000_000 }];
  const max = bucketMaxTotal(buckets);
  const [small, large] = buckets.map((b) => barWidthPct(b.total, max));
  assert.equal(large, 100);
  assert.equal(small, 25, "a quarter of the premium draws a quarter of the bar");
});

test("a tiny bucket keeps a visible floor rather than vanishing", () => {
  const buckets = [{ total: 60_000 }, { total: 50_000_000 }];
  const max = bucketMaxTotal(buckets);
  const w = barWidthPct(buckets[0]!.total, max);
  assert.equal(w, 8, "0.12% of the max still renders at the 8% floor");
  assert.ok(w > 0);
});

test("a single bucket fills the rail", () => {
  const buckets = [{ total: 4_200_000 }];
  assert.equal(barWidthPct(buckets[0]!.total, bucketMaxTotal(buckets)), 100);
});

test("degenerate input degrades to the floor instead of NaN%, Infinity% or a divide-by-zero", () => {
  assert.equal(bucketMaxTotal([]), 1, "empty set must not yield a zero divisor");
  assert.equal(bucketMaxTotal([{ total: 0 }, { total: 0 }]), 1);
  assert.equal(bucketMaxTotal([{ total: Number.NaN }, { total: 5 }]), 5, "NaN never becomes the max");

  for (const [total, max] of [
    [Number.NaN, 100],
    [100, Number.NaN],
    [100, 0],
    [100, -5],
    [Number.POSITIVE_INFINITY, 100],
  ] as const) {
    const w = barWidthPct(total, max);
    assert.ok(Number.isFinite(w), `barWidthPct(${total}, ${max}) = ${w} must be finite`);
    assert.ok(w >= 8 && w <= 100, `barWidthPct(${total}, ${max}) = ${w} must stay in range`);
  }
});

test("the ceiling holds even if a caller passes a max smaller than the value", () => {
  // Defence in depth: the bug was a wrong maxTotal, so the width function itself refuses to
  // exceed the rail regardless of what it is handed.
  assert.equal(barWidthPct(9_000_000, 1_000_000), 100);
});


// ── §9.5: an expired contract is not "This week" ─────────────────────────────────────────────
// The tape's `dte` is SQL's `expiry - (NOW() AT TIME ZONE 'America/New_York')::date` and is
// genuinely NEGATIVE for a print on an already-expired contract — routine, since the tape's
// default window is 7 days of history. Measured live 2026-08-22: 803 of 5000 rows (16.1%).

test("a print on an already-expired contract does not land in a FUTURE horizon", () => {
  for (const dte of [-1, -3, -30, -365]) {
    assert.notEqual(bucketLabel(dte), "This week", `dte ${dte} must not read as a future horizon`);
    assert.notEqual(bucketLabel(dte), "Monthly", `dte ${dte}`);
    assert.notEqual(bucketLabel(dte), "LEAPS", `dte ${dte}`);
    assert.equal(bucketLabel(dte), "0DTE", `dte ${dte} folds into the nearest honest bucket`);
  }
});

test("bucketLabel boundaries are unchanged for every non-negative DTE", () => {
  assert.equal(bucketLabel(0), "0DTE");
  assert.equal(bucketLabel(1), "This week");
  assert.equal(bucketLabel(7), "This week");
  assert.equal(bucketLabel(8), "Monthly");
  assert.equal(bucketLabel(30), "Monthly");
  assert.equal(bucketLabel(31), "LEAPS");
  assert.equal(bucketLabel(846), "LEAPS");
});

test("the panel and Largo bucket every DTE identically — they describe the same panel", async () => {
  // The anti-drift guarantee. These two functions answer the same question for two audiences, and
  // they HAD drifted: Largo was fixed when the defect was found, the panel was left for later, and
  // for that window the member's screen and the model's payload disagreed about a sixth of the tape.
  const { expiryHorizonLabel } = await import("@/lib/largo/helix-tape-analytics");
  for (let dte = -400; dte <= 900; dte++) {
    assert.equal(bucketLabel(dte), expiryHorizonLabel(dte), `dte ${dte}`);
  }
});
