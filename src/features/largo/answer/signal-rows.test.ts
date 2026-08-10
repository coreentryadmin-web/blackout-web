import test from "node:test";
import assert from "node:assert/strict";
import { signalRowsFromLevels, signalRowForMetric, tallySignals, BIAS_GLYPH } from "./signal-rows";
import type { BieLevel } from "@/lib/bie/answer-envelope";

/** The live SPX shape: spot under VWAP and under the flip, below the call wall. */
const LEVELS: BieLevel[] = [
  { label: "Spot", price: 7752.65 },
  { label: "VWAP", price: 7753.32 },
  { label: "Gamma flip", price: 7771.1 },
  { label: "Call wall", price: 7800 },
  { label: "Max pain", price: 7675 },
];

test("level rows are computed from arithmetic, not phrasing", () => {
  const rows = signalRowsFromLevels(LEVELS);
  const by = (l: string) => rows.find((r) => r.label.includes(l))!;

  assert.equal(by("VWAP").bias, "bear");
  assert.equal(by("VWAP").reading, "7,753.32 · spot below");
  assert.equal(by("Gamma flip").bias, "bear");
  // Below the call wall is NOT bearish — it is simply not yet at resistance.
  assert.equal(by("Call wall").bias, "bull");
});

test("max pain gets NO row — it is a magnet, not a direction", () => {
  const rows = signalRowsFromLevels(LEVELS);
  assert.equal(rows.some((r) => /max pain/i.test(r.label)), false);
});

test("a level with no stated convention produces no arrow", () => {
  const rows = signalRowsFromLevels([
    { label: "Spot", price: 100 },
    { label: "Zero-vanna flip", price: 110 },
    { label: "Gamma magnet", price: 90 },
  ]);
  assert.deepEqual(rows, []);
});

test("no spot means no rows — every row is a comparison", () => {
  assert.deepEqual(signalRowsFromLevels(LEVELS.filter((l) => l.label !== "Spot")), []);
  assert.deepEqual(signalRowsFromLevels([]), []);
  assert.deepEqual(signalRowsFromLevels(undefined), []);
});

test("the bias flips correctly when spot crosses a level", () => {
  const above: BieLevel[] = [
    { label: "Spot", price: 7800 },
    { label: "VWAP", price: 7753.32 },
  ];
  assert.equal(signalRowsFromLevels(above)[0]!.bias, "bull");
  assert.match(signalRowsFromLevels(above)[0]!.reading, /spot above/);
});

test("every row carries its reason — an arrow is never unaccountable", () => {
  for (const r of signalRowsFromLevels(LEVELS)) {
    assert.ok(r.because.length > 20, r.label);
  }
});

test("TRIN polarity is INVERTED — the classic sign error", () => {
  assert.equal(signalRowForMetric("TRIN", 0.5)!.bias, "bull");
  assert.equal(signalRowForMetric("TRIN", 1.8)!.bias, "bear");
  assert.match(signalRowForMetric("TRIN", 0.5)!.because, /inverted/);
});

test("TICK and A/D read positive-is-bullish", () => {
  assert.equal(signalRowForMetric("TICK", -265)!.bias, "bear");
  assert.equal(signalRowForMetric("TICK", 480)!.bias, "bull");
  assert.equal(signalRowForMetric("A/D", -1200)!.bias, "bear");
});

test("an unknown metric returns null rather than a guessed polarity", () => {
  assert.equal(signalRowForMetric("VIX", 17.6), null);
  assert.equal(signalRowForMetric("skew", 1.2), null);
  assert.equal(signalRowForMetric("TICK", null), null);
  assert.equal(signalRowForMetric("TICK", Number.NaN), null);
});

test("the tally counts sides and the glyphs are the restrained set", () => {
  const t = tallySignals(signalRowsFromLevels(LEVELS));
  assert.equal(t.total, 3);
  assert.equal(t.bear, 2);
  assert.equal(t.bull, 1);
  assert.deepEqual(BIAS_GLYPH, { bull: "🟢 ↑", bear: "🔴 ↓", neutral: "🟡 ↔" });
});
