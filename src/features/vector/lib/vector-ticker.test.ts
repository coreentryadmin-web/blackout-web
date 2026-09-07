import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeVectorTicker,
  isVectorTickerAllowed,
  vectorPolygonMinuteSymbol,
  isVectorIndexTicker,
  vectorHasWsOracle,
  defaultVectorNodeDensity,
} from "./vector-ticker";
import { VECTOR_DEFAULT_NODE_DENSITY } from "./vector-node-density";

test("normalizeVectorTicker defaults and validates", () => {
  assert.equal(normalizeVectorTicker(null), "SPX");
  assert.equal(normalizeVectorTicker(" nvda "), "NVDA");
  assert.equal(normalizeVectorTicker("!!!"), "SPX");
});

test("vectorPolygonMinuteSymbol maps indices", () => {
  assert.equal(vectorPolygonMinuteSymbol("SPX"), "I:SPX");
  assert.equal(vectorPolygonMinuteSymbol("NVDA"), "NVDA");
});

test("defaultVectorNodeDensity: index tickers default to AUTO, not a fixed count", () => {
  // Regression (2026-09-07, member-reported): VectorChart's NODES-hydration effect
  // (`if (defaultNodeDensity !== VECTOR_DEFAULT_NODE_DENSITY) return;`) only loads the
  // member's saved density pick — or lets the timeframe-driven AUTO 8/11/13/16 ladder
  // apply at all — when the desk-open default is the "auto" sentinel. Once
  // defaultVectorNodeDensity started returning a fixed 20 for every ticker (to fix a
  // real NVDA single-name density complaint), that guard silently disabled hydration
  // for EVERY ticker including SPX, so SPX permanently opened at 20 rows/side
  // regardless of timeframe instead of the Sep-3-reference AUTO ladder — thinning the
  // thick merged ribbons into visibly separate dotted circles.
  assert.equal(
    defaultVectorNodeDensity("SPX"),
    VECTOR_DEFAULT_NODE_DENSITY,
    "SPX must open on AUTO so the timeframe ladder (8/11/13/16) and the member's saved NODES pick both apply"
  );
  assert.equal(defaultVectorNodeDensity("NDX"), VECTOR_DEFAULT_NODE_DENSITY);
  // Single names keep the fixed 20-row showcase density (2026-08-19 decision, AUTO
  // self-limited NVDA to ~7 rows) — unaffected by this fix.
  assert.equal(defaultVectorNodeDensity("NVDA"), 20);
  assert.equal(defaultVectorNodeDensity("AAPL"), 20);
});

test("oracle and index helpers", () => {
  assert.equal(isVectorIndexTicker("SPX"), true);
  assert.equal(isVectorIndexTicker("AAPL"), false);
  // vectorHasWsOracle checks the STATIC oracle set (SPX/SPY/QQQ);
  // dynamic WS subscription via hasLiveGexStrikeExpiry covers any ticker at runtime
  assert.equal(vectorHasWsOracle("SPX"), true);
  assert.equal(vectorHasWsOracle("NVDA"), false);
});

test("isVectorTickerAllowed: accepts any well-formed symbol (not just the preset universe)", () => {
  // Preset + arbitrary optionable symbols are all loadable now.
  for (const t of ["SPX", "AAPL", "MSTR", "SOFI", "BRK.B", "I:SPX", "spy"]) {
    assert.equal(isVectorTickerAllowed(t), true, `${t} should be allowed`);
  }
});

test("isVectorTickerAllowed: rejects junk/oversized/empty before it reaches providers", () => {
  for (const t of ["", "   ", "TOOLONGSYM", "A B", "<script>", "AA;DROP", null, undefined]) {
    assert.equal(isVectorTickerAllowed(t), false, `${JSON.stringify(t)} should be rejected`);
  }
});
