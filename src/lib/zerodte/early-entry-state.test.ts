import test from "node:test";
import assert from "node:assert/strict";
import { classifySetup, type RatedBar } from "./early-entry-state.ts";
import type { PressureBar } from "./early-entry-pressure.ts";

function bar(i: number, h: number, l: number, c: number): PressureBar {
  return { t: i * 60_000, h, l, c, v: 1000 };
}

/** 75 bars: 59 lookback (wide/noisy, establishing a LONG level at 110), then a 15-bar coil just
 *  under 110 with 2 real touches -- the same fixture shape early-entry-pressure.test.ts uses,
 *  reused here as the base every state-machine scenario extends. */
function baseLongBars(): PressureBar[] {
  const bars: PressureBar[] = [];
  for (let i = 0; i < 59; i++) bars.push(bar(i, 103 + (i % 3), 95, 100));
  bars.push(bar(59, 110, 100, 105));
  for (let i = 60; i < 75; i++) {
    const touchesLevel = i === 62 || i === 69;
    bars.push(bar(i, touchesLevel ? 109.85 : 109.3, 108.8, 109.1));
  }
  return bars;
}

function rate(
  bars: PressureBar[],
  ratio: number | null | ((i: number, b: PressureBar) => number | null)
): RatedBar[] {
  return bars.map((b, i) => ({ bar: b, rvolRatio: typeof ratio === "function" ? ratio(i, b) : ratio }));
}

test("classifySetup: no coil ever forms -> NO_SETUP", () => {
  const flat: PressureBar[] = Array.from({ length: 75 }, (_, i) => bar(i, 101, 99, 100));
  const r = classifySetup({ rated: rate(flat, 2.0), direction: "long" });
  assert.equal(r.state, "NO_SETUP");
  assert.equal(r.level, null);
  assert.equal(r.watch_detected_at_ms, null);
});

test("classifySetup: a coil with RVOL confirmed but price never crosses the trigger -> WATCH", () => {
  const bars = baseLongBars();
  const r = classifySetup({ rated: rate(bars, 2.0), direction: "long" });
  assert.equal(r.state, "WATCH");
  assert.equal(r.level, 110);
  assert.ok(r.trigger_price! > 110, "the trigger must be ABOVE the bare level -- a touch is not a break");
  assert.ok(r.invalidation_level! < 109, "invalidation sits below the coil's own low");
  // The sliding compression window is the last 15 bars of whatever's passed in -- detection fires
  // only once that whole window is populated by the tight coil bars (i=74), not at the first touch
  // (i=62), since up to i=73 the window still mixes in older, wider lookback bars.
  assert.equal(r.watch_detected_at_ms, bar(74, 0, 0, 0).t, "watch is detected once the full compression window is tight");
  assert.ok(r.watch_expires_at_ms! > r.watch_detected_at_ms!);
});

test("classifySetup: price closes beyond the trigger WITH RVOL confirmation -> ENTRY", () => {
  const bars = baseLongBars();
  // Add a real breakout bar shortly after the watch forms, closing well above the trigger.
  bars.push(bar(76, 111.5, 109.5, 111.2));
  const r = classifySetup({ rated: rate(bars, 2.0), direction: "long" });
  assert.equal(r.state, "ENTRY");
  assert.equal(r.entry_triggered_at_ms, bar(76, 0, 0, 0).t);
  assert.ok(r.pressure != null, "the pressure read at entry is still reported");
});

test("classifySetup: price crosses the trigger price but RVOL has since faded -> stays WATCH, never a false ENTRY", () => {
  const bars = baseLongBars();
  bars.push(bar(76, 111.5, 109.5, 111.2));
  const breakoutMs = bar(76, 0, 0, 0).t;
  const ratios = (_i: number, b: PressureBar) => (b.t === breakoutMs ? 1.0 : 2.0); // RVOL fades exactly at the breakout bar
  const r = classifySetup({ rated: rate(bars, ratios), direction: "long" });
  assert.equal(r.state, "WATCH", "a price break with no volume confirmation must not count as ENTRY");
});

test("classifySetup: price closes through the invalidation level before ever triggering -> INVALIDATED", () => {
  const bars = baseLongBars();
  bars.push(bar(76, 108.9, 108.0, 108.3)); // closes below the coil's own low (108.8) -- invalidated
  const r = classifySetup({ rated: rate(bars, 2.0), direction: "long" });
  assert.equal(r.state, "INVALIDATED");
  assert.equal(r.invalidated_at_ms, bar(76, 0, 0, 0).t);
  assert.equal(r.entry_triggered_at_ms, null);
});

test("classifySetup: the watch runs past its own TTL with no trigger and no invalidation -> EXPIRED", () => {
  const bars = baseLongBars();
  // 50 more quiet bars inside the range (default TTL is 45 minutes) -- never breaks either way.
  for (let i = 76; i < 126; i++) bars.push(bar(i, 109.4, 108.9, 109.1));
  const r = classifySetup({ rated: rate(bars, 2.0), direction: "long", watchTtlMin: 45 });
  assert.equal(r.state, "EXPIRED");
  assert.equal(r.entry_triggered_at_ms, null);
  assert.equal(r.invalidated_at_ms, null);
});

test("classifySetup: a SHORT setup triggers ENTRY symmetrically", () => {
  const bars: PressureBar[] = [];
  for (let i = 0; i < 59; i++) bars.push(bar(i, 105, 97 - (i % 3), 100));
  bars.push(bar(59, 100, 90, 95));
  for (let i = 60; i < 75; i++) {
    const touchesLevel = i === 62 || i === 69;
    bars.push(bar(i, 91.2, touchesLevel ? 90.13 : 90.7, 90.9));
  }
  bars.push(bar(76, 90.5, 88.5, 88.8)); // breaks decisively below the 90 level
  const r = classifySetup({ rated: rate(bars, 2.0), direction: "short" });
  assert.equal(r.state, "ENTRY");
  assert.equal(r.level, 90);
  assert.ok(r.trigger_price! < 90, "a short trigger sits BELOW the level");
});

test("classifySetup: a caller-supplied watchTtlMin changes when a watch goes stale", () => {
  const bars = baseLongBars();
  for (let i = 76; i < 90; i++) bars.push(bar(i, 109.4, 108.9, 109.1)); // 14 quiet bars after the watch
  const shortTtl = classifySetup({ rated: rate(bars, 2.0), direction: "long", watchTtlMin: 10 });
  const longTtl = classifySetup({ rated: rate(bars, 2.0), direction: "long", watchTtlMin: 60 });
  assert.equal(shortTtl.state, "EXPIRED", "a 10-minute TTL should already be stale 14 minutes in");
  assert.equal(longTtl.state, "WATCH", "a 60-minute TTL should still be live 14 minutes in");
});

test("classifySetup: input bars may be supplied out of order -- sorted internally before walking", () => {
  const bars = baseLongBars();
  bars.push(bar(76, 111.5, 109.5, 111.2));
  const rated = rate(bars, 2.0);
  const shuffled = [...rated].reverse();
  const a = classifySetup({ rated, direction: "long" });
  const b = classifySetup({ rated: shuffled, direction: "long" });
  assert.deepEqual(a, b);
});
