import test from "node:test";
import assert from "node:assert/strict";
import {
  computeVectorBarAnalytics,
  priorSessionOhlc,
  opexContext,
  VECTOR_PIVOT_K,
} from "./vector-analytics-core";

/** 09:30 ET on 2026-08-10 (a Monday) in epoch seconds — the bars are seconds, like the chart's. */
const SESSION_OPEN = Math.floor(Date.parse("2026-08-10T13:30:00Z") / 1000);
const DAY = 86_400;

/** A session of 1m bars with a deterministic zig-zag so pivots and swings actually exist. */
function session(startSec: number, base: number, count = 120) {
  return Array.from({ length: count }, (_, i) => {
    // Two full oscillations over the session, amplitude ~1% of base — comfortably above the
    // 0.15%-of-price swing floor, so the auto-fib has something real to find.
    const wave = Math.sin((i / count) * Math.PI * 4) * base * 0.01;
    const close = base + wave;
    return {
      time: startSec + i * 60,
      open: close,
      high: close + base * 0.001,
      low: close - base * 0.001,
      close,
      volume: 1000 + (i % 7) * 100,
    };
  });
}

test("no bars yields null — a missing chart is not an empty one", () => {
  assert.equal(computeVectorBarAnalytics([]), null);
});

test("every bar-derived panel is composed from ONE bar set", () => {
  const a = computeVectorBarAnalytics(session(SESSION_OPEN, 700), { timeframeMin: 5 })!;
  assert.equal(a.bars_analyzed, 120);
  assert.equal(a.timeframe_min, 5);
  // Volume profile is read off the MINUTE bars (as VectorChart does), not the aggregated ones.
  assert.ok(a.volume_profile.total_volume > 0);
  assert.ok(a.volume_profile.poc != null);
  assert.ok(a.volume_profile.value_area_low! <= a.volume_profile.poc!);
  assert.ok(a.volume_profile.value_area_high! >= a.volume_profile.poc!);
  assert.equal(a.volume_profile.empty_reason, null);
  assert.ok(a.volume_profile.top_buckets.length > 0);
  // Heaviest first, so a cap keeps the peak rather than an arbitrary price slice.
  const vols = a.volume_profile.top_buckets.map((b) => b.volume);
  assert.deepEqual(vols, [...vols].sort((x, y) => y - x));
});

test("structure uses the chart's own fractal k, not a private one", () => {
  const a = computeVectorBarAnalytics(session(SESSION_OPEN, 700), { timeframeMin: 5 })!;
  // VectorChart.tsx calls buildStructureMarkers(bars, 3); a different k would label a different
  // set of pivots than the member is looking at.
  assert.equal(VECTOR_PIVOT_K, 3);
  assert.equal(a.market_structure.pivot_k, 3);
  assert.ok(a.market_structure.pivots.length > 0);
  for (const p of a.market_structure.pivots) {
    assert.ok(["HH", "LH", "HL", "LL", "H", "L"].includes(p.label));
    assert.ok(["high", "low"].includes(p.kind));
  }
});

test("BOS and CHOCH stay distinct — collapsing them loses the only actionable part", () => {
  const a = computeVectorBarAnalytics(session(SESSION_OPEN, 700), { timeframeMin: 5 })!;
  for (const e of a.market_structure.events) {
    assert.ok(e.type === "BOS" || e.type === "CHOCH");
    assert.ok(e.direction === "up" || e.direction === "down");
  }
  if (a.market_structure.events.length) {
    const last = a.market_structure.events[a.market_structure.events.length - 1]!;
    assert.deepEqual(a.market_structure.latest_event, last);
  } else {
    assert.equal(a.market_structure.latest_event, null);
  }
});

test("a flat tape reports NO swing with a reason, never a hairline pocket at spot", () => {
  // Every bar identical: no swing can clear the 0.15%-of-price floor.
  const flat = Array.from({ length: 60 }, (_, i) => ({
    time: SESSION_OPEN + i * 60,
    open: 700,
    high: 700,
    low: 700,
    close: 700,
    volume: 10,
  }));
  const a = computeVectorBarAnalytics(flat)!;
  assert.equal(a.fib_swing, null);
  assert.equal(a.fib_swing_empty_reason, "no_swing_above_min_range");
});

test("the golden pocket is a ZONE and the retracements are ordered inside the swing", () => {
  const a = computeVectorBarAnalytics(session(SESSION_OPEN, 700), { timeframeMin: 5 })!;
  const s = a.fib_swing;
  assert.ok(s, "the zig-zag fixture must produce a dominant swing");
  assert.ok(s!.high > s!.low);
  assert.deepEqual(s!.retracements.map((r) => r.ratio), [0.382, 0.5, 0.618, 0.786]);
  for (const r of s!.retracements) {
    assert.ok(r.price >= s!.low && r.price <= s!.high, `${r.ratio} retracement inside the swing`);
  }
  const gp = s!.golden_pocket!;
  assert.deepEqual(gp.ratios, [0.618, 0.65]);
  assert.ok(gp.top !== gp.bottom, "a pocket is a band, not a line");
});

test("prior-session OHLC is peeled with the production session splitter, twice", () => {
  const two = [...session(SESSION_OPEN - DAY, 690, 60), ...session(SESSION_OPEN, 700, 60)];
  const pd = priorSessionOhlc(two)!;
  // Bounds come from the EARLIER day (base 690), never smeared across both sessions.
  assert.ok(pd.pdh < 700, `pdh ${pd.pdh} must belong to the prior session`);
  assert.ok(pd.pdl > 670);
  assert.ok(pd.pdc > 670 && pd.pdc < 710);
});

test("one session means NO prior day — pivots from a partial day would be confidently wrong", () => {
  const one = session(SESSION_OPEN, 700, 60);
  assert.equal(priorSessionOhlc(one), null);
  const a = computeVectorBarAnalytics(one)!;
  assert.equal(a.key_levels.prior_session_ohlc, null);
  // The two prior-day-dependent groups draw nothing rather than a bogus level.
  assert.deepEqual(a.key_levels.prior_day, []);
  assert.deepEqual(a.key_levels.floor_pivots, []);
  assert.equal(priorSessionOhlc([]), null);
});

test("floor pivots appear once a real prior session exists", () => {
  const two = [...session(SESSION_OPEN - DAY, 690, 60), ...session(SESSION_OPEN, 700, 60)];
  const a = computeVectorBarAnalytics(two)!;
  assert.ok(a.key_levels.prior_session_ohlc);
  const keys = a.key_levels.floor_pivots.map((l) => l.key);
  assert.ok(keys.length >= 7, `P + R1-R3 + S1-S3, got ${keys.length}`);
  assert.deepEqual(a.key_levels.prior_day.length > 0, true);
});

test("the opening-range window is the member's, and it is labelled with it", () => {
  const bars = session(SESSION_OPEN, 700, 120);
  const or30 = computeVectorBarAnalytics(bars, { timeframeMin: 5, openingRangeMinutes: 30 })!;
  assert.equal(or30.key_levels.opening_range_minutes, 30);
  for (const l of or30.key_levels.opening_range) assert.match(l.label, /30m/);
  // Default stays 15 for any caller that does not pass one.
  const def = computeVectorBarAnalytics(bars, { timeframeMin: 5 })!;
  assert.equal(def.key_levels.opening_range_minutes, 15);
});

test("no volume is reported as a reason, not as a quiet session", () => {
  const noVol = session(SESSION_OPEN, 700, 60).map((b) => ({ ...b, volume: 0 }));
  const a = computeVectorBarAnalytics(noVol)!;
  assert.equal(a.volume_profile.total_volume, 0);
  assert.equal(a.volume_profile.poc, null);
  assert.equal(a.volume_profile.empty_reason, "no_volume_on_bars");
});

test("OpEx: the next expiry, the next QUARTERLY one, and honest days-away", () => {
  // 2026-08-10 is a Monday. August OpEx is Fri 2026-08-21; September's (the quarterly) is 09-18.
  const ctx = opexContext(Date.parse("2026-08-10T12:00:00Z"));
  assert.equal(ctx.next!.date, "2026-08-21");
  assert.equal(ctx.next!.quarterly, false);
  assert.equal(ctx.next!.days_away, 11);
  assert.equal(ctx.next_quarterly!.date, "2026-09-18");
  assert.equal(ctx.next_quarterly!.quarterly, true);
  assert.ok(ctx.upcoming.length > 1);
  // Ascending, and never a past date.
  const days = ctx.upcoming.map((r) => r.days_away);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.ok(days.every((d) => d >= 0));
});

test("OpEx day itself reads as 0 days away, never rounded into tomorrow", () => {
  const ctx = opexContext(Date.parse("2026-08-21T18:00:00Z"));
  assert.equal(ctx.next!.date, "2026-08-21");
  assert.equal(ctx.next!.days_away, 0, "today's expiry is a different claim from tomorrow's");
});
