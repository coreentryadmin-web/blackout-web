import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crossValidateGexLevels,
  cumulativeGammaFlip,
  cumulativeGammaFlipDetail,
  resolveNearTermExpiriesForCrossValidation,
  restFallbackAllowed,
  uwLevelsFromLadder,
  wallsFromStrikeTotals,
  zeroGammaFlip,
} from "./gex-cross-validation-core";

// ── cumulativeGammaFlip: the SpotGamma-standard GAMMA flip (aggregate zero-gamma boundary) ──
test("cumulativeGammaFlip: net-short→net-long crossing nearest spot", () => {
  // cumulative: 90→-30, 100→-20, 110→+20 → running total crosses 0 at 100+(20/40)*10 = 105.
  assert.equal(cumulativeGammaFlip({ "90": -30, "100": 10, "110": 40 }, 100), 105);
});

test("cumulativeGammaFlip: net-short-across-the-book → null; per-strike flip would INVERT the regime", () => {
  // Ladder has per-strike sign flips (700→710 neg→pos, 720→730 pos→neg) but cumulative net gamma is
  // negative at EVERY strike (-2,-5,-4.9,-2.9,-3.0 e9) — dealers are short gamma throughout, so the
  // honest gamma flip is null. The old per-strike zeroGammaFlip returns 709.68 (below spot 715),
  // which computeGexRegime would read as spot≥flip → "long gamma" — the exact inversion this fixes.
  const ladder = { "698": -2e9, "700": -3e9, "710": 1e8, "720": 2e9, "730": -1e8 };
  assert.equal(cumulativeGammaFlip(ladder, 715), null);
  assert.equal(zeroGammaFlip(ladder, 715), 709.68); // contrast: the old per-strike answer
});

test("cumulativeGammaFlip: rejects a crossing outside the ±12% plausibility band", () => {
  // only crossing is ~48, >12% from spot 100 → thin-far-strike artifact → null
  assert.equal(cumulativeGammaFlip({ "45": -10, "55": 30, "150": -1 }, 100), null);
});

test("cumulativeGammaFlip: fewer than 2 strikes → null", () => {
  assert.equal(cumulativeGammaFlip({ "100": 50 }, 100), null);
});

// ── the null CAUSE. The three tests above are the three distinct ways `flip` becomes null, and
// until now they were indistinguishable to every caller. Each one is re-asserted here through the
// detail API so a future refactor cannot silently collapse two causes back into one.
test("cumulativeGammaFlipDetail: a resolved flip reports reason=resolved and its crossing count", () => {
  const d = cumulativeGammaFlipDetail({ "90": -30, "100": 10, "110": 40 }, 100);
  assert.equal(d.flip, 105);
  assert.equal(d.reason, "resolved");
  assert.equal(d.crossings, 1);
  assert.equal(d.nearestCrossing, 105);
});

test("cumulativeGammaFlipDetail: net-short everywhere → net_short_everywhere, NOT a data outage", () => {
  // Same ladder as the regime-inversion test above. This null is an honest structural read —
  // there is no long-gamma region — and must never be reported as missing data.
  const d = cumulativeGammaFlipDetail({ "698": -2e9, "700": -3e9, "710": 1e8, "720": 2e9, "730": -1e8 }, 715);
  assert.equal(d.flip, null);
  assert.equal(d.reason, "net_short_everywhere");
  assert.equal(d.crossings, 0);
  assert.equal(d.nearestCrossing, null);
});

test("cumulativeGammaFlipDetail: far crossing → crossings_far_from_spot, and KEEPS the rejected level", () => {
  const d = cumulativeGammaFlipDetail({ "45": -10, "55": 30, "150": -1 }, 100);
  assert.equal(d.flip, null);
  assert.equal(d.reason, "crossings_far_from_spot");
  assert.equal(d.crossings, 1);
  // The rejected crossing survives on the detail so this case is diagnosable without a re-run —
  // that is the whole point of the field, and a null here would defeat it.
  assert.ok(d.nearestCrossing !== null && d.nearestCrossing < 55);
});

test("cumulativeGammaFlipDetail: fewer than 2 strikes → insufficient_strikes (a data outage)", () => {
  const d = cumulativeGammaFlipDetail({ "100": 50 }, 100);
  assert.equal(d.flip, null);
  assert.equal(d.reason, "insufficient_strikes");
});

test("cumulativeGammaFlipDetail: the three null causes are all distinct", () => {
  const reasons = new Set([
    cumulativeGammaFlipDetail({ "698": -2e9, "700": -3e9, "710": 1e8, "720": 2e9, "730": -1e8 }, 715).reason,
    cumulativeGammaFlipDetail({ "45": -10, "55": 30, "150": -1 }, 100).reason,
    cumulativeGammaFlipDetail({ "100": 50 }, 100).reason,
  ]);
  assert.equal(reasons.size, 3);
});

test("cumulativeGammaFlip stays byte-identical to the detail's flip across every path", () => {
  const cases: Array<[Record<string, number>, number]> = [
    [{ "90": -30, "100": 10, "110": 40 }, 100],
    [{ "698": -2e9, "700": -3e9, "710": 1e8, "720": 2e9, "730": -1e8 }, 715],
    [{ "45": -10, "55": 30, "150": -1 }, 100],
    [{ "100": 50 }, 100],
    [{ "90": -30, "100": 10, "110": 40 }, 0], // spot unknown → last crossing, no band filter
  ];
  for (const [totals, spot] of cases) {
    assert.equal(cumulativeGammaFlip(totals, spot), cumulativeGammaFlipDetail(totals, spot).flip);
  }
});

test("REST fallback is disallowed when the caller requires expiry scoping", () => {
  assert.equal(restFallbackAllowed(["2026-07-01", "2026-07-02"]), false);
});

test("REST fallback is allowed when no scoping is requested (back-compat, no current caller)", () => {
  assert.equal(restFallbackAllowed(undefined), true);
});

test("an empty nearTermExpiries array is treated as unscoped (REST allowed)", () => {
  assert.equal(restFallbackAllowed([]), true);
});

// Regression: two live call sites (gex-positioning.ts, gex-heatmap/route.ts) used
// `heatmap.expiries.slice(0, 8)` instead of the authoritative `near_term_expiries` field.
// On a thin-chain ticker (real near-term expiry count < 8), the post-far-merge, sorted
// `expiries` array pads the slice with far-dated monthly/quarterly columns — reintroducing
// the exact bug class resolveExpiryAxis() (polygon-options-gex.ts) was built to prevent.
test("resolveNearTermExpiriesForCrossValidation prefers the authoritative near_term_expiries field", () => {
  const hm = {
    near_term_expiries: ["2026-07-10", "2026-07-17"],
    expiries: ["2026-07-10", "2026-07-17", "2026-08-21", "2026-09-18"],
  };
  assert.deepEqual(resolveNearTermExpiriesForCrossValidation(hm), ["2026-07-10", "2026-07-17"]);
});

test("resolveNearTermExpiriesForCrossValidation: thin chain — near_term_expiries stays short, NOT padded to 8 with far-dated columns", () => {
  // A thin single-name chain: only 2 real near-term (weekly) expiries exist, then 2
  // far-dated monthlies got merged into `expiries` for the matrix's far-dated columns.
  const hm = {
    near_term_expiries: ["2026-07-10", "2026-07-17"],
    expiries: ["2026-07-10", "2026-07-17", "2026-08-21", "2026-09-18"],
  };
  const result = resolveNearTermExpiriesForCrossValidation(hm);
  assert.equal(result?.length, 2, "must NOT silently pad to 8 with the far-dated columns");
  assert.ok(!result?.includes("2026-08-21"), "far-dated monthly must not leak into the near-term scope");
});

test("resolveNearTermExpiriesForCrossValidation: legacy cached heatmap (no near_term_expiries field) falls back to the slice", () => {
  const hm = { expiries: Array.from({ length: 10 }, (_, i) => `2026-07-${10 + i}`) };
  const result = resolveNearTermExpiriesForCrossValidation(hm);
  assert.equal(result?.length, 8);
  assert.deepEqual(result, hm.expiries.slice(0, 8));
});

test("resolveNearTermExpiriesForCrossValidation: empty near_term_expiries array falls back to the slice, not an empty scope", () => {
  const hm = { near_term_expiries: [], expiries: Array.from({ length: 10 }, (_, i) => `2026-07-${10 + i}`) };
  const result = resolveNearTermExpiriesForCrossValidation(hm);
  assert.equal(result?.length, 8);
});

test("resolveNearTermExpiriesForCrossValidation: null/undefined heatmap returns undefined (unscoped)", () => {
  assert.equal(resolveNearTermExpiriesForCrossValidation(null), undefined);
  assert.equal(resolveNearTermExpiriesForCrossValidation(undefined), undefined);
});

test("wallsFromStrikeTotals picks max positive call and max negative put", () => {
  const { callWall, putWall } = wallsFromStrikeTotals({
    "700": -1e9,
    "710": 5e8,
    "720": 2e9,
    "730": -5e8,
  });
  assert.equal(callWall, 720);
  assert.equal(putWall, 700);
});

test("uwLevelsFromLadder is sign-aware — call wall is not the largest |GEX| if negative", () => {
  const ladder = new Map<number, number>([
    [700, -3e9],
    [710, 1e8],
    [720, 2e9],
    [730, -1e8],
  ]);
  const uw = uwLevelsFromLadder(ladder, 715);
  assert.equal(uw.callWall, 720);
  assert.equal(uw.putWall, 700);
  assert.notEqual(uw.callWall, 700);
});

test("crossValidateGexLevels matches when primary aligns with signed UW extrema", () => {
  const ladder = new Map<number, number>([
    [698, -2e9],
    [700, -3e9],
    [710, 1e8],
    [720, 2e9],
    [730, -1e8],
  ]);
  const result = crossValidateGexLevels(
    { callWall: 720, putWall: 700, gammaFlip: 705 },
    ladder,
    { spot: 715 }
  );
  assert.ok(result);
  assert.equal(result!.callWallMatch, true);
  assert.equal(result!.putWallMatch, true);
});

test("crossValidateGexLevels does not false-flag correct call wall vs top-|GEX| negative", () => {
  const ladder = new Map<number, number>([
    [700, -5e9],
    [720, 2e9],
    [740, -1e8],
  ]);
  const result = crossValidateGexLevels(
    { callWall: 720, putWall: 700, gammaFlip: null },
    ladder,
    { spot: 710 }
  );
  assert.ok(result);
  assert.equal(result!.callWallMatch, true);
  assert.equal(result!.putWallMatch, true);
});

test("crossValidateGexLevels respects ±2 strike tolerance", () => {
  const ladder = new Map<number, number>([
    [700, -1e9],
    [720, 2e9],
  ]);
  const ok = crossValidateGexLevels({ callWall: 722, putWall: 698, gammaFlip: null }, ladder);
  assert.ok(ok);
  assert.equal(ok!.callWallMatch, true);
  assert.equal(ok!.putWallMatch, true);

  const bad = crossValidateGexLevels({ callWall: 725, putWall: 698, gammaFlip: null }, ladder);
  assert.ok(bad);
  assert.equal(bad!.callWallMatch, false);
});

test("crossValidateGexLevels returns null for empty ladder", () => {
  assert.equal(crossValidateGexLevels({ callWall: 720, putWall: 700, gammaFlip: 710 }, new Map()), null);
});

// ---------------------------------------------------------------------------
// A BISTABLE FLIP: two crossings, and spot decides which one is reported.
//
// The old rule picked the plausible crossing NEAREST SPOT. On a near-zero net-GEX book the
// cumulative profile crosses zero more than once, and when two crossings sit at similar distance
// the winner is decided by where spot happens to be — so a sub-0.1% move swaps them, relocating the
// reported flip by several points and INVERTING `above_gamma_flip`, the long/short gamma posture
// the desk shows members.
//
// Observed live on SPX, 2026-08-19, one session, spot range ~0.2%:
//   13:47Z null → 14:38Z 769.15 → 15:55Z 803.98 → 16:34Z 809.14 → 16:45Z 849.17 → 17:34Z null
// An 80-point migration and two disappearances on an underlying that barely moved.
//
// This book crosses at ≈104.17 and ≈111.88, deliberately placed either side of the test spot.
// ---------------------------------------------------------------------------
const TWO_CROSSING_BOOK: Record<string, number> = {
  "100": -10, // cum -10
  "105": 12, //  cum  +2  → crossing ≈104.17
  "110": -5, //  cum  -3  → back net-short
  "115": 8, //   cum  +5  → crossing ≈111.88
  "120": 2, //   cum  +7
};

test("gamma flip is STABLE across a spot nudge that used to swap which crossing wins", () => {
  // At 108 the lower crossing is marginally nearer; at 108.1 the upper one is. Under the old
  // nearest-spot rule those two calls returned different levels ~7.7 points apart.
  const a = cumulativeGammaFlip(TWO_CROSSING_BOOK, 108);
  const b = cumulativeGammaFlip(TWO_CROSSING_BOOK, 108.1);
  assert.equal(a, b, "a 0.09% spot move must not relocate the flip");
  assert.equal(a, 104.17, "the LOWEST crossing — the textbook zero-gamma level — is reported");
});

test("both crossings are still counted and reported, so the ambiguity stays visible", () => {
  const d = cumulativeGammaFlipDetail(TWO_CROSSING_BOOK, 108);
  assert.equal(d.reason, "resolved");
  assert.equal(d.crossings, 2, "a multi-crossing book is not silently presented as a clean one");
});

test("the reported flip does not depend on spot at all while spot stays inside the window", () => {
  // The old rule made the flip a function of spot; the new one makes it a function of the BOOK.
  const levels = [103, 105, 108, 110, 112].map((s) => cumulativeGammaFlip(TWO_CROSSING_BOOK, s));
  assert.deepEqual(levels, [104.17, 104.17, 104.17, 104.17, 104.17]);
});

test("hysteresis: a supplied previous flip keeps its level when it is still a real crossing", () => {
  // A new lower crossing appearing between snapshots can still move `min`. When the caller has the
  // previous value, an incumbent within FLIP_HYSTERESIS_PCT of a plausible crossing wins.
  const d = cumulativeGammaFlipDetail(TWO_CROSSING_BOOK, 108, { previousFlip: 111.88 });
  assert.equal(d.flip, 111.88, "the incumbent level is not abandoned for a tie-break");
  // …but a previous flip that no longer corresponds to any crossing is discarded, not carried.
  const stale = cumulativeGammaFlipDetail(TWO_CROSSING_BOOK, 108, { previousFlip: 90 });
  assert.equal(stale.flip, 104.17, "a stale incumbent must never outlive the book that produced it");
});

test("REGRESSION: a single-crossing book is unaffected by the selection change", () => {
  const oneCrossing = { "100": -10, "105": 12, "110": 3 };
  assert.equal(cumulativeGammaFlip(oneCrossing, 104), 104.17);
  assert.equal(cumulativeGammaFlip(oneCrossing, 108), 104.17);
});
