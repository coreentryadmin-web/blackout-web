import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionWallSample,
  loadSessionWallHistory,
  railMemoNeedsResync,
  nextRailMemoAt,
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

// ── loadSessionWallTail ──────────────────────────────────────────────────────
// The DB is not configured in this environment, so every case here exercises the Redis/memory
// fallback path. That is deliberate and is the path that must stay correct: the DB tail is an
// OPTIMISATION, and a caller must get the same answer whether or not Postgres is reachable.

test("loadSessionWallTail: returns only the newest sample, and it is the newest one", async () => {
  const session = "2099-03-01";
  await appendSessionWallSample(session, { time: 100, walls: walls(500, 400) }, "TAIL", "all");
  await appendSessionWallSample(session, { time: 200, walls: walls(510, 400) }, "TAIL", "all");
  await appendSessionWallSample(session, { time: 300, walls: walls(520, 400) }, "TAIL", "all");

  const { loadSessionWallTail } = await import("./vector-wall-persist");
  const tail = await loadSessionWallTail(session, "TAIL", "all", 1);
  assert.equal(tail.length, 1);
  assert.equal(tail[0].time, 300, "must be the LAST reading — that is the whole contract");
  assert.equal(tail[0].walls.callWalls[0].strike, 520);
});

test("loadSessionWallTail: a limit at or above the rail length returns the whole rail", async () => {
  const session = "2099-03-02";
  await appendSessionWallSample(session, { time: 10, walls: walls(1, 1) }, "TAIL2", "all");
  await appendSessionWallSample(session, { time: 20, walls: walls(2, 2) }, "TAIL2", "all");

  const { loadSessionWallTail } = await import("./vector-wall-persist");
  assert.equal((await loadSessionWallTail(session, "TAIL2", "all", 2)).length, 2);
  assert.equal((await loadSessionWallTail(session, "TAIL2", "all", 99)).length, 2, "never over-slices");
});

test("loadSessionWallTail: TODAY's session is never served from the lagging mirror", async () => {
  // The mirror is written through non-blocking, so for a session still being recorded it can be
  // behind — and "the last reading" is exactly the value that lag would corrupt. Sessions strictly
  // BEFORE todayYmd may take the DB shortcut; today and anything later must not.
  const session = "2099-03-03";
  await appendSessionWallSample(session, { time: 1, walls: walls(7, 7) }, "TAIL3", "all");

  const { loadSessionWallTail } = await import("./vector-wall-persist");
  // Same answer either way here (no DB in this env); the point is that both paths are exercised
  // and neither throws or returns a different shape.
  const asToday = await loadSessionWallTail(session, "TAIL3", "all", 1, session);
  const asPast = await loadSessionWallTail(session, "TAIL3", "all", 1, "2099-03-04");
  const noClock = await loadSessionWallTail(session, "TAIL3", "all", 1);
  assert.deepEqual(asToday, asPast);
  assert.deepEqual(asToday, noClock, "omitting todayYmd must behave as 'not settled', never as settled");
  assert.equal(asToday.length, 1);
});

test("loadSessionWallTail: empty session id and unrecorded rails return [] rather than throwing", async () => {
  const { loadSessionWallTail } = await import("./vector-wall-persist");
  assert.deepEqual(await loadSessionWallTail("", "TAIL4"), []);
  assert.deepEqual(await loadSessionWallTail("2099-03-09", "NEVER-RECORDED"), []);
});

// ── RAIL MEMO RESYNC CLOCK (2026-08-18) ──────────────────────────────────────────────────────
// The memo exists to remove ~488 whole-rail Redis GET + JSON.parse round trips per 5s sweep — the
// measured compute bottleneck behind the sweep degrading from 5s near the open to ~30s by midday.
// Its clock was `at: memo?.at ?? Date.now()`, which refreshes only when there is NO memo, i.e.
// exactly once per rail. Every later resync re-read Redis and wrote the ORIGINAL timestamp back,
// so from ~60s into a rail's life the memo was permanently expired and every append paid the full
// O(rail length) cost again. These pin the clock so that cannot silently return.

test("a fresh memo is trusted; an expired one resyncs", () => {
  const t0 = 1_000_000;
  assert.equal(railMemoNeedsResync(t0, t0 + 59_000, 60_000), false);
  assert.equal(railMemoNeedsResync(t0, t0 + 60_000, 60_000), true, "at the window = expired");
  assert.equal(railMemoNeedsResync(undefined, t0, 60_000), true, "no memo must read Redis");
  assert.equal(railMemoNeedsResync(Number.NaN, t0, 60_000), true, "an unusable stamp must resync");
});

test("THE BUG: the clock advances on every resync, not just the first", () => {
  const t0 = 1_000_000;
  // Resync at t0+60s → the stored stamp must become t0+60s, not stay at t0.
  assert.equal(nextRailMemoAt(t0, true, t0 + 60_000), t0 + 60_000);
  // Within the window nothing changed, so the stamp must NOT move — the window is measured from
  // the last authoritative read, not the last write.
  assert.equal(nextRailMemoAt(t0, false, t0 + 5_000), t0);
  // First-ever append (no prior stamp) starts the clock.
  assert.equal(nextRailMemoAt(undefined, false, t0), t0);
});

test("over a session the memo resyncs ONCE per window, not on every append", () => {
  // The regression, made countable: 5s appends across 30 minutes with a 60s window is 360 appends
  // and should be ~30 Redis reads. The old formula produced one per append after the first minute.
  const WINDOW = 60_000;
  const TICK = 5_000;
  const APPENDS = 360;
  const t0 = 1_000_000;

  let at: number | undefined;
  let fixedReads = 0;
  let oldReads = 0;
  let oldAt: number | undefined;

  for (let i = 0; i < APPENDS; i++) {
    const now = t0 + i * TICK;

    const resync = railMemoNeedsResync(at, now, WINDOW);
    if (resync) fixedReads += 1;
    at = nextRailMemoAt(at, resync, now);

    // The shipped-before behaviour, reproduced exactly: `at: memo?.at ?? Date.now()`.
    const oldResync = oldAt == null || now - oldAt >= WINDOW;
    if (oldResync) oldReads += 1;
    oldAt = oldAt ?? now;
  }

  const expected = Math.ceil((APPENDS * TICK) / WINDOW);
  assert.equal(fixedReads, expected, `expected ~${expected} resyncs, got ${fixedReads}`);
  assert.ok(
    oldReads > fixedReads * 10,
    `the old clock should read far more often (old ${oldReads} vs fixed ${fixedReads})`
  );
  // The old clock read once on the very first append (no memo yet), then on EVERY append from the
  // moment the window first elapsed — the memo bought exactly one window of benefit per rail.
  const appendsInsideFirstWindow = WINDOW / TICK;
  assert.equal(
    oldReads,
    1 + (APPENDS - appendsInsideFirstWindow),
    "old clock: every append past the first window re-read"
  );
});

test("the resync window is never skipped entirely — staleness stays bounded", () => {
  // The opposite failure would be worse than the one being fixed: a memo that never resyncs can
  // hold a divergent rail for the whole session, and this process would keep writing from it.
  const WINDOW = 60_000;
  const t0 = 1_000_000;
  let at: number | undefined = t0;
  for (let elapsed = 0; elapsed <= 10 * 60_000; elapsed += 5_000) {
    const now = t0 + elapsed;
    const resync = railMemoNeedsResync(at, now, WINDOW);
    at = nextRailMemoAt(at, resync, now);
    assert.ok(now - (at ?? now) < WINDOW, `stamp went stale at ${elapsed}ms`);
  }
});

// ── APPEND-ONLY RAIL (2026-08-19) ────────────────────────────────────────────────────
//
// The rail is written as a Redis list now: one RPUSH per sample, O(1), payload independent of how
// long the session already is. The blob form made every append a whole-rail rewrite, which is what
// capped the recorder — #2273 put four rails per ticker on the 5s sweep, the sweep blew its budget,
// and #2274 reverted it the same day.

test("a long rail costs a constant-size append, not a whole-rail rewrite", async () => {
  const session = "2099-03-01";
  for (let i = 0; i < 400; i++) {
    await appendSessionWallSample(session, { time: 1000 + i * 5, walls: walls(100 + i, 90) }, "AMD");
  }
  const loaded = await loadSessionWallHistory(session, "AMD");
  assert.equal(loaded.length, 400, "every appended bucket must be readable");
  assert.equal(loaded[0]!.time, 1000, "oldest bucket kept");
  assert.equal(loaded[loaded.length - 1]!.time, 1000 + 399 * 5, "newest bucket kept");
  // Order is the property the chart depends on — beads are drawn along this axis.
  for (let i = 1; i < loaded.length; i++) {
    assert.ok(loaded[i]!.time > loaded[i - 1]!.time, `rail out of order at ${i}`);
  }
});

test("a refreshed bucket collapses last-wins instead of rendering twice", async () => {
  const session = "2099-03-02";
  await appendSessionWallSample(session, { time: 300, walls: walls(10, 5) }, "TSLA");
  await appendSessionWallSample(session, { time: 300, walls: walls(11, 5) }, "TSLA");
  await appendSessionWallSample(session, { time: 300, walls: walls(12, 5) }, "TSLA");
  const loaded = await loadSessionWallHistory(session, "TSLA");
  assert.equal(loaded.length, 1, "one bucket, however many times it was refreshed");
  assert.equal(loaded[0]!.walls.callWalls[0]!.strike, 12, "newest reading wins");
});

test("every horizon records independently at full cadence", async () => {
  // The point of the whole change: weekly/monthly are no longer rationed against a write budget.
  const session = "2099-03-03";
  for (const horizon of ["all", "0dte", "weekly", "monthly"] as const) {
    for (let i = 0; i < 5; i++) {
      await appendSessionWallSample(session, { time: 700 + i * 5, walls: walls(50 + i, 40) }, "NVDA", horizon);
    }
  }
  for (const horizon of ["all", "0dte", "weekly", "monthly"] as const) {
    const rail = await loadSessionWallHistory(session, "NVDA", horizon);
    assert.equal(rail.length, 5, `${horizon} rail should hold every sample`);
  }
});
