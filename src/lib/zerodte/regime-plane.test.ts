import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRegimePlaneSnapshot,
  gexQualityDegradedForExit,
  inferRegimeGexQuality,
  REGIME_BLIND_FAIL_CLOSED,
} from "./regime-plane";

test("buildRegimePlaneSnapshot — high confidence when inputs readable", () => {
  const snap = buildRegimePlaneSnapshot({
    vixDayOpen: 16.2,
    vixUnavailable: false,
    macroUnavailable: false,
    haltFeedStale: false,
    gexQuality: "polygon_chain",
  });
  assert.equal(snap.confidence, "high");
  assert.equal(snap.blockFreshCommits, false);
});

test("buildRegimePlaneSnapshot — blind + block when halt feed stale", () => {
  const snap = buildRegimePlaneSnapshot({
    vixUnavailable: false,
    macroUnavailable: false,
    haltFeedStale: true,
    gexQuality: "polygon_chain",
  });
  assert.equal(snap.confidence, "blind");
  assert.equal(snap.blockFreshCommits, REGIME_BLIND_FAIL_CLOSED);
  assert.ok(snap.humanReason?.includes("halt"));
});

test("buildRegimePlaneSnapshot — VIX unavailable is degraded, not universal block (G-4 owns narrowing)", () => {
  const snap = buildRegimePlaneSnapshot({
    vixUnavailable: true,
    macroUnavailable: false,
    haltFeedStale: false,
    gexQuality: "polygon_chain",
  });
  assert.equal(snap.confidence, "degraded");
  assert.equal(snap.blockFreshCommits, false);
  assert.equal(snap.vixUnavailable, true);
});

test("buildRegimePlaneSnapshot — degraded (not blind) on UW GEX fallback only", () => {
  const snap = buildRegimePlaneSnapshot({
    vixDayOpen: 15,
    vixUnavailable: false,
    macroUnavailable: false,
    haltFeedStale: false,
    gexQuality: "uw_strike_fallback",
  });
  assert.equal(snap.confidence, "degraded");
  assert.equal(snap.blockFreshCommits, false);
});

test("inferRegimeGexQuality — polygon circuit → uw fallback", () => {
  assert.equal(inferRegimeGexQuality({ polygonCircuitOpen: true }), "uw_strike_fallback");
  assert.equal(inferRegimeGexQuality({ polygonCircuitOpen: false }), "polygon_chain");
});

test("gexQualityDegradedForExit — only polygon_chain is trusted for gex-walls veto", () => {
  assert.equal(gexQualityDegradedForExit("polygon_chain"), false);
  assert.equal(gexQualityDegradedForExit("uw_strike_fallback"), true);
  assert.equal(gexQualityDegradedForExit("empty"), true);
  assert.equal(gexQualityDegradedForExit(undefined), false);
});
