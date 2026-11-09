import { test } from "node:test";
import assert from "node:assert/strict";
import { signedExcursionPct } from "./underlying-excursion";

// BUG FIX (Ask Largo standing mandate, 2026-11-09): `signedExcursionPct`'s internal `pct()` helper
// used plain `Math.round(n * 1e4) / 1e4`, which ties toward +Infinity (`Math.round(-7812.5) ===
// -7812` but `Math.round(7812.5) === 7813`). A mirror-image favorable/adverse move from the same
// entry price should produce EQUAL-MAGNITUDE mfePct/maePct, but a value sitting exactly on a tie
// rounded asymmetrically. `signedExcursionPct`'s own output feeds the persisted `running_mfe`/
// `running_mae` snapshot fields, which feature-store.ts's trajectory studies compare against named
// thresholds (`studyIvKillsGoodSetups`: running_mae vs a -3% threshold) — so the bias isn't purely
// cosmetic, it can tip a borderline position's classification right at the boundary.
test("signedExcursionPct (LONG): a mirror-image tie above/below entry rounds to the SAME magnitude", () => {
  // entry=2, lo=1.984375, hi=2.015625 — both exact dyadic fractions of entry (a power of two), so
  // the raw percent*1e4 value lands EXACTLY on a tie (±7812.5), not merely close to one (ordinary
  // floating-point division noise would mask the bug on an inexact near-tie).
  const { mfePct, maePct } = signedExcursionPct({
    direction: "long",
    entryPx: 2,
    spot: 2.015625,
    priorMfePx: 2.015625,
    priorMaePx: 1.984375,
  });
  assert.equal(mfePct, 0.7813, "favorable tie rounds away from zero");
  // Pre-fix this was -0.7812 (a SMALLER magnitude than mfePct's 0.7813) — the bug.
  assert.equal(maePct, -0.7813, "adverse tie must round to the SAME magnitude as the favorable one");
  assert.equal(Math.abs(mfePct!), Math.abs(maePct!));
});

test("signedExcursionPct (SHORT): the mirrored tie still rounds to the SAME magnitude after the SHORT negation", () => {
  // SHORT negates pct(lo)/pct(hi) relative to LONG (profits when price falls) — confirm the fix
  // survives that extra sign flip rather than only being checked on the LONG path.
  const { mfePct, maePct } = signedExcursionPct({
    direction: "short",
    entryPx: 2,
    spot: 1.984375,
    priorMfePx: 2.015625,
    priorMaePx: 1.984375,
  });
  assert.equal(mfePct, 0.7813, "SHORT favorable (price fell) still rounds away from zero");
  assert.equal(maePct, -0.7813, "SHORT adverse (price rose) must match the favorable magnitude");
  assert.equal(Math.abs(mfePct!), Math.abs(maePct!));
});

test("signedExcursionPct: honest null when entry or spot is missing/invalid", () => {
  assert.deepEqual(signedExcursionPct({ direction: "long", entryPx: null, spot: 10 }), {
    mfePct: null,
    maePct: null,
  });
  assert.deepEqual(signedExcursionPct({ direction: "long", entryPx: 10, spot: null }), {
    mfePct: null,
    maePct: null,
  });
  assert.deepEqual(signedExcursionPct({ direction: "long", entryPx: 0, spot: 10 }), {
    mfePct: null,
    maePct: null,
  });
});

test("signedExcursionPct: a fresh position with no prior extremes seeds MFE >= 0 / MAE <= 0 at entry", () => {
  const { mfePct, maePct } = signedExcursionPct({ direction: "long", entryPx: 100, spot: 100 });
  assert.equal(mfePct, 0);
  assert.equal(maePct, 0);
});

test("signedExcursionPct: an ordinary (non-tie) move still rounds normally, unaffected by the fix", () => {
  const { mfePct, maePct } = signedExcursionPct({
    direction: "long",
    entryPx: 50,
    spot: 55,
    priorMfePx: 55,
    priorMaePx: 48,
  });
  assert.equal(mfePct, 10); // (55-50)/50*100
  assert.equal(maePct, -4); // (48-50)/50*100
});
