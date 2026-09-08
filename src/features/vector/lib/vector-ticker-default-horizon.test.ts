import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultVectorDteHorizon,
  defaultVectorNodeDensity,
  defaultVectorDeskOpenProps,
  VECTOR_ORACLE_DEFAULT_NODE_DENSITY,
  VECTOR_DEFAULT_OPEN_NODE_DENSITY,
} from "./vector-ticker";
import { VECTOR_DEFAULT_DTE_HORIZON } from "./vector-dte-horizon";
import { VECTOR_DEFAULT_NODE_DENSITY } from "./vector-node-density";

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

test("defaultVectorDeskOpenProps: session overview · 3m · 0DTE · index tickers on AUTO, single names on 20-row nodes", () => {
  // Regression (2026-09-07): index tickers must open on "auto" so VectorChart's NODES-hydration
  // effect (which only fires when the desk-open default is the "auto" sentinel) actually loads the
  // timeframe AUTO ladder (8/11/13/16) and any member-saved NODES pick — see
  // defaultVectorNodeDensity's own doc comment. A fixed 20 for every ticker silently disabled that
  // hydration for index tickers too, not just the single names the 20-row fix targeted.
  const open = defaultVectorDeskOpenProps("SPX");
  assert.equal(open.defaultDteHorizon, "0dte");
  assert.equal(open.defaultChartViewport, "session");
  assert.equal(open.defaultTimeframe, 3);
  assert.equal(open.defaultNodeDensity, VECTOR_DEFAULT_NODE_DENSITY);
  const nvda = defaultVectorDeskOpenProps("NVDA");
  assert.equal(nvda.defaultDteHorizon, "0dte");
  assert.equal(nvda.defaultChartViewport, "session");
  assert.equal(nvda.defaultNodeDensity, 20);
});

test("defaultVectorNodeDensity: index tickers open on AUTO, single names keep the fixed 20-row showcase density", () => {
  assert.equal(defaultVectorNodeDensity("SPX"), VECTOR_DEFAULT_NODE_DENSITY);
  assert.equal(defaultVectorNodeDensity("NDX"), VECTOR_DEFAULT_NODE_DENSITY);
  // SPY/QQQ are ETFs (optionable symbols), not index tickers — VECTOR_INDEX_TICKERS covers only
  // SPX/NDX/RUT/DJI/VIX — so they keep the single-name 20-row default, unaffected by this fix.
  assert.equal(defaultVectorNodeDensity("SPY"), 20);
  assert.equal(defaultVectorNodeDensity("QQQ"), 20);
  assert.equal(defaultVectorNodeDensity("NVDA"), 20);
  assert.equal(VECTOR_ORACLE_DEFAULT_NODE_DENSITY, 20);
  assert.equal(VECTOR_DEFAULT_OPEN_NODE_DENSITY, 20);
});
