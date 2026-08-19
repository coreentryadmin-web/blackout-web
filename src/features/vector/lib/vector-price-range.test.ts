import { test } from "node:test";
import assert from "node:assert/strict";
import { extendRangeForWalls, NEAREST_WALL_VIEW_MAX_PCT, BEAD_VIEW_MAX_PCT, SESSION_OVERVIEW_MAX_SPAN_PCT, filterStrikesNearSpot, clampPriceRangeSpan, beadExtensionAllowed, rowAwareSpanPct, candleShareSpanCapPct, MIN_CANDLE_SHARE_OF_PANE } from "./vector-price-range";

// Candle band ~7510–7600 around spot 7575 (the live staging case), put walls far below.
const base = { minValue: 7510, maxValue: 7600 };

test("extends DOWN to reveal a put wall below the candle band (the purple-beads bug)", () => {
  const out = extendRangeForWalls(base, 7575, [7600], [7400, 7300, 7200], 0.05);
  // 7300 is 3.6% below spot (within 5%) → range floor drops to include it (plus pad).
  assert.ok(out.minValue < 7300, `min ${out.minValue} should reach below 7300 to show the put wall`);
  assert.ok(out.maxValue >= 7600, "top unchanged (call wall already in band)");
});

test("does NOT extend for a wall beyond the HARD cap (avoids squishing candles for a far wall)", () => {
  // Nearest-wall guarantee caps at NEAREST_WALL_VIEW_MAX_PCT (12%). A put wall 20% below spot is
  // past both the dense window AND the hard cap → must be ignored so candles don't collapse.
  const farPut = 7575 * (1 - 0.2); // 6060
  const out = extendRangeForWalls(base, 7575, [7600], [farPut], 0.05);
  assert.equal(out.minValue, base.minValue, "put wall past the 12% hard cap → floor unchanged");
});

test("REGRESSION (purple beads): reveals the NEAREST put wall just PAST the 5% dense window", () => {
  // Live NVDA case: spot 210.58, nearest (only) put wall 197.5 = 6.2% below → just outside the 5%
  // dense window, so the member saw only yellow call beads. The nearest-wall guarantee must pull it
  // into view (it's within the 12% hard cap) so the purple put beads render.
  const nvdaBase = { minValue: 204, maxValue: 226 };
  const out = extendRangeForWalls(nvdaBase, 210.58, [210, 216, 220], [197.5], 0.05);
  assert.ok(out.minValue <= 197.5, `min ${out.minValue} must drop to reveal the 197.5 put wall`);
  assert.ok(NEAREST_WALL_VIEW_MAX_PCT >= 0.1, "hard cap is generous enough for a ~6% put wall");
});

test("reveals nearest wall on BOTH sides at once (gold + purple both visible)", () => {
  const tight = { minValue: 99, maxValue: 101 };
  // call wall 108 (+8%) and put wall 92 (−8%) both past the 5% window but within 12%.
  const out = extendRangeForWalls(tight, 100, [108], [92], 0.05);
  assert.ok(out.maxValue >= 108, "top rises to the nearest call wall");
  assert.ok(out.minValue <= 92, "bottom drops to the nearest put wall");
});

test("extends UP to reveal a call wall above the candle band", () => {
  const tight = { minValue: 7560, maxValue: 7580 };
  const out = extendRangeForWalls(tight, 7575, [7620], [], 0.05);
  assert.ok(out.maxValue > 7620, "top rises to include the 7620 call wall + pad");
});

test("no change when all walls already sit inside the candle band", () => {
  const out = extendRangeForWalls(base, 7575, [7590], [7520], 0.05);
  assert.deepEqual(out, base);
});

test("null/zero spot or empty walls → returns base untouched, never throws", () => {
  assert.deepEqual(extendRangeForWalls(base, null, [7400], [7300], 0.05), base);
  assert.deepEqual(extendRangeForWalls(base, 7575, [], [], 0.05), base);
  assert.deepEqual(extendRangeForWalls(base, 7575, [NaN, 0], [NaN], 0.05), base);
});

test("drawn-bead pass reveals an ORPHAN bead (drawn from the trail, absent from the live ladder)", () => {
  // The zoom-disappear bug, modeled as the chart composes it: the live LADDER pass only knows the
  // current top-N ladder strikes. A bead drawn from the session TRAIL at a strike the ladder no
  // longer lists ("orphan") is passed to NEITHER ladder list → the ladder pass leaves it clipped,
  // and on zoom-in (tight candle band) it vanishes. The second pass over the DRAWN bead strikes is
  // what rescues it.
  const spot = 100;
  const candle = { minValue: 99, maxValue: 101 }; // zoomed-in: a narrow band around spot
  const orphanCall = 108; // +8% bead present in the trail but not in the current ladder
  const orphanPut = 92; //  −8%

  // Ladder pass gets EMPTY lists (the orphan isn't a current ladder wall) → range unchanged → clipped.
  const ladderOnly = extendRangeForWalls(candle, spot, [], [], 0.05);
  assert.deepEqual(ladderOnly, candle, "orphan bead absent from the ladder pass → still clipped");

  // Drawn-bead pass over the orphan strikes reveals both, at every zoom.
  const withBeads = extendRangeForWalls(ladderOnly, spot, [orphanCall], [orphanPut], BEAD_VIEW_MAX_PCT, BEAD_VIEW_MAX_PCT);
  assert.ok(withBeads.maxValue >= 108, "bead pass reveals the +8% orphan call bead");
  assert.ok(withBeads.minValue <= 92, "bead pass reveals the -8% orphan put bead");
});

test("BEAD_VIEW_MAX_PCT still bounds a pathologically far bead so candles aren't squashed", () => {
  const spot = 100;
  const candle = { minValue: 99, maxValue: 101 };
  // A garbage/very-far strike 40% away must NOT widen the axis (would squash candles to a sliver).
  const out = extendRangeForWalls(candle, spot, [140], [60], BEAD_VIEW_MAX_PCT, BEAD_VIEW_MAX_PCT);
  assert.ok(out.maxValue < 140, "a +40% outlier stays clipped by the 20% bead cap");
  assert.ok(out.minValue > 60, "a -40% outlier stays clipped by the 20% bead cap");
});

test("filterStrikesNearSpot keeps only strikes within the pct window", () => {
  const spot = 7785;
  const out = filterStrikesNearSpot([7600, 7700, 7780, 7900, 8100], spot, 0.03);
  assert.deepEqual(out, [7600, 7700, 7780, 7900]);
});

test("clampPriceRangeSpan: squashed SPX session overview reframes around spot", () => {
  const spot = 7785;
  const candles = { minValue: 7775, maxValue: 7795 };
  const squashed = { minValue: 7620, maxValue: 7960 };
  const out = clampPriceRangeSpan(squashed, spot, SESSION_OVERVIEW_MAX_SPAN_PCT, candles);
  const span = out.maxValue - out.minValue;
  assert.ok(span <= spot * SESSION_OVERVIEW_MAX_SPAN_PCT + 1, `span ${span} must fit cap`);
  assert.ok(out.minValue <= candles.minValue);
  assert.ok(out.maxValue >= candles.maxValue);
});

// ── PRICE-AXIS WIDENING vs THE TIME-AXIS PRESETS (2026-08-19) ────────────────────────────────
// The autoscale provider used to skip its wall/bead widening on `memberViewportLocked`, which reads
// `chartUserPanned` — a flag the intraday zoom presets set PROGRAMMATICALLY and nothing clears until
// a Session reset. Pressing STRUCTURE or LIVE therefore collapsed the price axis to the candle band
// for the rest of the session. Measured on prod at `structure`: SPX axis span 1.20% of spot (~14
// bead rows visible), NVDA 1.00% (ONE row) — the same collapse, reading as a ticker-specific defect
// only because an SPX strike step is ~0.065% of price and an NVDA step is ~1.14%.

test("beadExtensionAllowed: a time-axis preset does not suppress the price-axis widening", () => {
  // The preset path sets no wheel stamp at all — that is the whole point. Whatever it does to the
  // pan flag, the rail must still be revealed.
  assert.equal(beadExtensionAllowed(0, 1_000_000), true);
  assert.equal(beadExtensionAllowed(Number.NaN, 1_000_000), true);
  assert.equal(beadExtensionAllowed(-1, 1_000_000), true);
});

test("beadExtensionAllowed: a member's own recent scroll-zoom still suppresses it", () => {
  // Kept deliberately: during a live gesture the ~1/s SSE tick re-runs autoscale, and widening
  // mid-gesture snaps the view back to the wall-inclusive band under the member's cursor.
  const now = 1_000_000;
  assert.equal(beadExtensionAllowed(now - 100, now), false, "mid-gesture");
  assert.equal(beadExtensionAllowed(now - 7_999, now), false, "inside the cooldown");
  assert.equal(beadExtensionAllowed(now - 8_001, now), true, "cooldown elapsed — rail comes back");
});

test("beadExtensionAllowed: the cooldown is bounded, so a stale stamp can never lock the rail off", () => {
  // The failure mode being excluded: a flag that, once set, disables the rail forever. A wheel
  // stamp from earlier in the session must not still be suppressing anything.
  const now = 1_000_000;
  assert.equal(beadExtensionAllowed(now - 60 * 60 * 1000, now), true);
});

// ── ROW-AWARE SPAN: a percentage of price is the wrong unit for "how many rows fit" ──────────
// SESSION_OVERVIEW_MAX_SPAN_PCT (2.4%) was tuned on SPX, where it spans ~37 strike steps. The same
// constant on NVDA spans ~2. That is the second half of "NVDA has one level, SPX has ten".

test("rowAwareSpanPct: a dense index ladder is UNCHANGED (the constant already had room)", () => {
  // SPX 5-pt strikes at ~7690 → 0.065% per step. 10 rows needs 0.65%, well under the 2.4% floor,
  // so the tuned session-overview look is preserved exactly.
  const strikes = Array.from({ length: 12 }, (_, i) => 7650 + i * 5);
  assert.equal(rowAwareSpanPct(7690, strikes, 10, SESSION_OVERVIEW_MAX_SPAN_PCT, BEAD_VIEW_MAX_PCT),
    SESSION_OVERVIEW_MAX_SPAN_PCT);
});

test("rowAwareSpanPct: a coarse single-name ladder WIDENS to hold the same row count", () => {
  // NVDA $2.50 strikes at ~219 → 1.14% per step. 10 rows needs ~11.4%, so the window opens from
  // 2.4% (≈2 rows) to cover the rail the chart actually drew.
  const strikes = [207.5, 210, 212.5, 215, 217.5, 220, 222.5, 225, 227.5, 230];
  const pct = rowAwareSpanPct(219.28, strikes, 10, SESSION_OVERVIEW_MAX_SPAN_PCT, BEAD_VIEW_MAX_PCT);
  assert.ok(pct > SESSION_OVERVIEW_MAX_SPAN_PCT, `expected widening, got ${pct}`);
  assert.ok(pct <= BEAD_VIEW_MAX_PCT, "never past the hard ceiling");
  // Exactly 10 steps of 2.5 on a 219.28 spot — the span tracks the ladder, not a constant.
  assert.ok(Math.abs(pct - 25 / 219.28) < 1e-9, `span should track the ladder, got ${pct}`);
});

test("rowAwareSpanPct: the hard ceiling still bounds a pathological ladder", () => {
  // Two strikes 100 apart on a $50 name: the row-derived span would be many multiples of price.
  assert.equal(rowAwareSpanPct(50, [10, 110], 10, 0.024, 0.2), 0.2);
});

test("rowAwareSpanPct: unmeasurable geometry degrades to today's constant, never to a guess", () => {
  assert.equal(rowAwareSpanPct(219, [220], 10, 0.024, 0.2), 0.024, "one strike — no step to measure");
  assert.equal(rowAwareSpanPct(219, [], 10, 0.024, 0.2), 0.024, "no strikes");
  assert.equal(rowAwareSpanPct(0, [210, 220], 10, 0.024, 0.2), 0.024, "no spot");
  assert.equal(rowAwareSpanPct(219, [220, 220], 10, 0.024, 0.2), 0.024, "degenerate zero step");
  assert.equal(rowAwareSpanPct(219, [210, 220], 0, 0.024, 0.2), 0.024, "no rows requested");
});

test("rowAwareSpanPct: the step is the MEDIAN gap, not the mean", () => {
  // A real ladder is dense near spot and sparse in the wings (SPX lists 5-pt strikes near the money
  // and 25-pt strikes far out). A mean would be dragged by the wings into a window far wider than
  // the rows a member reads.
  const dense = [100, 101, 102, 103, 104, 105];
  const withWing = [...dense, 200];
  const a = rowAwareSpanPct(102, dense, 6, 0.001, 0.5);
  const b = rowAwareSpanPct(102, withWing, 6, 0.001, 0.5);
  assert.equal(a, b, "one far wing must not move the window");
});

// ── CANDLES GET A FLOOR, THE LADDER GETS THE REMAINDER (2026-08-19) ────────────────────────────
// Member report on NVDA: "I feel like somehow the candles are too small". Measured off that frame:
// axis 210-238 ($28 of pane), candle band ~217.3-222.1 ($4.8) — candles held 17%, the wall ladder
// took 83%. Nothing was misbehaving; NVDA moved $4.80 while its ladder legitimately wanted $22.
// The defect is that the window is sized from a ROW COUNT and the candles get the leftovers, so
// their share is an accident of how far apart that ticker's walls happen to sit.
test("candleShareSpanCapPct: the NVDA frame that prompted this is capped to the 35% floor", () => {
  // The real numbers off that screenshot.
  const spot = 219.28;
  const cap = candleShareSpanCapPct({ minValue: 217.3, maxValue: 222.1 }, spot)!;
  assert.ok(cap != null);

  // $4.80 of candles at a 35% floor implies a ~$13.7 window, i.e. ~6.25% of spot.
  assert.ok(Math.abs(cap - 4.8 / spot / 0.35) < 1e-9);
  const spanDollars = cap * spot;
  assert.ok(spanDollars > 13 && spanDollars < 14.5, `expected ~$13.7 window, got $${spanDollars.toFixed(2)}`);

  // And that window is genuinely tighter than the $28 the row count produced, which is the point.
  assert.ok(spanDollars < 28);
});

test("candleShareSpanCapPct: the cap only ever TIGHTENS a wider row-derived span", () => {
  const spot = 100;
  // 10% of spot in candles at a 35% floor -> a 28.6% window.
  const cap = candleShareSpanCapPct({ minValue: 95, maxValue: 105 }, spot)!;
  // A ladder asking for MORE than that is clamped down...
  assert.equal(Math.min(0.5, cap), cap);
  // ...but a ladder already tighter than the cap is left exactly as it was.
  assert.equal(Math.min(0.05, cap), 0.05);
});

test("candleShareSpanCapPct: a higher floor demands a tighter window, monotonically", () => {
  const range = { minValue: 95, maxValue: 105 };
  const at = (share: number) => candleShareSpanCapPct(range, 100, share)!;
  assert.ok(at(0.5) < at(0.35), "a 50% floor must be tighter than 35%");
  assert.ok(at(0.35) < at(0.25), "a 35% floor must be tighter than 25%");
});

// The guard that makes this safe to compose blindly: without it, a candle band with no range
// divides ~0 by the share and collapses the whole axis onto a single price.
test("candleShareSpanCapPct: unmeasurable candles yield NO cap, never a collapsed axis", () => {
  assert.equal(candleShareSpanCapPct({ minValue: 100, maxValue: 100 }, 100), null, "zero span");
  assert.equal(candleShareSpanCapPct({ minValue: 105, maxValue: 100 }, 100), null, "inverted span");
  assert.equal(candleShareSpanCapPct({ minValue: 95, maxValue: 105 }, 0), null, "no spot");
  assert.equal(candleShareSpanCapPct({ minValue: 95, maxValue: 105 }, 100, 0), null, "no share");
  assert.equal(candleShareSpanCapPct({ minValue: 95, maxValue: 105 }, 100, 1), null, "share of 1");
  // A band under 0.05% of spot is noise, not a range worth reserving a third of the pane for.
  assert.equal(candleShareSpanCapPct({ minValue: 99.99, maxValue: 100.01 }, 100), null, "sub-noise band");
});

test("MIN_CANDLE_SHARE_OF_PANE is a real fraction of the pane", () => {
  assert.ok(MIN_CANDLE_SHARE_OF_PANE > 0 && MIN_CANDLE_SHARE_OF_PANE < 1);
  // Below ~a quarter the candles read as a strip again, which is the bug this exists to prevent.
  assert.ok(MIN_CANDLE_SHARE_OF_PANE >= 0.25, "a floor under 25% does not fix the reported symptom");
});
