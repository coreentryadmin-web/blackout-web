import test from "node:test";
import assert from "node:assert/strict";
import { defaultVectorDteHorizon } from "./vector-ticker";
import { VECTOR_DEFAULT_DTE_HORIZON } from "./vector-dte-horizon";

test("defaultVectorDteHorizon: oracle indices open on 0DTE, single names on weekly", () => {
  assert.equal(defaultVectorDteHorizon("SPX"), "0dte");
  assert.equal(defaultVectorDteHorizon("SPY"), "0dte");
  assert.equal(defaultVectorDteHorizon("QQQ"), "0dte");
  assert.equal(defaultVectorDteHorizon("NVDA"), "weekly");
  assert.equal(defaultVectorDteHorizon("TSLA"), "weekly");
  assert.equal(defaultVectorDteHorizon("META"), "weekly");
});

test("VECTOR_DEFAULT_DTE_HORIZON is weekly (not blended all) for standalone desk fallback", () => {
  assert.equal(VECTOR_DEFAULT_DTE_HORIZON, "weekly");
});
