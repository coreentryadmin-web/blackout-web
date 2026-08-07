import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionWallSample,
  loadSessionWallHistory,
  persistWallSampleDebounced,
  _resetWallPersistDebounceForTest,
} from "./vector-wall-persist";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";

const SESSION = "2099-01-02";

function walls(call: number, put: number): GexWalls {
  return {
    callWalls: [{ strike: call, pct: 10 }],
    putWalls: [{ strike: put, pct: 8 }],
  };
}

test("appendSessionWallSample + loadSessionWallHistory round-trip via shared-cache memory", async () => {
  await appendSessionWallSample(SESSION, { time: 100, walls: walls(6800, 6700) });
  await appendSessionWallSample(SESSION, { time: 160, walls: walls(6810, 6700) });
  const loaded = await loadSessionWallHistory(SESSION);
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map((s) => s.time), [100, 160]);
  assert.equal(loaded[1].walls.callWalls[0].strike, 6810);
});

test("appendSessionWallSample replaces in-place for the same bar time", async () => {
  const session = "2099-01-03";
  await appendSessionWallSample(session, { time: 200, walls: walls(6800, 6700) });
  await appendSessionWallSample(session, { time: 200, walls: walls(6825, 6700) });
  const loaded = await loadSessionWallHistory(session);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].walls.callWalls[0].strike, 6825);
});

test("appendSessionWallSample returns true when a sample lands, false when sessionYmd is empty", async () => {
  // The boolean return is what lets the cron tally how many samples actually landed —
  // the signal that was missing when a silent persistence gap emptied the off-hours rail.
  const session = "2099-01-05";
  assert.equal(await appendSessionWallSample(session, { time: 500, walls: walls(6800, 6700) }), true);
  // A missing session id is never persisted — guarded before any cache touch.
  assert.equal(await appendSessionWallSample("", { time: 1, walls: walls(1, 1) }), false);
});

test("persistWallSampleDebounced: coalesces rapid writes in the same bucket", async () => {
  _resetWallPersistDebounceForTest();
  const session = "2099-01-04";
  const sample = { time: 300, walls: walls(6800, 6700) };
  persistWallSampleDebounced(session, sample);
  persistWallSampleDebounced(session, sample);
  await new Promise((r) => setTimeout(r, 50));
  const loaded = await loadSessionWallHistory(session);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].time, 300);
});

test("per-horizon rails are stored + read independently; 'all' stays on the legacy key", async () => {
  const session = "2099-02-01";
  // Same ticker, three horizons — each records its OWN trail.
  await appendSessionWallSample(session, { time: 100, walls: walls(220, 190) }, "NVDA", "all");
  await appendSessionWallSample(session, { time: 100, walls: walls(210, 195) }, "NVDA", "weekly");
  await appendSessionWallSample(session, { time: 160, walls: walls(208, 196) }, "NVDA", "weekly");

  const all = await loadSessionWallHistory(session, "NVDA", "all");
  const weekly = await loadSessionWallHistory(session, "NVDA", "weekly");
  const monthly = await loadSessionWallHistory(session, "NVDA", "monthly");

  assert.equal(all.length, 1, "all rail has its own single sample");
  assert.equal(all[0].walls.callWalls[0].strike, 220);
  assert.equal(weekly.length, 2, "weekly rail accumulated independently");
  assert.deepEqual(weekly.map((s) => s.walls.callWalls[0].strike), [210, 208]);
  assert.equal(monthly.length, 0, "an unrecorded horizon is empty, not cross-contaminated");

  // Backward-compat: default horizon ('all') reads the SAME data as the legacy 2-arg call.
  const legacy = await loadSessionWallHistory(session, "NVDA");
  assert.deepEqual(legacy, all, "2-arg load == horizon:'all' load (legacy key unchanged)");
});

test("wallRailStorageId: 'all' is the bare ticker; narrowed horizons get a composite key", async () => {
  const { wallRailStorageId } = await import("./vector-wall-persist");
  assert.equal(wallRailStorageId("NVDA", "all"), "NVDA");
  assert.equal(wallRailStorageId("NVDA"), "NVDA");
  assert.equal(wallRailStorageId("NVDA", "weekly"), "NVDA::weekly");
  assert.equal(wallRailStorageId("SPX", "0dte"), "SPX::0dte");
});

// ─────────────────────────────────────────────────────────────────────────────
// P1 2026-08-07: META's rail ran BACKWARDS — 127 samples → 92, leading edge
// regressed 09:46:05 → 09:40:05. Root cause traced to the DB-fallback re-warm
// blind-overwriting Redis with the deliberately-lagging Postgres mirror.
// ─────────────────────────────────────────────────────────────────────────────

/** A rail of `n` samples on the live 5s bucket cadence, starting at META's real session start. */
function rail(n: number, startSec = 1786109400 /* 09:30:00 ET 2026-08-07 */) {
  return Array.from({ length: n }, (_, i) => ({
    time: startSec + i * 5,
    walls: walls(600 + i, 585 - i),
  }));
}

test("REGRESSION: a union re-warm can never SHORTEN a rail — the META rollback shape", async () => {
  const { mergeWallHistory } = await import("./vector-wall-history");
  // Exactly the live numbers: Redis holds the good 127-sample rail, the Postgres mirror is behind
  // at 92 (its write-through is non-blocking, so it lags by design).
  const hot = rail(127);
  const laggingMirror = rail(92);

  // What the OLD code did — take the mirror verbatim. This is the bug, pinned.
  assert.equal(laggingMirror.length, 92);
  assert.equal(laggingMirror[laggingMirror.length - 1]!.time, 1786109400 + 91 * 5);

  // What the fix does.
  const warmed = mergeWallHistory(hot, laggingMirror);
  assert.equal(warmed.length, 127, "union must keep every sample Redis already had");
  assert.equal(warmed[0]!.time, hot[0]!.time, "session start is unmoved");
  assert.ok(
    warmed[warmed.length - 1]!.time >= hot[hot.length - 1]!.time,
    "the LEADING EDGE must never move into the past — that is the member-visible symptom"
  );
});

test("a genuinely cold Redis still gets the durable rail — the fix is not a no-op", async () => {
  const { mergeWallHistory } = await import("./vector-wall-history");
  const durable = rail(92);
  // Redis truly empty (cold replica / restart): the union degenerates to the mirror, i.e. exactly
  // the pre-fix behaviour for the case the fallback actually exists to serve.
  const warmed = mergeWallHistory([], durable);
  assert.deepEqual(warmed, durable);
});

test("the mirror can still ADD buckets Redis is missing — union, not 'Redis always wins'", async () => {
  const { mergeWallHistory } = await import("./vector-wall-history");
  // Redis missing a mid-session stretch; the durable mirror has it. Union must fill the hole.
  const hot = [...rail(10), ...rail(10, 1786109400 + 200 * 5)];
  const durable = rail(300);
  const warmed = mergeWallHistory(hot, durable);
  assert.ok(warmed.length >= 300, `expected the union to fill the gap, got ${warmed.length}`);
  const times = warmed.map((s) => s.time);
  assert.deepEqual([...times].sort((a, b) => a - b), times, "output stays time-ordered");
});

test("the re-warm re-reads and unions instead of blind-writing the mirror", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("src/features/vector/lib/vector-wall-persist.ts", "utf8");
  assert.match(src, /const warmed = mergeWallHistory\(fresh \?\? \[\], durable\)/);
  assert.match(src, /sharedCacheSet\(redisKey\(st, sessionYmd\), warmed, TTL_SEC\)/);
  // The overwrite form must be gone — it is the defect.
  assert.doesNotMatch(src, /sharedCacheSet\(redisKey\(st, sessionYmd\), durable, TTL_SEC\)/);
});
