import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUTURE_PRINT_TOLERANCE_MS,
  detectSplitFlow,
  detectVelocitySpikes,
  signalWindowAgeMs,
} from "./helix-signal-detection";

/**
 * Both detectors compared a raw `nowMs - eventMs` against their window. A future-dated print gives
 * a NEGATIVE age, and a negative number is `<=` every window and `>` none — so it counted as
 * maximally recent in both. Reproduced against the real detectors before the fix: six prints
 * stamped one year ahead produced a velocity spike (recent=6, ratio=6) and a split-flow firing.
 */

const NOW = Date.parse("2026-08-21T15:00:00.000Z");
const YEAR_MS = 365 * 24 * 3600 * 1000;

const print = (ticker: string, option_type: "CALL" | "PUT", premium: number, offsetMs: number) =>
  ({
    ticker,
    option_type,
    premium,
    ask_pct: 85,
    event_at: new Date(NOW + offsetMs).toISOString(),
  }) as never;

test("prints from a year in the future fire NEITHER detector", () => {
  const future = [
    ...Array.from({ length: 5 }, (_, i) => print("FUT", "CALL", 600_000, YEAR_MS + i * 1000)),
    print("FUT", "PUT", 600_000, YEAR_MS),
  ];
  assert.deepEqual(detectVelocitySpikes(future, NOW), []);
  assert.deepEqual(detectSplitFlow(future, NOW), []);
});

test("real recent prints still fire — the guard did not break detection", () => {
  const recent = [
    ...Array.from({ length: 5 }, (_, i) => print("REAL", "CALL", 600_000, -60_000 * (i + 1))),
    print("REAL", "PUT", 600_000, -60_000),
  ];
  assert.equal(detectVelocitySpikes(recent, NOW).length, 1);
  assert.equal(detectSplitFlow(recent, NOW).length, 1);
});

test("ordinary clock skew is tolerated — a slightly-ahead print is not dropped", () => {
  // UW's stamp and our clock will not agree to the millisecond. Rejecting anything ahead at all
  // would discard real prints, so the tolerance is deliberately non-zero.
  const skewed = [
    ...Array.from({ length: 5 }, () => print("SKEW", "CALL", 600_000, 5_000)),
    print("SKEW", "PUT", 600_000, 5_000),
  ];
  assert.equal(detectVelocitySpikes(skewed, NOW).length, 1);
  assert.equal(detectSplitFlow(skewed, NOW).length, 1);
});

test("the tolerance boundary is exact and does not silently widen", () => {
  assert.equal(signalWindowAgeMs(NOW, NOW), 0);
  // Exactly at the tolerance: still accepted (age is negative but within it).
  assert.equal(signalWindowAgeMs(NOW + FUTURE_PRINT_TOLERANCE_MS, NOW), -FUTURE_PRINT_TOLERANCE_MS);
  // One millisecond beyond: refused.
  assert.equal(signalWindowAgeMs(NOW + FUTURE_PRINT_TOLERANCE_MS + 1, NOW), null);
});

test("an undatable print is still refused, as before", () => {
  assert.equal(signalWindowAgeMs(null, NOW), null);
  assert.equal(signalWindowAgeMs(Number.NaN, NOW), null);
});

test("a past print returns a POSITIVE age, so window comparisons keep their meaning", () => {
  assert.equal(signalWindowAgeMs(NOW - 5 * 60_000, NOW), 5 * 60_000);
});

test("a future print is refused, NOT clamped to zero", () => {
  // Clamping would make it the newest print on the tape — the same defect wearing a fix's clothes.
  assert.equal(signalWindowAgeMs(NOW + YEAR_MS, NOW), null);
});

test("a mix of real and future prints keeps only the real ones", () => {
  // The realistic shape: one corrupt timestamp among good rows must not inflate the count.
  const mixed = [
    ...Array.from({ length: 3 }, (_, i) => print("MIX", "CALL", 600_000, -60_000 * (i + 1))),
    ...Array.from({ length: 20 }, () => print("MIX", "CALL", 600_000, YEAR_MS)),
  ];
  const spikes = detectVelocitySpikes(mixed, NOW);
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0]!.recent, 3, "only the three real prints may be counted");
});
