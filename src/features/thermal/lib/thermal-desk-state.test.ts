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
  keyLevelsKicker,
  keyLevelsFootnote,
} from "./thermal-desk-state.ts";

test("THERMAL_COMPARE_TICKERS matches the Indices preset (legacy export)", () => {
  assert.deepEqual([...THERMAL_COMPARE_TICKERS], ["SPY", "SPX", "QQQ"]);
});

test("parseThermalTicker / lens / url state", () => {
  assert.equal(parseThermalTicker("spy"), "SPY");
  assert.equal(parseThermalTicker("!!!"), null);
  assert.equal(parseThermalLens("VEX"), "vex");
  assert.equal(parseThermalLens("foo"), null);
  const p = new URLSearchParams("ticker=QQQ&lens=dex&compare=1&compareSet=semis");
  assert.deepEqual(parseThermalUrlState(p), {
    ticker: "QQQ",
    lens: "dex",
    compare: true,
    compareSet: "semis",
  });
});

test("buildThermalUrlSearch writes ticker/lens/compare/compareSet and drops compare when off", () => {
  const base = new URLSearchParams("foo=1");
  const on = buildThermalUrlSearch(base, {
    ticker: "spx",
    lens: "gex",
    compare: true,
    compareSet: "ai",
  });
  assert.equal(new URLSearchParams(on).get("ticker"), "SPX");
  assert.equal(new URLSearchParams(on).get("compare"), "1");
  assert.equal(new URLSearchParams(on).get("compareSet"), "ai");
  assert.equal(new URLSearchParams(on).get("foo"), "1");
  const off = buildThermalUrlSearch(base, { ticker: "SPY", lens: "vex", compare: false });
  assert.equal(new URLSearchParams(off).has("compare"), false);
  assert.equal(new URLSearchParams(off).has("compareSet"), false);
});

test("isUsableGexHeatmapPayload / shouldForceMatrixRefresh", () => {
  assert.equal(isThermalCompareTicker("SPY"), true);
  assert.equal(isThermalCompareTicker("QQQ"), true);
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
    shouldForceMatrixRefresh({ asofMs: now - 6_000, nowMs: now, lastForceAtMs: 0 }),
    true,
    "asof >5s forces"
  );
  assert.equal(
    shouldForceMatrixRefresh({ asofMs: now - 6_000, nowMs: now, lastForceAtMs: now - 2_000 }),
    false,
    "throttle blocks force"
  );
  assert.equal(
    shouldForceMatrixRefresh({ asofMs: now - 120_000, nowMs: now, lastForceAtMs: 0, sessionLive: false }),
    false,
    "off-hours: never force (RTH-only policy)"
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

test("the cross-check layer never shows a member our vendor's initials", () => {
  const now = Date.parse("2026-08-12T14:00:00Z");
  const on = thermalLayerFreshness({
    nowMs: now,
    matrixAsof: new Date(now - 2_000).toISOString(),
    hasOverlays: true,
    overlaysAt: new Date(now - 5_000).toISOString(),
    crossValPresent: true,
    crossValUwAsof: new Date(now - 5_000).toISOString(),
  });
  const off = thermalLayerFreshness({
    nowMs: now,
    matrixAsof: new Date(now - 2_000).toISOString(),
    hasOverlays: false,
    crossValPresent: false,
  });
  // "UW" is Unusual Whales — an upstream vendor, not a concept the desk teaches. The chip used to
  // read "UW check off", which names a supplier the member has no relationship with and leaves the
  // actual meaning (a second source is/isn't confirming these walls) entirely unstated.
  for (const layer of [on.crossVal, off.crossVal]) {
    assert.doesNotMatch(layer.label, /\bUW\b/i);
    assert.doesNotMatch(layer.title, /\bUW\b/i);
    assert.match(layer.label, /cross-check/i);
    // The label alone cannot carry the explanation, so the hover copy must actually say it.
    assert.match(layer.title, /second/i);
  }
  assert.doesNotMatch(honestLevelEmpty("cross_val").help, /\bUW\b/i);
});

test("wallScopeLabel and honest empties never invent numbers", () => {
  assert.match(wallScopeLabel(["2026-07-28", "2026-07-29"]).short, /2 near-term/);
  assert.equal(honestLevelEmpty("flip").value, "—");
  assert.match(honestLevelEmpty("cross_val").help, /offline/i);
});

test("keyLevelsKicker and footnote disclose near-term scope", () => {
  assert.equal(keyLevelsKicker("GEX", ["2026-07-28", "2026-07-29"]), "GEX · near-term (2)");
  assert.equal(keyLevelsKicker("VEX", null), "VEX · near-term");
  assert.match(keyLevelsFootnote("Aug 4"), /near-term expiries/i);
  assert.match(keyLevelsFootnote("Aug 4"), /Aug 4 OI only/);
  assert.match(keyLevelsFootnote(), /front\/nearest expiry/i);
});

test("keyLevelsKicker names the single scoped expiry instead of calling it near-term", () => {
  // The whole point of the scoped row: when ONE expiry drives every tile, the kicker must not
  // keep claiming a near-term blend — that is the mixed-scope claim the panel was rebuilt to end.
  assert.equal(
    keyLevelsKicker("GEX", ["2026-08-14", "2026-08-15"], { expiryLabel: "Aug 14" }),
    "GEX · Aug 14"
  );
  assert.equal(
    keyLevelsKicker("GEX", ["2026-08-14"], { expiryLabel: "Aug 14", nearSpotGammaShare: 0.624 }),
    "GEX · Aug 14 · 62% of near-spot γ"
  );
  // A share we don't have (or a zero one) is omitted rather than printed as "0%" — an unknown
  // pin contest and a genuinely empty one are different claims and neither is "0% of the gamma".
  assert.equal(
    keyLevelsKicker("GEX", null, { expiryLabel: "Aug 14", nearSpotGammaShare: null }),
    "GEX · Aug 14"
  );
  assert.equal(
    keyLevelsKicker("GEX", null, { expiryLabel: "Aug 14", nearSpotGammaShare: Number.NaN }),
    "GEX · Aug 14"
  );
});

test("keyLevelsFootnote tells the truth about what a single-expiry scope did and did not rescope", () => {
  const f = keyLevelsFootnote("Aug 14", "Aug 14");
  assert.match(f, /Flip, walls, net GEX, and max pain are Aug 14 only/);
  // The King node is NOT rescoped — it still marks the dominant node across the near-term book.
  // Saying nothing here would let a reader assume the entire row moved with the selector.
  assert.match(f, /King node still marks the dominant near-term node/);
  assert.doesNotMatch(f, /sum near-term expiries/);
});
