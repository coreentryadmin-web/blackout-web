import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectIronCondor,
  widthPctForWinRate,
  estWinRateForWidth,
  strikeIncrementFor,
  CONDOR_WINRATE_BY_WIDTH,
} from "./iron-condor";

// ── the measured width→WR table (evidence guardrail) ────────────────────────────
test("CONDOR_WINRATE_BY_WIDTH is monotonic: wider strikes never lower the win rate", () => {
  for (let i = 1; i < CONDOR_WINRATE_BY_WIDTH.length; i++) {
    assert.ok(CONDOR_WINRATE_BY_WIDTH[i]!.width_pct > CONDOR_WINRATE_BY_WIDTH[i - 1]!.width_pct);
    assert.ok(CONDOR_WINRATE_BY_WIDTH[i]!.win_rate >= CONDOR_WINRATE_BY_WIDTH[i - 1]!.win_rate);
  }
});

// ── widthPctForWinRate (target WR → smallest width that clears it) ───────────────
test("widthPctForWinRate: picks the smallest width whose measured WR >= target", () => {
  assert.equal(widthPctForWinRate(61), 0.004); // exact table hit
  assert.equal(widthPctForWinRate(77), 0.006); // exact table hit
  assert.equal(widthPctForWinRate(80), 0.008); // 0.006→77 misses; 0.008→92 clears
  assert.equal(widthPctForWinRate(92), 0.008);
  assert.equal(widthPctForWinRate(50), 0.004); // below the table floor → tightest
});

test("widthPctForWinRate: target above the table falls back to the widest (most conservative)", () => {
  assert.equal(widthPctForWinRate(100), 0.015);
  assert.equal(widthPctForWinRate(101), 0.015); // unreachable target → widest available
});

// ── estWinRateForWidth (width → nearest-not-above measured WR) ───────────────────
test("estWinRateForWidth: maps a width to the highest measured row it clears", () => {
  assert.equal(estWinRateForWidth(0.004), 61);
  assert.equal(estWinRateForWidth(0.006), 77);
  assert.equal(estWinRateForWidth(0.0085), 92); // between 0.008 and 0.010 → 92
  assert.equal(estWinRateForWidth(0.02), 100); // beyond widest → 100
  assert.equal(estWinRateForWidth(0.003), 61); // below floor → floored at 61 (never called in practice)
});

// ── strikeIncrementFor (listing granularity by price band) ──────────────────────
test("strikeIncrementFor: standard increments by underlying price", () => {
  assert.equal(strikeIncrementFor(18), 0.5);
  assert.equal(strikeIncrementFor(60), 1);
  assert.equal(strikeIncrementFor(150), 2.5);
  assert.equal(strikeIncrementFor(6000), 5);
});

// ── selectIronCondor: symmetric geometry with no walls ──────────────────────────
test("selectIronCondor: no walls, target 80 → symmetric ~0.83% shorts + defined wings", () => {
  const legs = selectIronCondor({ spot: 6000, targetWinRate: 80 });
  assert.ok(legs);
  // width 0.008 → callTarget 6048 (roundUp/5 → 6050), putTarget 5952 (roundDown/5 → 5950)
  assert.equal(legs!.short_call, 6050);
  assert.equal(legs!.short_put, 5950);
  // shorts sit outside spot on both sides
  assert.ok(legs!.short_call > 6000 && legs!.short_put < 6000);
  // wings: 0.5%·6000 = 30pts beyond each short
  assert.equal(legs!.long_call, 6080);
  assert.equal(legs!.long_put, 5920);
  assert.equal(legs!.wing_pts, 30);
  // longs are strictly further from spot than shorts (defined risk)
  assert.ok(legs!.long_call > legs!.short_call && legs!.long_put < legs!.short_put);
  // gross wing risk per side = wing_pts * 100
  assert.equal(legs!.gross_wing_risk_per_side, 3000);
  // tighter width ≈ 0.83% → 92% table row
  assert.equal(legs!.est_win_rate, 92);
});

// ── selectIronCondor: dealer walls push shorts FURTHER out, never pull them in ───
test("selectIronCondor: a wall beyond the width pushes the short strike out to the wall", () => {
  const legs = selectIronCondor({ spot: 6000, targetWinRate: 80, callWall: 6100, putWall: 5880 });
  assert.ok(legs);
  // callWall 6100 > width target 6048 → short call pushed to the wall
  assert.equal(legs!.short_call, 6100);
  // putWall 5880 < width target 5952 → short put pushed down to the wall
  assert.equal(legs!.short_put, 5880);
  // still further from spot than the plain-width strikes would have been
  assert.ok(legs!.short_call >= 6050 && legs!.short_put <= 5950);
});

test("selectIronCondor: a wall INSIDE the width is ignored — we never sell tighter than the target", () => {
  const legs = selectIronCondor({ spot: 6000, targetWinRate: 80, callWall: 6020, putWall: 5980 });
  assert.ok(legs);
  // walls (6020/5980) are closer than the width strikes (6050/5950) → width wins
  assert.equal(legs!.short_call, 6050);
  assert.equal(legs!.short_put, 5950);
});

// ── selectIronCondor: explicit width override + custom wing ──────────────────────
test("selectIronCondor: shortWidthPct overrides targetWinRate; wingPts sets defined risk", () => {
  const legs = selectIronCondor({ spot: 500, shortWidthPct: 0.01, wingPts: 5, strikeIncrement: 1 });
  assert.ok(legs);
  // 1% of 500 = 5 → call 505, put 495
  assert.equal(legs!.short_call, 505);
  assert.equal(legs!.short_put, 495);
  assert.equal(legs!.long_call, 510);
  assert.equal(legs!.long_put, 490);
  assert.equal(legs!.wing_pts, 5);
  assert.ok(Math.abs(legs!.call_width_pct - 0.01) < 1e-9);
});

// ── selectIronCondor: bad inputs return null (no NaN geometry escapes) ───────────
test("selectIronCondor: rejects non-positive / non-finite spot and width", () => {
  assert.equal(selectIronCondor({ spot: 0, targetWinRate: 80 }), null);
  assert.equal(selectIronCondor({ spot: -100, targetWinRate: 80 }), null);
  assert.equal(selectIronCondor({ spot: Number.NaN, targetWinRate: 80 }), null);
  assert.equal(selectIronCondor({ spot: 6000, shortWidthPct: 0 }), null);
  assert.equal(selectIronCondor({ spot: 6000, shortWidthPct: -0.01 }), null);
});

test("selectIronCondor: a NaN wall is treated as absent (falls back to the width)", () => {
  const legs = selectIronCondor({ spot: 6000, targetWinRate: 80, callWall: Number.NaN, putWall: null });
  assert.ok(legs);
  assert.equal(legs!.short_call, 6050);
  assert.equal(legs!.short_put, 5950);
});
