import test from "node:test";
import assert from "node:assert/strict";
import { defaultVectorDteHorizon, defaultVectorNodeDensity, defaultVectorDeskOpenProps, VECTOR_ORACLE_DEFAULT_NODE_DENSITY } from "./vector-ticker";
import { VECTOR_DEFAULT_DTE_HORIZON } from "./vector-dte-horizon";

test("defaultVectorDteHorizon: intraday desk opens on 0DTE for every symbol", () => {
  assert.equal(defaultVectorDteHorizon("SPX"), "0dte");
  assert.equal(defaultVectorDteHorizon("SPY"), "0dte");
  assert.equal(defaultVectorDteHorizon("QQQ"), "0dte");
  assert.equal(defaultVectorDteHorizon("NVDA"), "0dte");
  assert.equal(defaultVectorDteHorizon("TSLA"), "0dte");
  assert.equal(defaultVectorDteHorizon("META"), "0dte");
});

test("VECTOR_DEFAULT_DTE_HORIZON is 0DTE for standalone desk fallback", () => {
  assert.equal(VECTOR_DEFAULT_DTE_HORIZON, "0dte");
});

test("defaultVectorDeskOpenProps: session · 3m · oracle 0DTE · 20-row nodes", () => {
  const open = defaultVectorDeskOpenProps("SPX");
  assert.equal(open.defaultDteHorizon, "0dte");
  assert.equal(open.defaultChartViewport, "session");
  assert.equal(open.defaultTimeframe, 3);
  assert.equal(open.defaultNodeDensity, 20);
  const nvda = defaultVectorDeskOpenProps("NVDA");
  assert.equal(nvda.defaultDteHorizon, "0dte");
  assert.equal(nvda.defaultNodeDensity, "auto");
});

test("defaultVectorNodeDensity: oracle tickers open at 20 rows, singles stay auto", () => {
  assert.equal(defaultVectorNodeDensity("SPX"), 20);
  assert.equal(defaultVectorNodeDensity("SPY"), 20);
  assert.equal(defaultVectorNodeDensity("QQQ"), 20);
  assert.equal(defaultVectorNodeDensity("NVDA"), "auto");
  assert.equal(VECTOR_ORACLE_DEFAULT_NODE_DENSITY, 20);
});
