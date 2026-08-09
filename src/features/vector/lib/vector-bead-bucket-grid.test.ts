import test from "node:test";
import assert from "node:assert/strict";
import {
  compactHistoryToCap,
  decimateSeedHistory,
  SEED_TAIL_BUCKET_SEC,
  type WallHistorySample,
} from "./vector-wall-history.ts";

/**
 * A thinned bead tail must land on timestamps the chart's time scale can resolve to a bar.
 *
 * lightweight-charts implements `timeToCoordinate(t)` as `timeToIndex(t, findNearest = false)` and
 * returns null for anything that is not exactly a bar time; WallRailPrimitive then does
 * `if (x == null) continue`. Bar times are multiples of the candle interval, so on every supported
 * timeframe (60/180/300/900s) they are ≡ 0 (mod 15). A sample at `t % 15 === 10` can therefore
 * never draw, on any timeframe — it is dropped silently, which is what made SPX's session look
 * empty outside the untouched newest-30-minutes window.
 */

const SESSION_OPEN = 1786109400; // 2026-08-07 09:30:00 ET, a multiple of 60
const CANDLE_SECS = [60, 180, 300, 900];

function rail(cadenceSec: number, count: number, start = SESSION_OPEN): WallHistorySample[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * cadenceSec,
    walls: { callWalls: [{ strike: 7760, pct: 1 }], putWalls: [{ strike: 7700, pct: 1 }] },
  })) as unknown as WallHistorySample[];
}

const renderable = (h: WallHistorySample[], candleSec: number) =>
  h.filter((s) => s.time % candleSec === 0).length;

test("5s oracle tail no longer lands on the unrenderable t%15===10 phase", () => {
  // The exact defect: 15s bucketing over a 5s cadence keeps the sample at bucketStart+10.
  const out = decimateSeedHistory(rail(5, 4000));
  const newest = out[out.length - 1]!.time;
  // index 0 is the session anchor — deliberately exempt from thinning, so exempt from the grid too.
  const tail = out.slice(1).filter((s) => s.time < newest - 30 * 60);
  assert.ok(tail.length > 100, `expected a substantial decimated tail, got ${tail.length}`);
  // Exactly one exception is expected and correct: the first tail sample falls in the SAME bucket
  // as the retained session anchor, so snapping it would move it backwards past the anchor and the
  // ordering guard declines. One sample at the very start of the session is immaterial.
  const offGrid = tail.filter((s) => s.time % SEED_TAIL_BUCKET_SEC !== 0);
  assert.ok(offGrid.length <= 1, `at most the anchor-bucket sample may be off-grid, got ${offGrid.length}`);
  if (offGrid.length) {
    const anchorBucket = Math.floor(out[0]!.time / SEED_TAIL_BUCKET_SEC) * SEED_TAIL_BUCKET_SEC;
    assert.equal(
      Math.floor(offGrid[0]!.time / SEED_TAIL_BUCKET_SEC) * SEED_TAIL_BUCKET_SEC,
      anchorBucket,
      "the only off-grid sample must be the one colliding with the anchor's bucket"
    );
  }
});

test("the 5s tail becomes renderable on every supported timeframe", () => {
  const raw = rail(5, 4000);
  const out = decimateSeedHistory(raw);
  const newest = out[out.length - 1]!.time;
  const tailOf = (h: WallHistorySample[]) => h.slice(1).filter((s) => s.time < newest - 30 * 60);
  for (const candle of CANDLE_SECS) {
    const before = renderable(tailOf(raw).map((s) => ({ ...s, time: Math.floor(s.time / 15) * 15 + 10 })), candle);
    const after = renderable(tailOf(out), candle);
    assert.equal(before, 0, `${candle}s: the old phase drew nothing (that is the bug)`);
    assert.ok(after > 0, `${candle}s: the snapped tail must draw something (got ${after})`);
  }
});

test("compactHistoryToCap gets the same treatment — it is the live-desk entry point", () => {
  // /dashboard reaches the phase shift through the cap path, not the seed path.
  const out = compactHistoryToCap(rail(5, 8000), 5760);
  const newest = out[out.length - 1]!.time;
  const tail = out.slice(1).filter((s) => s.time < newest - 30 * 60);
  assert.ok(tail.length > 50, `expected a compacted tail, got ${tail.length}`);
  // Same single anchor-bucket exception as the seed path — see the decimate test above.
  assert.ok(
    tail.filter((s) => s.time % 15 !== 0).length <= 1,
    "compacted tail must be on-grid apart from the anchor-bucket collision"
  );
});

test("a rail recorded at exactly the bucket width passes through untouched", () => {
  // bucket width == cadence, so the thinner is already an identity op on times. Written against
  // the CONSTANT, not a literal: this invariant is about the relationship, and hardcoding 15 here
  // is what made the test fail when SEED_TAIL_BUCKET_SEC moved to 60 for payload reasons.
  const raw = rail(SEED_TAIL_BUCKET_SEC, 1500);
  assert.deepEqual(
    decimateSeedHistory(raw).map((s) => s.time),
    raw.map((s) => s.time),
    "a rail at the bucket cadence must pass through with identical timestamps"
  );
});

test("a 15s (non-oracle) rail IS now thinned — intended, not a regression", () => {
  // This used to be the pass-through case, and its old title ("this is why single stocks never
  // showed the bug") recorded a real insight: at a 15s bucket, non-oracle tickers were exempt.
  // At 60s they are not, which is deliberate — the same over-resolution argument applies to a
  // 2.9MB NVDA seed as to a 10.4MB SPX one. Pinned so the change stays a decision, not a surprise.
  const raw = rail(15, 1500);
  const out = decimateSeedHistory(raw);
  assert.ok(out.length < raw.length, "a 15s rail must now shrink");
  const newest = out[out.length - 1]!.time;
  // Same single allowed exception the 5s test above documents: the first tail sample shares the
  // retained session anchor's bucket, and the ordering guard declines to snap it backwards.
  const offGrid = out
    .slice(1)
    .filter((x) => x.time < newest - 30 * 60)
    .filter((x) => x.time % SEED_TAIL_BUCKET_SEC !== 0);
  assert.ok(offGrid.length <= 1, `at most the anchor-bucket sample may be off-grid, got ${offGrid.length}`);
});

test("timestamps stay strictly ascending — snapping never moves a sample backwards", () => {
  // Math.floor can round below the retained anchor when both fall in the first bucket; wall
  // history must stay ordered for trailsByStrike's coalescing and every downstream slice.
  for (const start of [SESSION_OPEN + 1, SESSION_OPEN + 7, SESSION_OPEN + 14]) {
    for (const fn of [
      (h: WallHistorySample[]) => decimateSeedHistory(h),
      (h: WallHistorySample[]) => compactHistoryToCap(h, 100),
    ]) {
      const out = fn(rail(5, 3000, start));
      for (let i = 1; i < out.length; i++) {
        assert.ok(
          out[i]!.time >= out[i - 1]!.time,
          `start=${start}: time went backwards at ${i} (${out[i - 1]!.time} -> ${out[i]!.time})`
        );
      }
    }
  }
});

test("the newest window and the session anchor keep their original timestamps", () => {
  const raw = rail(5, 4000);
  const out = decimateSeedHistory(raw);
  assert.equal(out[0]!.time, raw[0]!.time, "the session-open anchor is never re-keyed");
  const newest = out[out.length - 1]!.time;
  const live = out.filter((s) => s.time >= newest - 30 * 60);
  const rawLive = raw.filter((s) => s.time >= newest - 30 * 60);
  assert.deepEqual(
    live.map((s) => s.time),
    rawLive.map((s) => s.time),
    "full-resolution window is returned sample-for-sample, unmodified"
  );
});

test("snapping copies rather than mutating the input samples", () => {
  // The same sample objects are shared with the live in-memory rail; mutating them in place would
  // corrupt state the caller still holds.
  const raw = rail(5, 4000);
  const times = raw.map((s) => s.time);
  decimateSeedHistory(raw);
  compactHistoryToCap(raw, 100);
  assert.deepEqual(raw.map((s) => s.time), times, "input rail must be untouched");
});

test("wall payloads survive the snap unchanged", () => {
  const out = decimateSeedHistory(rail(5, 4000));
  for (const s of out) {
    assert.ok(s.walls?.callWalls?.length, "call walls preserved through the copy");
    assert.ok(s.walls?.putWalls?.length, "put walls preserved through the copy");
  }
});
