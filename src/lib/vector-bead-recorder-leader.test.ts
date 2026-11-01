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

// Regression for the 2026-10-15 live incident (FINDINGS.md "Live ALB tail-latency incident" /
// #4076 comments 6197984130, 6199692739): both lanes here fan out across the shared ~100-122-
// ticker Vector universe into fetchGexHeatmap() every 5s/15s, continuously, all RTH — structurally
// saturating the shared Polygon rate limiter and starving other desks' (0DTE/SPX/Thermal) chain
// fetches of the same budget. The fix (polygon-rate-limiter.ts's runWithBackgroundPolygonSweep +
// reserveForLiveTraffic) is useless unless BOTH call sites that actually trigger this churn are
// tagged — source-scanned here (not module-imported) because this file boots real setInterval
// timers and a live Redis leader-lock connection on import, matching this test file's own existing
// read-the-source convention above rather than introducing a new import-time side-effect risk.
test("the universe-lane sweep (tick()) is tagged as a background Polygon sweep", () => {
  const idx = src.indexOf("recordSharedUniverseWallSamples({ shards })");
  assert.ok(idx > 0, "the universe-lane call site must still exist");
  const before = src.slice(Math.max(0, idx - 200), idx);
  assert.match(
    before,
    /const result = await runWithBackgroundPolygonSweep\(\(\) =>/,
    "recordSharedUniverseWallSamples must be invoked inside runWithBackgroundPolygonSweep, not called directly"
  );
});

test("the active-lane sweep (activeTick()) is tagged as a background Polygon sweep", () => {
  const idx = src.indexOf("recordActiveNonUniverseWallSamples()");
  assert.ok(idx > 0, "the active-lane call site must still exist");
  const before = src.slice(Math.max(0, idx - 200), idx);
  assert.match(
    before,
    /const result = await runWithBackgroundPolygonSweep\(\(\) =>/,
    "recordActiveNonUniverseWallSamples must be invoked inside runWithBackgroundPolygonSweep, not called directly"
  );
});

test("runWithBackgroundPolygonSweep is imported from the shared Polygon rate limiter, not reimplemented locally", () => {
  assert.match(src, /import \{ runWithBackgroundPolygonSweep \} from "@\/lib\/providers\/polygon-rate-limiter";/);
});
