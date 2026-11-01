import { test } from "node:test";
import assert from "node:assert/strict";
import { strikeGexFromTotals, topGexPinStrikes } from "./strike-gex-lookup";

test("strikeGexFromTotals: resolves integer and fractional strike keys", () => {
  const totals = { "575": 12_000_000, "580.5": -8_000_000 };
  assert.equal(strikeGexFromTotals(totals, 575), 12_000_000);
  assert.equal(strikeGexFromTotals(totals, 580.5), -8_000_000);
  assert.equal(strikeGexFromTotals(totals, 999), null);
});

test("topGexPinStrikes: returns largest |GEX| strikes", () => {
  const totals = { "100": 1_000, "105": -9_000_000, "110": 500_000 };
  assert.deepEqual(topGexPinStrikes(totals, 2), [105, 110]);
});

// Root cause: `rows.sort((a, b) => b.abs - a.abs)` has no tie-break, so on an EXACT |GEX| tie,
// Array.prototype.sort's stability means the winner is whichever strike happened to come first
// in `Object.entries(totals)` — insertion order, not any property of the gamma data itself.
// Integer-keyed strikes always enumerate in ascending numeric order regardless of insertion
// order (the ECMAScript integer-index-key rule), which is why the EXHAUSTED-looking sibling test
// above never caught this: it only ever used integer strikes. Half-strikes (SPY/QQQ/SPX-style
// "100.5") are NOT integer-index keys, so they keep true insertion order — and this repo builds
// `strike_totals` two different ways with two different insertion orders for the SAME strikes:
// `polygon-options-gex.ts`'s primary chain path always inserts strike-DESCENDING
// (`strikes.sort((a,b)=>b-a)` then iterates), while its UW-spot-exposures FALLBACK path
// (`buildGexHeatmapFromUwStrikeExposures`, used whenever the Polygon chain comes up empty)
// inserts in whatever order the upstream UW rows array returns them — unsorted. Both feed the
// exact same `VectorPickEnrichment.strikeTotals` → `topGexPinStrikes` call in
// vector-play-candidates.ts that decides the "Strike sits on a top net-gamma pin" scoring bonus.
// So the SAME two tied half-strikes can rank in opposite order purely because one session's
// heatmap came from Polygon and another's came from the UW fallback — never because the gamma
// changed. Reproduced directly here with two totals objects describing the IDENTICAL tied book,
// built in opposite insertion order (mirroring the two real upstream orderings above).
test("topGexPinStrikes: exact-|GEX| tie is deterministic regardless of object insertion order", () => {
  const descendingInsertion = { "110.5": 1_000_000, "105.5": -2_000_000, "100.5": 2_000_000 };
  const ascendingInsertion = { "100.5": 2_000_000, "105.5": -2_000_000, "110.5": 1_000_000 };
  const fromDescending = topGexPinStrikes(descendingInsertion, 1);
  const fromAscending = topGexPinStrikes(ascendingInsertion, 1);
  assert.deepEqual(fromDescending, fromAscending);
  // Pin down the actual tie-break rule (lower strike wins), matching the established convention
  // in gex-cross-validation-core.ts's kingFromStrikeTotals/wallsFromStrikeTotals.
  assert.deepEqual(fromDescending, [100.5]);
});
