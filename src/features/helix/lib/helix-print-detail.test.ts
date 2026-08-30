import { test } from "node:test";
import assert from "node:assert/strict";
import { contractSizeRounded } from "./helix-contract-size";
import {
  estNotional,
  aggressorRead,
  gexProximityLabel,
  printBias,
} from "./helix-print-detail";

test("estNotional = est contracts × 100 × strike (= premium × strike / fill)", () => {
  // 100 contracts of the 600 strike → 100 × 100 × 600 = $6,000,000
  assert.equal(estNotional(600, 50_000, 5), 6_000_000);
  // identity check against the closed form premium × strike / fill
  const premium = 12_500,
    fill = 2.5,
    strike = 430;
  const size = contractSizeRounded(premium, fill)!;
  assert.equal(estNotional(strike, premium, fill), size * 100 * strike);
});

test("estNotional returns null without a real strike or size", () => {
  assert.equal(estNotional(0, 50_000, 5), null);
  assert.equal(estNotional(600, undefined, 5), null);
});

test("aggressorRead splits ask-side into bought / sold / midpoint", () => {
  assert.deepEqual(aggressorRead(85), { label: "At ask · 85% bought", tone: "bull" });
  assert.deepEqual(aggressorRead(15), { label: "At bid · 85% sold", tone: "bear" });
  assert.deepEqual(aggressorRead(50), { label: "Midpoint · 50% ask", tone: "neutral" });
  assert.equal(aggressorRead(undefined), null);
  assert.equal(aggressorRead(Number.NaN), null);
});

test("gexProximityLabel maps only the known server enum, else null", () => {
  assert.equal(gexProximityLabel("at_gamma_flip"), "At gamma flip");
  assert.equal(gexProximityLabel("at_call_wall"), "At call wall");
  assert.equal(gexProximityLabel("near_put_wall"), "Near put wall");
  assert.equal(gexProximityLabel("something_else"), null);
  assert.equal(gexProximityLabel(undefined), null);
});

test("printBias combines side + aggressor (call bought = bullish, put bought = bearish)", () => {
  assert.equal(printBias({ option_type: "CALL", ask_pct: 80 }), "bullish");
  assert.equal(printBias({ option_type: "CALL", ask_pct: 20 }), "bearish");
  assert.equal(printBias({ option_type: "PUT", ask_pct: 80 }), "bearish");
  assert.equal(printBias({ option_type: "PUT", ask_pct: 20 }), "bullish");
  assert.equal(printBias({ option_type: "CALL", ask_pct: 50 }), "neutral");
  assert.equal(printBias({ option_type: "CALL", ask_pct: undefined }), "neutral");
});

test("printBias returns neutral for a typeless/malformed print instead of fabricating a PUT read", () => {
  // A print with no readable option_type (HELIX-MAP §6) previously fell through the `isCall` false
  // branch straight into the PUT logic and invented a bullish/bearish label. Mirrors the
  // `undetermined` guard `flowDirection` already applies for the exact same input shape.
  assert.equal(printBias({ option_type: null, ask_pct: 80 }), "neutral");
  assert.equal(printBias({ option_type: undefined, ask_pct: 20 }), "neutral");
  assert.equal(printBias({ option_type: "", ask_pct: 20 }), "neutral");
  assert.equal(printBias({ option_type: "WARRANT", ask_pct: 90 }), "neutral");
});
