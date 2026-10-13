import assert from "node:assert/strict";
import test from "node:test";
import type { AggBar } from "@/lib/providers/polygon-largo";
import {
  computeMomentumQuality,
  scoreMomentumQuality,
  MOMENTUM_WINDOW_DAYS,
} from "./momentum-quality";

/** Build N trailing bars with flat $100 closes and normal (1x-average) volume, then let the
 *  caller override the TAIL closes/volumes to shape the exact scenario under test. Flat-base
 *  bars give computeMomentumQuality's trailing-20-session average a stable, known denominator. */
function bars(overrides: { closes?: number[]; vols?: number[] } = {}): AggBar[] {
  const base: AggBar[] = Array.from({ length: 40 }, (_, i) => ({
    t: Date.UTC(2026, 0, 1) + i * 86_400_000,
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    v: 1_000_000,
  }));
  const closes = overrides.closes ?? [];
  const vols = overrides.vols ?? [];
  for (let i = 0; i < closes.length; i++) {
    base[base.length - closes.length + i]!.c = closes[i]!;
  }
  for (let i = 0; i < vols.length; i++) {
    base[base.length - vols.length + i]!.v = vols[i]!;
  }
  return base;
}

test("MOMENTUM_WINDOW_DAYS is 3 (sanity — tests below assume this)", () => {
  assert.equal(MOMENTUM_WINDOW_DAYS, 3);
});

test("computeMomentumQuality: honest null on insufficient bars (freshly-listed name)", () => {
  const thin = bars().slice(-10); // well under MIN_BARS_REQUIRED
  const read = computeMomentumQuality(thin);
  assert.equal(read.recent_window_return_pct, null);
  assert.equal(read.prior_window_return_pct, null);
  assert.equal(read.momentum_pattern, null);
  assert.equal(read.volume_pattern, null);
});

test("computeMomentumQuality: empty/non-array input is honest null, never throws", () => {
  const read = computeMomentumQuality([]);
  assert.equal(read.momentum_pattern, null);
});

test("computeMomentumQuality: accelerating — recent 3-day move bigger than the prior 3-day move, same direction", () => {
  // prior window (days -7..-4): 100 -> 102 (+2%). recent window (days -4..today): 102 -> 110 (+7.8%).
  const b = bars({ closes: [100, 101, 101.5, 102, 104, 107, 110] });
  const read = computeMomentumQuality(b);
  assert.ok(read.recent_window_return_pct! > 0);
  assert.ok(read.prior_window_return_pct! > 0);
  assert.equal(read.momentum_pattern, "accelerating");
});

test("computeMomentumQuality: decelerating — recent move smaller than the prior move, same direction", () => {
  // prior window: 100 -> 110 (+10%). recent window: 110 -> 111 (+0.9%).
  const b = bars({ closes: [100, 103, 106, 110, 110.3, 110.6, 111] });
  const read = computeMomentumQuality(b);
  assert.equal(read.momentum_pattern, "decelerating");
});

test("computeMomentumQuality: steady — gap between windows inside the noise floor", () => {
  const b = bars({ closes: [100, 100.2, 100.4, 100.6, 100.8, 101.0, 101.2] });
  const read = computeMomentumQuality(b);
  assert.equal(read.momentum_pattern, "steady");
});

test("computeMomentumQuality: a sign flip between windows reads as steady, never 'decelerating' — exercised with a magnitude gap well past the noise floor so the sign-flip branch itself (not the floor) is what fires", () => {
  // prior window: 100 -> 110 (+10%, up). recent window: 110 -> 88 (-20%, down) — a sharp
  // reversal, not a deceleration of the same move; |accelDelta|=10 is well past the 1.0 noise
  // floor, so "steady" here can only come from the dedicated non-sameSign branch.
  const b = bars({ closes: [100, 103, 106, 110, 100, 94, 88] });
  const read = computeMomentumQuality(b);
  assert.ok(Math.abs(Math.abs(read.recent_window_return_pct!) - Math.abs(read.prior_window_return_pct!)) >= 1.0);
  assert.equal(read.momentum_pattern, "steady");
});

test("computeMomentumQuality: sustained volume — today AND 2+ of the prior 3 sessions elevated", () => {
  // Last 4 volumes (3 prior + today), all >= 1.5x the 1,000,000 trailing average.
  const b = bars({ vols: [1_800_000, 2_000_000, 1_900_000, 2_200_000] });
  const read = computeMomentumQuality(b);
  assert.equal(read.volume_pattern, "sustained");
  assert.equal(read.elevated_volume_sessions, 3);
});

test("computeMomentumQuality: single-day spike — only today elevated, prior 3 sessions normal", () => {
  const b = bars({ vols: [1_000_000, 1_050_000, 950_000, 3_000_000] });
  const read = computeMomentumQuality(b);
  assert.equal(read.volume_pattern, "single_day_spike");
  assert.equal(read.elevated_volume_sessions, 0);
});

test("computeMomentumQuality: normal — nothing elevated at all", () => {
  const b = bars({ vols: [1_000_000, 1_050_000, 950_000, 1_100_000] });
  const read = computeMomentumQuality(b);
  assert.equal(read.volume_pattern, "normal");
});

test("computeMomentumQuality: one elevated prior session (not 2+) with today elevated is 'normal', not sustained or spike", () => {
  // today elevated + exactly 1 prior elevated session: fails BOTH the sustained bar (needs >=2)
  // and the single-day-spike bar (needs 0) — correctly falls through to "normal" rather than
  // being forced into either extreme.
  const b = bars({ vols: [1_000_000, 1_800_000, 950_000, 2_000_000] });
  const read = computeMomentumQuality(b);
  assert.equal(read.volume_pattern, "normal");
  assert.equal(read.elevated_volume_sessions, 1);
});

test("scoreMomentumQuality: rewards acceleration + sustained volume ALIGNED with direction", () => {
  const read = {
    recent_window_return_pct: 7.8,
    prior_window_return_pct: 2.0,
    momentum_pattern: "accelerating" as const,
    volume_pattern: "sustained" as const,
    elevated_volume_sessions: 3,
  };
  assert.equal(scoreMomentumQuality(read, "long"), 8); // +5 accel, +3 sustained, clamped to [-5,8]
});

test("scoreMomentumQuality: a LONG candidate moving DOWN gets zero credit, even if the down-move itself is 'accelerating'", () => {
  const read = {
    recent_window_return_pct: -7.8,
    prior_window_return_pct: -2.0,
    momentum_pattern: "accelerating" as const,
    volume_pattern: "sustained" as const,
    elevated_volume_sessions: 3,
  };
  assert.equal(scoreMomentumQuality(read, "long"), 0);
  // The SHORT read of the exact same tape gets full credit — it's accelerating down, which is
  // exactly what a short thesis wants.
  assert.equal(scoreMomentumQuality(read, "short"), 8);
});

test("scoreMomentumQuality: penalizes deceleration and single-day-spike volume on an aligned move", () => {
  const read = {
    recent_window_return_pct: 0.9,
    prior_window_return_pct: 10,
    momentum_pattern: "decelerating" as const,
    volume_pattern: "single_day_spike" as const,
    elevated_volume_sessions: 0,
  };
  assert.equal(scoreMomentumQuality(read, "long"), -5); // -3 decel, -2 spike, clamped to [-5,8]
});

test("scoreMomentumQuality: no read (insufficient data) scores exactly 0 — never a guessed penalty or bonus", () => {
  const read = {
    recent_window_return_pct: null,
    prior_window_return_pct: null,
    momentum_pattern: null,
    volume_pattern: null,
    elevated_volume_sessions: null,
  };
  assert.equal(scoreMomentumQuality(read, "long"), 0);
  assert.equal(scoreMomentumQuality(read, "short"), 0);
});

test("scoreMomentumQuality: steady pattern + normal volume, aligned direction, scores 0 (no bonus, no penalty)", () => {
  const read = {
    recent_window_return_pct: 1.2,
    prior_window_return_pct: 1.0,
    momentum_pattern: "steady" as const,
    volume_pattern: "normal" as const,
    elevated_volume_sessions: 0,
  };
  assert.equal(scoreMomentumQuality(read, "long"), 0);
});
