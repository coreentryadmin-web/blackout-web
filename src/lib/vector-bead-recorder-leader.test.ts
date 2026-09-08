// Regression: both zero-samples warn call sites (universe lane + active lane) must route through
// the rate-limited shouldLogZeroSamples gate, not fire unconditionally.
//
// Measured live 2026-09-03: the universe lane's warn fired 100+ times in 30 minutes during RTH,
// always `0/N failed` (a busy-skip self-throttle echo, not a real failure) — see
// vector-bead-recorder-logic.ts's shouldLogZeroSamples doc comment for the full root cause.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "vector-bead-recorder-leader.ts"), "utf8");

test("the universe-lane zero-samples warn is gated by shouldLogZeroSamples", () => {
  const idx = src.indexOf("zero samples recorded (");
  assert.ok(idx > 0, "the warn line must still exist");
  const before = src.slice(Math.max(0, idx - 400), idx);
  assert.match(before, /shouldLogZeroSamples\(result\.failed, Date\.now\(\), zeroSamplesLog\)/);
});

test("the active-lane zero-samples warn is gated by shouldLogZeroSamples, with its own rate-limit state", () => {
  const idx = src.indexOf("active non-universe: zero samples (");
  assert.ok(idx > 0, "the warn line must still exist");
  const before = src.slice(Math.max(0, idx - 400), idx);
  assert.match(before, /shouldLogZeroSamples\(result\.failed, Date\.now\(\), activeZeroSamplesLog\)/);
});

test("the two lanes use SEPARATE rate-limit state, matching every other per-lane state in this file", () => {
  assert.match(src, /const zeroSamplesLog: ZeroSamplesLogState = \{ lastLoggedAt: 0 \};/);
  assert.match(src, /const activeZeroSamplesLog: ZeroSamplesLogState = \{ lastLoggedAt: 0 \};/);
});
