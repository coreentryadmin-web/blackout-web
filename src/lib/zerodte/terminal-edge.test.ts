import assert from "node:assert/strict";
import test from "node:test";
import { excursionBar, formatWinRateCi, signColorClass } from "./terminal-edge";

// ── excursionBar (MAE/MFE placement) ──────────────────────────────────────────────────
test("excursion: current placed proportionally between MAE and MFE", () => {
  // worst −40%, best +80%, current +20% → 60/120 = 0.5 of the way up.
  const b = excursionBar(80, -40, 20)!;
  assert.equal(b.best, 80);
  assert.equal(b.worst, -40);
  assert.equal(b.range, 120);
  assert.equal(b.currentFrac, 0.5);
  assert.equal(b.bestIsUp, true);
  assert.equal(b.worstIsDown, true);
});

test("excursion: current at the MFE sits at 1, at the MAE sits at 0", () => {
  assert.equal(excursionBar(80, -40, 80)!.currentFrac, 1);
  assert.equal(excursionBar(80, -40, -40)!.currentFrac, 0);
});

test("excursion: current beyond the extremes is clamped to [0,1]", () => {
  assert.equal(excursionBar(50, 10, 90)!.currentFrac, 1); // above best
  assert.equal(excursionBar(50, 10, -5)!.currentFrac, 0); // below worst
});

test("excursion: all-green run (worst > 0) → worstIsDown false, bestIsUp true", () => {
  const b = excursionBar(60, 15, 30)!;
  assert.equal(b.worstIsDown, false);
  assert.equal(b.bestIsUp, true);
  assert.equal(b.currentFrac, (30 - 15) / (60 - 15));
});

test("excursion (condor structure-aware): adapter-supplied seller-framed extremes lay out normally", () => {
  // A condor's peak/trough/pnl arrive ALREADY seller-framed from the adapter (best = deepest
  // decay). This helper never re-inverts — it just places them. best +76, worst −50, now +40.
  const b = excursionBar(76, -50, 40)!;
  assert.equal(b.best, 76);
  assert.equal(b.worst, -50);
  assert.ok(Math.abs(b.currentFrac! - (40 - -50) / (76 - -50)) < 1e-9);
});

test("excursion: inverted inputs (best < worst) are ordered defensively", () => {
  const b = excursionBar(-10, 30, 10)!; // swapped
  assert.equal(b.best, 30);
  assert.equal(b.worst, -10);
  assert.equal(b.currentFrac, (10 - -10) / (30 - -10));
});

test("excursion: zero-width range centers the marker (no spread to place it on)", () => {
  const b = excursionBar(20, 20, 20)!;
  assert.equal(b.range, 0);
  assert.equal(b.currentFrac, 0.5);
});

test("excursion: null-safe — missing either extreme → null (nothing to draw)", () => {
  assert.equal(excursionBar(null, -40, 20), null);
  assert.equal(excursionBar(80, null, 20), null);
  assert.equal(excursionBar(undefined, undefined, undefined), null);
  assert.equal(excursionBar(Number.NaN, -40, 20), null);
});

test("excursion: absent current → currentFrac null but the range still renders", () => {
  const b = excursionBar(80, -40, null)!;
  assert.equal(b.currentFrac, null);
  assert.equal(b.range, 120);
});

// ── formatWinRateCi (Wilson interval formatting) ──────────────────────────────────────
test("wilson-CI format: interval present → '63% WR (95% CI 55–70%, n=214)'", () => {
  assert.equal(
    formatWinRateCi({ winRate: 63, n: 214, ciLow: 55, ciHigh: 70 }),
    "63% WR (95% CI 55–70%, n=214)",
  );
});

test("wilson-CI format: CI absent → explicit 'CI n/a', never a bare estimate", () => {
  const s = formatWinRateCi({ winRate: 63, n: 214 });
  assert.equal(s, "63% WR (n=214 · CI n/a)");
  assert.match(s, /CI n\/a/);
});

test("wilson-CI format: partial CI (only one bound) → CI n/a (never a half-fabricated interval)", () => {
  assert.equal(formatWinRateCi({ winRate: 63, n: 214, ciLow: 55, ciHigh: null }), "63% WR (n=214 · CI n/a)");
  assert.equal(formatWinRateCi({ winRate: 63, n: 214, ciLow: null, ciHigh: 70 }), "63% WR (n=214 · CI n/a)");
});

test("wilson-CI format: never renders a bare point estimate (always has CI or n/a)", () => {
  for (const s of [
    formatWinRateCi({ winRate: 80, n: 10, ciLow: 49, ciHigh: 94 }),
    formatWinRateCi({ winRate: 80, n: 10 }),
  ]) {
    assert.match(s, /WR \(/); // always parenthesized context after the WR
  }
});

test("wilson-CI format: swapped bounds are ordered low→high defensively", () => {
  assert.equal(formatWinRateCi({ winRate: 63, n: 214, ciLow: 70, ciHigh: 55 }), "63% WR (95% CI 55–70%, n=214)");
});

test("wilson-CI format: non-finite win-rate (n=0 → 0/0) never renders 'NaN% WR'", () => {
  const s = formatWinRateCi({ winRate: Number.NaN, n: 0 });
  assert.equal(s, "— WR (n=0 · CI n/a)");
  assert.doesNotMatch(s, /NaN/);
});

test("wilson-CI format: non-finite win-rate ignores any bounds (no rate → no interval)", () => {
  assert.equal(formatWinRateCi({ winRate: Number.NaN, n: 12, ciLow: 40, ciHigh: 60 }), "— WR (n=12 · CI n/a)");
});

// ── signColorClass — cap/label color follows SIGN, not position ────────────────────────
test("signColorClass: positive→up (green), negative→dn (red), zero→flat (neutral)", () => {
  assert.equal(signColorClass(15), "up");
  assert.equal(signColorClass(-5), "dn");
  assert.equal(signColorClass(0), "flat");
});

test("signColorClass: an all-GREEN run colors BOTH caps up (MAE +15 is green, not red)", () => {
  const b = excursionBar(60, 15, 30)!; // best +60, worst +15 — both positive
  assert.equal(signColorClass(b.worst), "up"); // the MAE cap is green, honest to its sign
  assert.equal(signColorClass(b.best), "up");
});

test("signColorClass: an all-RED run colors BOTH caps dn (MFE −5 is red, not green)", () => {
  const b = excursionBar(-5, -30, -20)!; // best −5, worst −30 — both negative
  assert.equal(signColorClass(b.best), "dn"); // the MFE cap is red, honest to its sign
  assert.equal(signColorClass(b.worst), "dn");
});
