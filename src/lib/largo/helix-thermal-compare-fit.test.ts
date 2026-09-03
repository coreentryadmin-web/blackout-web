import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHelixThermalCompareForModel } from "@/lib/largo/helix-thermal-compare-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

test("fitHelixThermalCompareForModel trims long prose", () => {
  const raw = {
    kind: "helix_thermal",
    ticker: "SPX",
    helix: { available: true, bias: "bullish", summary: "s".repeat(500) },
    thermal: {
      available: true,
      bias: "mixed",
      summary: "g".repeat(500),
      gamma_regime: "r".repeat(800),
    },
    conflict: false,
    conflict_note: "n".repeat(400),
    regime_interaction: { read: "i".repeat(600), flow_bias: "bullish", volatility_regime: "amplifying" },
  };
  const { fitted } = fitHelixThermalCompareForModel(raw);
  assert.ok(((fitted.thermal as { gamma_regime?: string }).gamma_regime ?? "").length <= 320);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});
