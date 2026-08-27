import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeTechnicals, technicalsCallouts, technicalsCalloutLines, type TechnicalsBar } from "./vector-technicals";

// RTH-anchored base (09:30 ET) — vwapSeries (used by summarizeTechnicals) is RTH-only (2026-08-05
// audit fix: it must not anchor on pre/post-market prints), so fixture bars need to fall inside
// 09:30-16:00 ET rather than raw epoch-0-based offsets, which land in 1970 pre-market.
const RTH_T0 = Math.floor(Date.parse("2026-07-13T09:30:00-04:00") / 1000);

/** Build bars from a close path: high=c+0.5, low=c-0.5, volume=1000, 1m spacing from the RTH open. */
const barsFrom = (closes: number[]): TechnicalsBar[] =>
  closes.map((c, i) => ({ time: RTH_T0 + 60 * i, high: c + 0.5, low: c - 0.5, close: c, volume: 1000 }));

// Accelerating (convex) trends, not linear ramps: a linear ramp makes MACD ≈ signal exactly, whose
// bull/bear tie resolves on floating-point noise. A real accelerating trend keeps macd clearly on
// one side of its signal, which is the honest read the terminal narrates.
const ACCEL_UP = Array.from({ length: 60 }, (_, i) => 100 + 0.5 * i + 0.03 * i * i); // convex rise
const ACCEL_DOWN = Array.from({ length: 60 }, (_, i) => 300 - 0.5 * i - 0.03 * i * i); // convex fall

test("summarizeTechnicals: accelerating uptrend → bullish EMA stack, overbought RSI, price above VWAP, MACD bullish", () => {
  const bars = barsFrom(ACCEL_UP);
  const s = summarizeTechnicals(bars, ACCEL_UP[ACCEL_UP.length - 1]!);

  assert.equal(s.emaStack, "bullish", "9>21>50 on a rise");
  assert.ok(s.ema9! > s.ema21! && s.ema21! > s.ema50!);
  assert.equal(s.rsiZone, "overbought", "strong rise → RSI ≥ 70");
  assert.ok(s.rsi! >= 70);
  assert.equal(s.macdState, "bullish", "macd line above signal on an accelerating rise");
  assert.ok(s.vwap != null && s.vwapDeltaPct != null && s.vwapDeltaPct > 0, "price leads the cumulative VWAP");

  const lines = technicalsCallouts(s);
  assert.ok(lines.some((l) => l.startsWith("VWAP ")), "VWAP line present");
  assert.ok(lines.some((l) => l.includes("stacked bullish")), "EMA stack line");
  assert.ok(lines.some((l) => l.startsWith("RSI ") && l.includes("overbought")), "RSI line");
  assert.ok(lines.some((l) => l.startsWith("MACD bullish")), "MACD line");
});

test("summarizeTechnicals: accelerating downtrend → bearish EMA stack + oversold RSI + MACD bearish", () => {
  const s = summarizeTechnicals(barsFrom(ACCEL_DOWN), ACCEL_DOWN[ACCEL_DOWN.length - 1]!);
  assert.equal(s.emaStack, "bearish", "9<21<50 on a decline");
  assert.equal(s.rsiZone, "oversold");
  assert.equal(s.macdState, "bearish");
  assert.ok(s.vwapDeltaPct! < 0, "price below the cumulative VWAP on a decline");
});

test("summarizeTechnicals: too few bars → higher-lookback studies degrade to null, no lines for them", () => {
  const bars = barsFrom([100, 101, 102, 101, 103]); // 5 bars
  const s = summarizeTechnicals(bars, 103);
  assert.equal(s.ema50, null, "50-EMA needs 50 bars");
  assert.equal(s.emaStack, null);
  assert.equal(s.rsi, null, "RSI(14) needs 14+");
  assert.equal(s.rsiZone, null);
  assert.equal(s.macdState, null, "MACD needs the slow-EMA seed");
  // VWAP computes from one bar, so its line can still appear; the momentum lines must not.
  const lines = technicalsCallouts(s);
  assert.ok(!lines.some((l) => l.includes("EMA 9/21/50")), "no EMA-stack line");
  assert.ok(!lines.some((l) => l.startsWith("RSI ")), "no RSI line");
  assert.ok(!lines.some((l) => l.startsWith("MACD ")), "no MACD line");
});

test("summarizeTechnicals: a real swing yields a golden pocket; empty bars yield an empty readout", () => {
  // A path with a confirmed low pivot then a dominant up-leg (same shape the fib-swing engine tests
  // use) — a pure monotonic ramp has no internal pivots, so it would (correctly) yield no swing.
  const BIG_THEN_SMALL = [100, 98, 95, 100, 105, 108, 110, 107, 105, 104, 105, 106, 107, 106, 105];
  const s = summarizeTechnicals(barsFrom(BIG_THEN_SMALL), 105);
  assert.ok(s.goldenPocket != null, "dominant swing → golden pocket");
  assert.ok(s.goldenPocket!.high > s.goldenPocket!.low, "pocket returned low-to-high");

  const empty = summarizeTechnicals([], null);
  assert.equal(empty.spot, null);
  assert.equal(empty.vwap, null);
  assert.deepEqual(technicalsCallouts(empty), [], "no bars → nothing to narrate");
});

test("summarizeTechnicals: spot defaults to the last close when not provided", () => {
  const bars = barsFrom([100, 105, 110]);
  assert.equal(summarizeTechnicals(bars, null).spot, 110);
  assert.equal(summarizeTechnicals(bars, 0).spot, 110, "invalid spot also falls back to last close");
});

// ---------------------------------------------------------------------------
// technicalsCalloutLines — tone-per-line (2026-08-05, colored 4th-column technicals)
// ---------------------------------------------------------------------------

test("technicalsCalloutLines: uptrend → every directional line tones bull, text matches technicalsCallouts", () => {
  const bars = barsFrom(ACCEL_UP);
  const s = summarizeTechnicals(bars, ACCEL_UP[ACCEL_UP.length - 1]!);
  const lines = technicalsCalloutLines(s);

  assert.deepEqual(lines.map((l) => l.text), technicalsCallouts(s), "text must match the legacy plain-string API exactly");

  const vwap = lines.find((l) => l.text.startsWith("VWAP "));
  assert.equal(vwap?.tone, "bull", "price above VWAP → bull");
  const ema = lines.find((l) => l.text.includes("stacked bullish"));
  assert.equal(ema?.tone, "bull");
  const macd = lines.find((l) => l.text.startsWith("MACD bullish"));
  assert.equal(macd?.tone, "bull");
  const rsi = lines.find((l) => l.text.startsWith("RSI "));
  assert.equal(rsi?.tone, "warn", "overbought is a caution, not a directional bull call");
});

test("technicalsCalloutLines: downtrend → every directional line tones bear", () => {
  const s = summarizeTechnicals(barsFrom(ACCEL_DOWN), ACCEL_DOWN[ACCEL_DOWN.length - 1]!);
  const lines = technicalsCalloutLines(s);

  const vwap = lines.find((l) => l.text.startsWith("VWAP "));
  assert.equal(vwap?.tone, "bear");
  const ema = lines.find((l) => l.text.includes("stacked bearish"));
  assert.equal(ema?.tone, "bear");
  const macd = lines.find((l) => l.text.startsWith("MACD bearish"));
  assert.equal(macd?.tone, "bear");
  const rsi = lines.find((l) => l.text.startsWith("RSI "));
  assert.equal(rsi?.tone, "warn", "oversold is a caution, not a directional bear call");
});

test("technicalsCalloutLines: mixed EMA stack and neutral RSI tone muted", () => {
  // A short choppy path — not a clean accelerating trend in either direction.
  const CHOP = [100, 102, 99, 103, 100, 104, 101, 105, 102, 106, 103, 107, 104, 108, 105, 109, 106, 110, 107, 111,
    108, 112, 109, 113, 110, 114, 111, 115, 112, 116, 113, 117, 114, 118, 115, 119, 116, 120, 117, 121,
    118, 122, 119, 123, 120, 124, 121, 125, 122, 126, 123, 127];
  const s = summarizeTechnicals(barsFrom(CHOP), CHOP[CHOP.length - 1]!);
  const lines = technicalsCalloutLines(s);
  if (s.emaStack === "mixed") {
    const ema = lines.find((l) => l.text.includes("EMA 9/21/50"));
    assert.equal(ema?.tone, "muted");
  }
  if (s.rsiZone === "neutral") {
    const rsi = lines.find((l) => l.text.startsWith("RSI "));
    assert.equal(rsi?.tone, "muted");
  }
});

test("technicalsCalloutLines: golden pocket always tones muted (a price zone, not a directional call)", () => {
  const BIG_THEN_SMALL = [100, 98, 95, 100, 105, 108, 110, 107, 105, 104, 105, 106, 107, 106, 105];
  const s = summarizeTechnicals(barsFrom(BIG_THEN_SMALL), 105);
  const lines = technicalsCalloutLines(s);
  const pocket = lines.find((l) => l.text.startsWith("Golden pocket"));
  assert.equal(pocket?.tone, "muted");
});

test("technicalsCalloutLines: structure direction maps to bull/bear", () => {
  const s = summarizeTechnicals(barsFrom(ACCEL_UP), ACCEL_UP[ACCEL_UP.length - 1]!);
  if (s.structure) {
    const lines = technicalsCalloutLines(s);
    const structLine = lines.find((l) => l.text.startsWith("Structure"));
    assert.equal(structLine?.tone, s.structure.direction === "up" ? "bull" : "bear");
  }
});

test("technicalsCalloutLines: empty bars → empty array", () => {
  const empty = summarizeTechnicals([], null);
  assert.deepEqual(technicalsCalloutLines(empty), []);
});

test("guard: VectorChart resolves the technicals/gamma-regime-glow spot from the FRAME, not the live tick, during replay", () => {
  // Regression guard for the 2026-08-27 fix: summarizeTechnicals() and the gamma-regime glow both
  // used to read spotRef.current directly inside paintOverlays. spotRef.current is written
  // unconditionally on every live SSE tick (the tape stays open during replay by design), so
  // scrubbing the chart to an earlier time computed VWAP/regime-glow correctly from the
  // cursor-sliced historical bars but still compared them against TODAY's live spot -- e.g. the
  // TECHNICALS panel's "price N% above/below VWAP" line mixing live price against a
  // scrubbed-to-the-past VWAP, and the gamma-regime glow lighting up the wrong side of the
  // (correctly historical) flip line. paintOverlays now takes an explicit frameSpot, and
  // applyFrame (the replay path) must pass the cursor bar's own close rather than leaving it to
  // fall back to the live ref. No React rendering harness exists in this repo to mount the
  // component directly, so this asserts the fix is wired into the source.
  const src = readFileSync(join(process.cwd(), "src/features/vector/components/VectorChart.tsx"), "utf8");
  assert.match(
    src,
    /const paintOverlays = useCallback\(\(bars: VectorBar\[\], frameSpot\?: number \| null\)/,
    "paintOverlays must accept an explicit frame spot"
  );
  assert.match(
    src,
    /const resolvedSpot = frameSpot !== undefined \? frameSpot : spotRef\.current;/,
    "paintOverlays must resolve spot from the frame when one is supplied, falling back to the live ref only for ordinary live-tick paints"
  );
  assert.match(src, /summarizeTechnicals\(bars, resolvedSpot\)/, "technicals summary must use the resolved (frame-aware) spot");
  assert.match(src, /spot: resolvedSpot,/, "gamma-regime glow must use the resolved (frame-aware) spot");
  assert.match(
    src,
    /const frameSpot = visibleBars\.length \? visibleBars\[visibleBars\.length - 1\]!\.close : null;\s*\n\s*paintOverlays\(visibleBars, frameSpot\);/,
    "applyFrame (the replay path) must pass the cursor bar's own close as the frame spot"
  );
});
