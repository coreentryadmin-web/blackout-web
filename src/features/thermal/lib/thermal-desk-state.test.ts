import assert from "node:assert/strict";
import test from "node:test";
import {
  THERMAL_COMPARE_TICKERS,
  buildThermalUrlSearch,
  honestLevelEmpty,
  isThermalCompareTicker,
  isUsableGexHeatmapPayload,
  parseThermalLens,
  parseThermalTicker,
  parseThermalUrlState,
  shouldForceMatrixRefresh,
  thermalLayerFreshness,
  wallScopeLabel,
} from "./thermal-desk-state.ts";

test("THERMAL_COMPARE_TICKERS is SPY / SPX / QQQ", () => {
  assert.deepEqual([...THERMAL_COMPARE_TICKERS], ["SPY", "SPX", "QQQ"]);
});

test("parseThermalTicker / lens / url state", () => {
  assert.equal(parseThermalTicker("spy"), "SPY");
  assert.equal(parseThermalTicker("!!!"), null);
  assert.equal(parseThermalLens("VEX"), "vex");
  assert.equal(parseThermalLens("foo"), null);
  const p = new URLSearchParams("ticker=QQQ&lens=dex&compare=1");
  assert.deepEqual(parseThermalUrlState(p), { ticker: "QQQ", lens: "dex", compare: true });
});

test("buildThermalUrlSearch writes ticker/lens/compare and drops compare when off", () => {
  const base = new URLSearchParams("foo=1");
  const on = buildThermalUrlSearch(base, { ticker: "spx", lens: "gex", compare: true });
  assert.equal(new URLSearchParams(on).get("ticker"), "SPX");
  assert.equal(new URLSearchParams(on).get("compare"), "1");
  assert.equal(new URLSearchParams(on).get("foo"), "1");
  const off = buildThermalUrlSearch(base, { ticker: "SPY", lens: "vex", compare: false });
  assert.equal(new URLSearchParams(off).has("compare"), false);
});

test("isUsableGexHeatmapPayload / shouldForceMatrixRefresh", () => {
  assert.equal(isThermalCompareTicker("SPY"), true);
  assert.equal(isThermalCompareTicker("NVDA"), false);
  assert.equal(isUsableGexHeatmapPayload(null), false);
  assert.equal(isUsableGexHeatmapPayload({ available: true, strikes: [], expiries: ["2026-07-29"] }), false);
  assert.equal(
    isUsableGexHeatmapPayload({ available: true, spot: 0, strikes: [100], expiries: ["2026-07-29"] }),
    false,
    "spot 0 must not count as usable"
  );
  assert.equal(
    isUsableGexHeatmapPayload({ available: true, spot: 741.5, strikes: [100], expiries: ["2026-07-29"] }),
    true
  );
  const now = Date.parse("2026-07-29T18:00:00Z");
  assert.equal(
    shouldForceMatrixRefresh({ asofMs: now - 3_000, nowMs: now, lastForceAtMs: 0 }),
    false,
    "fresh asof must not force"
  );
  assert.equal(
    shouldForceMatrixRefresh({ asofMs: now - 10_000, nowMs: now, lastForceAtMs: 0 }),
    true,
    "asof >8s forces"
  );
  assert.equal(
    shouldForceMatrixRefresh({ asofMs: now - 10_000, nowMs: now, lastForceAtMs: now - 2_000 }),
    false,
    "throttle blocks force"
  );
});

test("thermalLayerFreshness: matrix live / stale / overlays off / UW off", () => {
  const now = Date.parse("2026-07-28T18:00:00.000Z");
  const live = thermalLayerFreshness({
    nowMs: now,
    matrixAsof: new Date(now - 4_000).toISOString(),
    overlaysAt: null,
    hasOverlays: false,
    crossValPresent: false,
  });
  assert.equal(live.matrix.status, "live");
  assert.equal(live.overlays.status, "offline");
  assert.equal(live.crossVal.status, "offline");

  const stale = thermalLayerFreshness({
    nowMs: now,
    matrixAsof: new Date(now - 20_000).toISOString(),
    overlaysAt: new Date(now - 10_000).toISOString(),
    hasOverlays: true,
    crossValPresent: true,
    crossValUwAsof: new Date(now - 5_000).toISOString(),
  });
  assert.equal(stale.matrix.status, "stale");
  assert.equal(stale.overlays.status, "live");
  assert.equal(stale.crossVal.status, "live");
});

test("wallScopeLabel and honest empties never invent numbers", () => {
  assert.match(wallScopeLabel(["2026-07-28", "2026-07-29"]).short, /2 near-term/);
  assert.equal(honestLevelEmpty("flip").value, "—");
  assert.match(honestLevelEmpty("cross_val").help, /offline/i);
});
