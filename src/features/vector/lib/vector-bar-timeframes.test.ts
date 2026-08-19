import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateVectorBars,
  wallCountForTimeframe,
  anchorBandPctForTimeframe,
  VECTOR_WALL_NODES_PER_SIDE,
  VECTOR_PRESET_TIMEFRAMES,
  VECTOR_DEFAULT_TIMEFRAME,
  VECTOR_0DTE_WALL_COUNT,
  isPresetTimeframe,
} from "./vector-bar-timeframes";

const m1 = (
  timeSec: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume?: number
) => ({
  time: timeSec,
  open: o,
  high: h,
  low: l,
  close: c,
  ...(volume != null ? { volume } : {}),
});

test("VECTOR_PRESET_TIMEFRAMES: includes the 30m + 60m intraday roll-ups", () => {
  assert.deepEqual([...VECTOR_PRESET_TIMEFRAMES], [1, 3, 5, 15, 30, 60]);
  assert.equal(VECTOR_DEFAULT_TIMEFRAME, 3, "default chart interval is 3-minute");
  assert.ok(isPresetTimeframe(30) && isPresetTimeframe(60), "30/60 are presets");
  assert.ok(!isPresetTimeframe(45), "non-preset stays custom");
});

test("aggregateVectorBars: 60m rolls a session's 1m bars into hourly buckets", () => {
  const base = 60 * 3600; // aligned to a 60m boundary
  const bars = [
    m1(base, 100, 101, 99, 100.5),
    m1(base + 60, 100.5, 103, 100, 102), // same hour → merges
    m1(base + 3600, 102, 104, 101, 103), // next hour → new bucket
  ];
  const out = aggregateVectorBars(bars, 60);
  assert.equal(out.length, 2, "two hourly buckets");
  assert.equal(out[0]!.open, 100);
  assert.equal(out[0]!.high, 103, "high across the hour");
  assert.equal(out[0]!.low, 99, "low across the hour");
  assert.equal(out[0]!.close, 102, "last close in the hour");
  assert.equal(out[1]!.open, 102);
});

test("aggregateVectorBars: 1m passthrough unchanged", () => {
  const bars = [m1(1000, 1, 2, 0.5, 1.5), m1(1060, 1.5, 2.5, 1, 2)];
  assert.deepEqual(aggregateVectorBars(bars, 1), bars);
});

test("aggregateVectorBars: 3m merges OHLC across three 1m bars", () => {
  const base = 180 * 1000;
  const bars = [
    m1(base, 100, 101, 99, 100.5),
    m1(base + 60, 100.5, 102, 100, 101),
    m1(base + 120, 101, 103, 100.5, 102.5),
    m1(base + 180, 102.5, 104, 102, 103),
  ];
  const out = aggregateVectorBars(bars, 3);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.time, base);
  assert.equal(out[0]!.open, 100);
  assert.equal(out[0]!.high, 103);
  assert.equal(out[0]!.low, 99);
  assert.equal(out[0]!.close, 102.5);
  assert.equal(out[1]!.open, 102.5);
  assert.equal(out[1]!.close, 103);
});

test("aggregateVectorBars: 15m aligns buckets to interval boundary", () => {
  const bucket = 900;
  const t0 = bucket * 100;
  const bars = [m1(t0, 1, 2, 0.5, 1.5), m1(t0 + 60, 1.5, 2.5, 1, 2)];
  const out = aggregateVectorBars(bars, 15);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.time, t0);
  assert.equal(out[0]!.close, 2);
});

test("aggregateVectorBars: sums volume within higher-interval buckets", () => {
  const base = 300 * 60;
  const bars = [
    m1(base, 10, 11, 9, 10.5, 100),
    m1(base + 60, 10.5, 12, 10, 11, 200),
    m1(base + 120, 11, 12, 10.5, 11.5, 50),
  ];
  const out = aggregateVectorBars(bars, 5);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.volume, 350);
});

test("aggregateVectorBars: custom 10m interval buckets", () => {
  const base = 600 * 60;
  const bars = [
    m1(base, 1, 2, 0.5, 1.5),
    m1(base + 60, 1.5, 2.5, 1, 2),
    m1(base + 600, 2, 3, 1.5, 2.5),
  ];
  const out = aggregateVectorBars(bars, 10);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.close, 2);
  assert.equal(out[1]!.close, 2.5);
});

// The ladder STEPPED UP on 2026-08-19 (1m 6->10, 3m 10->14, 5m 10->16, 15m 12->18, 30m+ ->20).
// The old, lower numbers were a defence against a rail where every row painted with roughly equal
// weight — the bead swell was normalised against each row's own peak, so a marginal level looked
// about as big as a dominant one (measured separation on real SPX data: 1.26x). With one shared
// denominator a weak level now recedes to a faint trace by itself, so the row count no longer has
// to do the decluttering and a low ceiling only hides readable structure.
test("wallCountForTimeframe: preset timeframes map to the specified shown-counts", () => {
  // Walked back from 10/14/16/18 the same day: those counts compressed the SPX 3m row gap from
  // 26px to 17px, and at 17px BEAD_READABLE_MIN_HALF_PX alone fills 38% of every slot — no
  // thickness budget can bind below the readability floor. Still well above the pre-2026-08-19
  // 6/10/10/12; the point was never to maximise rows, it was to stop hiding structure.
  assert.equal(wallCountForTimeframe(1), 8, "1m shows 8 near-spot walls");
  assert.equal(wallCountForTimeframe(3), 11, "3m shows 11");
  assert.equal(wallCountForTimeframe(5), 13, "5m shows 13");
  assert.equal(wallCountForTimeframe(15), 16, "15m shows 16");
  assert.equal(wallCountForTimeframe(30), 20, "30m saturates at the recorder cap");
  assert.equal(wallCountForTimeframe(60), 20, "60m stays at the cap");
  assert.equal(wallCountForTimeframe(120), 20, "2h stays at the cap");
});

// The shape matters more than any single number: a wider price band must never show FEWER walls.
test("wallCountForTimeframe: monotonic non-decreasing in the timeframe", () => {
  const tfs = [1, 3, 5, 15, 30, 60, 120, 240] as const;
  for (let i = 1; i < tfs.length; i++) {
    assert.ok(
      wallCountForTimeframe(tfs[i]!) >= wallCountForTimeframe(tfs[i - 1]!),
      `tf=${tfs[i]} must not show fewer walls than tf=${tfs[i - 1]}`
    );
  }
});

// The step-up must never outrun what the recorder actually persisted, or the extra rows are empty
// rails that read as missing data rather than as absent structure.
test("wallCountForTimeframe: the raised ladder still respects the recorder cap at every step", () => {
  for (const tf of [1, 3, 5, 15, 30, 60, 120, 240] as const) {
    assert.ok(
      wallCountForTimeframe(tf) <= VECTOR_WALL_NODES_PER_SIDE,
      `tf=${tf} asks for rows the server never recorded`
    );
  }
});

test("wallCountForTimeframe: never exceeds VECTOR_WALL_NODES_PER_SIDE, even for huge intervals", () => {
  assert.equal(VECTOR_WALL_NODES_PER_SIDE, 20);
  for (const tf of [15, 30, 60, 120, 240]) {
    assert.ok(
      wallCountForTimeframe(tf) <= VECTOR_WALL_NODES_PER_SIDE,
      `tf=${tf} must not exceed the server cap`
    );
  }
  assert.equal(wallCountForTimeframe(240), 20, "largest interval saturates at the cap");
});

test("anchorBandPctForTimeframe: widens with the timeframe, monotonic non-decreasing", () => {
  assert.equal(anchorBandPctForTimeframe(1), 0.02, "1m tight band");
  assert.equal(anchorBandPctForTimeframe(15), 0.055, "15m");
  assert.equal(anchorBandPctForTimeframe(60), 0.09, "60m");
  assert.equal(anchorBandPctForTimeframe(240), 0.12, "4h widest");
  const tfs = [1, 3, 5, 15, 30, 60, 120, 240];
  let prev = 0;
  for (const tf of tfs) {
    const b = anchorBandPctForTimeframe(tf);
    assert.ok(b >= prev, `tf=${tf} band (${b}) must be >= previous (${prev})`);
    prev = b;
  }
});

test("wallCountForTimeframe: monotonic non-decreasing across ascending timeframes", () => {
  // Sub-1m / zero / negative clamp up to at least 1; higher tf never returns fewer walls.
  const tfs = [0, 1, 2, 3, 4, 5, 6, 10, 15, 30, 240];
  let prev = 0;
  for (const tf of tfs) {
    const count = wallCountForTimeframe(tf);
    assert.ok(count >= 1, `tf=${tf} clamps to >= 1`);
    assert.ok(count >= prev, `tf=${tf} (${count}) must be >= previous (${prev})`);
    prev = count;
  }
});

test("mergeBarsByTime: fills reconnect holes, prefers fetched OHLC, preserves live volume", async () => {
  const { mergeBarsByTime } = await import("./vector-bar-timeframes");
  const mk = (t: number, px: number, volume?: number) => ({
    time: t, open: px, high: px, low: px, close: px, ...(volume != null ? { volume } : {}),
  });
  const existing = [mk(60, 1, 500), mk(120, 2), mk(300, 5)]; // hole at 180/240
  const fetched = [mk(60, 1.5), mk(120, 2.5, 900), mk(180, 3), mk(240, 4)];
  const merged = mergeBarsByTime(existing, fetched);
  assert.deepEqual(merged.map((b) => b.time), [60, 120, 180, 240, 300], "holes filled, sorted");
  assert.equal(merged[0]!.close, 1.5, "fetched OHLC replaces live-built bar");
  assert.equal(merged[0]!.volume, 500, "live volume survives a volumeless fetched row");
  assert.equal(merged[1]!.volume, 900, "fetched volume wins when present");
  assert.equal(merged[4]!.close, 5, "existing bars beyond the fetch window survive");
});

test("wallCountForHorizon: 0DTE matches the 3m desk row cap", async () => {
  const { wallCountForHorizon, wallCountForTimeframe, VECTOR_0DTE_WALL_COUNT } = await import(
    "./vector-bar-timeframes"
  );
  // Pinned to the FLOOR rather than to equality with VECTOR_0DTE_WALL_COUNT. The 3m desk row cap
  // now exceeds that constant (14 vs 10) after the 2026-08-19 step-up, and the invariant that
  // actually matters is that the 0DTE horizon never shows fewer rows than the timeframe would —
  // an equality assertion here would fail every future step-up while proving nothing extra.
  assert.ok(wallCountForTimeframe(3) >= VECTOR_0DTE_WALL_COUNT);
  for (const horizon of ["0dte", "weekly", "all"] as const) {
    assert.equal(
      wallCountForHorizon(3, horizon),
      wallCountForTimeframe(3),
      `${horizon} must not drop below the 3m desk row cap`
    );
    assert.ok(wallCountForHorizon(3, horizon) >= VECTOR_0DTE_WALL_COUNT);
  }
});




