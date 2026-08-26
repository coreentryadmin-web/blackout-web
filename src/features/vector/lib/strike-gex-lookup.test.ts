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
