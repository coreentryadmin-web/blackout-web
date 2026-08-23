import { test } from "node:test";
import assert from "node:assert/strict";
import { tideSplit, netPremiumSense } from "./helix-tide-split";

/** The old, shipped derivation — kept here so the tests can show what it did on real inputs. */
const oldCallPct = (call: number, put: number) => {
  const gross = call + put;
  return gross > 0 ? (call / gross) * 100 : 50;
};

test("the shipped defect, on real measured inputs from 2026-08-21", () => {
  // 09:30 ET: both sides net SOLD. Sum is negative, so the old bar fell back to a flat 50/50 while
  // the bias pill beside it read BULLISH.
  const call = -3_871_478, put = -8_210_779;
  assert.equal(oldCallPct(call, put), 50, "the old bar really did render a flat 50/50 here");

  const s = tideSplit(call, put);
  // Puts sold (8.21M) is bullish; calls sold (3.87M) is bearish. Net bullish, and the bar now says so.
  assert.equal(s.bullish, 8_210_779);
  assert.equal(s.bearish, 3_871_478);
  assert.ok(s.bullishPct! > 60 && s.bullishPct! < 72, `expected a clearly bullish bar, got ${s.bullishPct}`);
});

test("the other shipped failure: a width style above 100%", () => {
  // 10:40 ET: calls bought, puts sold — both bullish, and they CANCEL in a sum.
  const call = 14_033_233.5, put = -14_389_606;
  assert.equal(oldCallPct(call, put), 50, "sum went negative, so the old bar flattened");

  // A case where the old form overflowed instead.
  assert.ok(oldCallPct(50_000_000, -30_000_000) > 100, "the old form could exceed a 100% width");

  const s = tideSplit(call, put);
  assert.equal(s.bearish, 0, "nothing here is bearish — calls bought and puts sold both lean long");
  assert.equal(s.bullishPct, 100);
});

test("the split is always a real proportion, whatever the signs", () => {
  for (const [call, put] of [
    [10, 10], [-10, -10], [10, -10], [-10, 10],
    [0, -5], [5, 0], [-1e9, 1e9], [1e9, -1e9],
  ] as Array<[number, number]>) {
    const s = tideSplit(call, put);
    assert.ok(s.bullish >= 0 && s.bearish >= 0, `components must be non-negative for ${call}/${put}`);
    if (s.bullishPct != null) {
      assert.ok(s.bullishPct >= 0 && s.bullishPct <= 100, `${call}/${put} produced ${s.bullishPct}%`);
    }
  }
});

test("the bar and the bias pill agree BY CONSTRUCTION, not by coincidence", () => {
  // The pill reads `net = net_call - net_put > 0`. The bar reads `bullish > bearish`. These must be
  // the same predicate, or one component contradicts the other on screen — which is the defect.
  for (const [call, put] of [
    [-3_871_478, -8_210_779], [14_033_233.5, -14_389_606], [-16_827_310.5, -134_715_973.5],
    [5, 3], [3, 5], [-5, -3], [-3, -5], [0, -1], [0, 1], [1, 0], [-1, 0],
  ] as Array<[number, number]>) {
    const s = tideSplit(call, put);
    const pillBullish = call - put > 0;
    const barBullish = s.bullish > s.bearish;
    assert.equal(barBullish, pillBullish, `disagreement at call=${call} put=${put}`);
  }
});

test("no flow at all reports null, never a 50/50 bar implying measured balance", () => {
  const s = tideSplit(0, 0);
  assert.equal(s.bullishPct, null);
  assert.equal(s.unavailable, false, "zero flow WAS measured — it is not missing data");
});

test("absent inputs are unavailable, not zero", () => {
  // `Number(null)` is 0, so a naive guard would render a tide with no data as perfectly balanced.
  for (const [c, p] of [[null, 5], [5, null], [undefined, undefined], [Number.NaN, 5], ["x", 5]] as Array<[unknown, unknown]>) {
    const s = tideSplit(c as number, p as number);
    assert.equal(s.unavailable, true, `${String(c)}/${String(p)} must be unavailable`);
    assert.equal(s.bullishPct, null);
  }
});

test("netPremiumSense states the sense instead of hiding a sold side", () => {
  assert.equal(netPremiumSense(5), "bought");
  assert.equal(netPremiumSense(-5), "sold");
  assert.equal(netPremiumSense(0), "flat");
  assert.equal(netPremiumSense(null), null);
  assert.equal(netPremiumSense(Number.NaN), null);
  // The measured case: net put premium was negative on 81 of 81 snapshots, so a `> 0` gate hid it
  // on every single one.
  assert.equal(netPremiumSense(-134_715_973.5), "sold");
});
