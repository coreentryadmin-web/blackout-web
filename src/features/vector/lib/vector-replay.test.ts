import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplayTimeline,
  flipAtCrosshairTime,
  flipAtReplayTime,
  sliceBarsToTime,
  sliceHistoryToTime,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  wallsAtCrosshairTime,
  wallsAtReplayTime,
  type VectorReplayBar,
} from "@/features/vector/lib/vector-replay";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import type { WallHistorySample } from "@/features/vector/lib/vector-wall-history";

function walls(call: number, put: number): GexWalls {
  return {
    callWalls: [{ strike: call, pct: 12 }],
    putWalls: [{ strike: put, pct: 10 }],
  };
}

// 2026-07-07 EDT — 13:30 UTC = 9:30 ET, 20:00 UTC = 16:00 ET
const OPEN = 1_783_431_000;
const NOON = 1_783_434_600;
const CLOSE = 1_783_454_400;

test("timelineIndexAtOrAfterEtClock: finds 9:30 ET on session day", () => {
  const timeline = [OPEN - 60, OPEN, NOON, CLOSE];
  const idx = timelineIndexAtOrAfterEtClock(timeline, "2026-07-07", 9, 30);
  assert.equal(idx, 1);
});

test("timelineIndexAtOrBeforeEtClock: finds 4:00 PM ET on session day", () => {
  const timeline = [OPEN, NOON, CLOSE, CLOSE + 60];
  const idx = timelineIndexAtOrBeforeEtClock(timeline, "2026-07-07", 16, 0);
  assert.equal(idx, 2);
});

// Regression: hovering/scrubbing the Vector chart at a time BEFORE the earliest recorded
// wall sample used to silently fall back to today's LIVE wall/flip state, mislabeling it as
// the historical state at the hovered time — same bug shape as the 0DTE TRIM narrative fix
// (a stale/absent value masquerading as current). wallsAtReplayTime/flipAtReplayTime are
// honest (return null when the cursor predates all samples); the bug was in these callers'
// "?? live" fallback treating that null the same as "no history exists at all."
const LIVE = walls(7600, 7400);
const SAMPLE = walls(7550, 7450);
const HISTORY: WallHistorySample[] = [
  { time: 1000, walls: SAMPLE, gammaFlip: 7500 },
  { time: 2000, walls: SAMPLE, gammaFlip: 7505 },
];

test("wallsAtCrosshairTime: hovering before the earliest sample returns null, not today's live walls", () => {
  const result = wallsAtCrosshairTime(HISTORY, 500 /* before HISTORY[0].time */, "gex", LIVE, null);
  assert.equal(result, null);
});

test("wallsAtCrosshairTime: hovering at/after a recorded sample returns that historical sample, not live", () => {
  const result = wallsAtCrosshairTime(HISTORY, 1500, "gex", LIVE, null);
  assert.deepEqual(result, SAMPLE);
  assert.notDeepEqual(result, LIVE);
});

test("wallsAtCrosshairTime: crosshair off the chart (hoverEpochSec null) falls back to live", () => {
  const result = wallsAtCrosshairTime(HISTORY, null, "gex", LIVE, null);
  assert.deepEqual(result, LIVE);
});

test("wallsAtCrosshairTime: zero history ever recorded falls back to live — nothing else to show", () => {
  const result = wallsAtCrosshairTime([], 1500, "gex", LIVE, null);
  assert.deepEqual(result, LIVE);
});

test("flipAtCrosshairTime: hovering before the earliest sample returns null, not today's live flip", () => {
  const flip = flipAtCrosshairTime(HISTORY, 500, "gex", 7777, null);
  assert.equal(flip, null);
});

test("flipAtCrosshairTime: hovering at/after a recorded sample returns that historical flip, not live", () => {
  const flip = flipAtCrosshairTime(HISTORY, 1500, "gex", 7777, null);
  assert.equal(flip, 7500);
});

// Regression: VectorChart's timeframe-resync effect re-fires on every replayMode
// change (e.g. immediately after enterReplay()'s own cursor-sliced applyFrame call)
// and, before this fix, redrew the candle series from the FULL live minuteBars array
// with no cursorTime — leaking bars after the replay cursor onto a chart whose clock
// label still read the earlier cursor time. The fix routes that redraw through
// applyFrame (same as scrubTo/stepReplay/enterReplay), which slices via
// sliceBarsToTime — this pins the exact invariant that slice must uphold: no bar
// timestamped after the cursor may ever appear in a replay-mode display.
test("sliceBarsToTime: bars after the replay cursor (the 'leaked live data' bug) are excluded", () => {
  const cursorTime = OPEN + 300; // 5 minutes into the session
  const bars = [
    { time: OPEN, open: 1, high: 1, low: 1, close: 1 },
    { time: cursorTime, open: 2, high: 2, low: 2, close: 2 },
    { time: cursorTime + 60, open: 3, high: 3, low: 3, close: 3 }, // "live/future" bar
    { time: NOON, open: 4, high: 4, low: 4, close: 4 }, // "live/future" bar
  ];
  const sliced = sliceBarsToTime(bars, cursorTime);
  assert.deepEqual(
    sliced.map((b) => b.time),
    [OPEN, cursorTime],
    "no bar after the cursor may leak into a replay-mode display"
  );
});

// Regression for the SECOND occurrence of the replay leak (2026-07-11): the 60s
// SPY-volume backfill effect painted displayBarsFromMinute(fullLiveBars, timeframe)
// with NO cursorTime while replay was active — the lib-level slice was correct, the
// component call site simply bypassed it. Any paint that runs during replay must
// compose slice-then-aggregate; this pins that composition for a >1m timeframe:
// the aggregate of the cursor-sliced minutes must end at the cursor's bucket and
// carry no post-cursor minute's range, while the unsliced aggregate (what the buggy
// call site painted) visibly differs.
test("slice-then-aggregate: post-cursor minutes never reach a higher-timeframe replay paint", async () => {
  const { aggregateVectorBars } = await import("@/features/vector/lib/vector-bar-timeframes");
  const mk = (t: number, px: number) => ({ time: t, open: px, high: px, low: px, close: px });
  const bars = [
    mk(OPEN, 10),
    mk(OPEN + 60, 11),
    mk(OPEN + 120, 12), // cursor lands here, mid 5m bucket
    mk(OPEN + 180, 99), // post-cursor spike that must NOT appear
    mk(OPEN + 240, 100),
  ];
  const cursorTime = OPEN + 120;
  const honest = aggregateVectorBars(sliceBarsToTime(bars, cursorTime), 5);
  const leaked = aggregateVectorBars(bars, 5);
  assert.equal(honest.length, 1);
  assert.equal(honest[0]!.high, 12, "post-cursor spike leaked into the replay bucket");
  assert.notDeepEqual(honest, leaked, "unsliced aggregate must differ — else this test proves nothing");
});

/**
 * The replay scrubber must not span more sessions than the wall rail covers.
 *
 * `loadVectorSeedProps` seeds ~3 sessions of bars ("the seed carries ~3 sessions, so bars[0] is the
 * OLDEST session's open") while the rail beside it is single-session — `loadSessionWallHistory` and
 * `reconstructSessionRail` are both keyed on one `sessionYmd`. Unioning them raw put ~3 days of
 * candles on a timeline that only has 1 day of beads, so most of the scrubber sat on days with no
 * rail: `sliceHistoryToTime` returns [] there and the chart correctly draws candles and nothing
 * else. Reported live on SPX at step 75/1521 — 10:44 AM on the OLDEST seeded session.
 */
const DAY = 86_400;
/** 2026-08-19 13:30Z = 09:30 ET. */
const SESSION_OPEN_UTC = Date.parse("2026-08-19T13:30:00Z") / 1000;

function barsForDay(openSec: number, count: number): VectorReplayBar[] {
  return Array.from({ length: count }, (_, i) => ({
    time: openSec + i * 60,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
  }));
}

test("REGRESSION: the replay timeline covers only the session the wall rail describes", () => {
  // Three sessions of bars, rail on the newest only — the exact seed/rail asymmetry.
  const bars = [
    ...barsForDay(SESSION_OPEN_UTC - 2 * DAY, 390),
    ...barsForDay(SESSION_OPEN_UTC - 1 * DAY, 390),
    ...barsForDay(SESSION_OPEN_UTC, 390),
  ];
  const history: WallHistorySample[] = [
    { time: SESSION_OPEN_UTC + 60, walls: { callWalls: [{ strike: 7800, pct: 9 }], putWalls: [] }, gammaFlip: null },
    { time: SESSION_OPEN_UTC + 600, walls: { callWalls: [{ strike: 7800, pct: 9 }], putWalls: [] }, gammaFlip: null },
  ];

  const timeline = buildReplayTimeline(history, bars);

  const oldest = timeline[0]!;
  assert.ok(
    oldest >= SESSION_OPEN_UTC - 60,
    `timeline starts at ${oldest}, which is before the rail's session — the scrubber would open on ` +
      "a day that has candles but no beads"
  );

  // Every step must be a point where beads can exist: at/after the first rail sample, or inside
  // the session the rail covers.
  const beforeRail = timeline.filter((t) => t < history[0]!.time);
  assert.ok(
    beforeRail.length <= 390,
    `${beforeRail.length} steps precede the first wall sample — at most one session's worth of ` +
      "pre-rail bars is acceptable, three days' worth is the bug"
  );
  assert.ok(timeline.length <= 400, `timeline should be ~one session, got ${timeline.length}`);
});

test("a mid-session cursor still resolves beads after the scope fix", () => {
  const bars = [...barsForDay(SESSION_OPEN_UTC - DAY, 390), ...barsForDay(SESSION_OPEN_UTC, 390)];
  const history: WallHistorySample[] = [
    { time: SESSION_OPEN_UTC + 60, walls: { callWalls: [{ strike: 7800, pct: 9 }], putWalls: [] }, gammaFlip: null },
  ];
  const timeline = buildReplayTimeline(history, bars);

  // Quarter of the way in — the position that used to land on an older, rail-less day.
  const cursor = timeline[Math.floor(timeline.length / 4)]!;
  assert.ok(
    sliceHistoryToTime(history, cursor).length > 0,
    "a cursor a quarter into the scrubber must have wall history behind it, or the member sees " +
      "candles with no beads and reads the feature as broken"
  );
});

test("the rail is never truncated to the bar window — recorded structure is not dropped", () => {
  // A recorder that started before the first bar (pre-market) is real observed structure. Scoping
  // the BARS is a display fix; filtering the RAIL would be data loss.
  const bars = barsForDay(SESSION_OPEN_UTC, 390);
  const preMarket = SESSION_OPEN_UTC - 120;
  const history: WallHistorySample[] = [
    { time: preMarket, walls: { callWalls: [{ strike: 7800, pct: 9 }], putWalls: [] }, gammaFlip: null },
  ];
  const timeline = buildReplayTimeline(history, bars);
  assert.equal(timeline[0], preMarket, "the pre-market rail sample must survive as a replay step");
});

test("bars-only and history-only inputs still produce a usable timeline", () => {
  assert.deepEqual(buildReplayTimeline([], []), []);
  const barsOnly = buildReplayTimeline([], barsForDay(SESSION_OPEN_UTC, 3));
  assert.equal(barsOnly.length, 3, "no rail yet → scrub the candles of the latest session");
  const histOnly = buildReplayTimeline(
    [{ time: SESSION_OPEN_UTC, walls: { callWalls: [], putWalls: [] }, gammaFlip: null }],
    []
  );
  assert.deepEqual(histOnly, [SESSION_OPEN_UTC]);
});
