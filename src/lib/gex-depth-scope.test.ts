import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  depthScopeKey,
  depthScopeUsesNearTermFallback,
  resolveDepthForScope,
} from "./gex-depth-scope";
import type { GexDepthBlock } from "@/lib/providers/polygon-options-gex";

function ladder(notional: number): GexDepthBlock {
  return {
    levels: [{ price: 100, notional, cumulative: notional, direction: "buy", gamma: 1 }],
    max_abs_notional: Math.abs(notional),
    crossing: null,
    peak_buy: null,
    peak_sell: null,
    range_pct: 0.08,
    step_pct: 0.005,
    calibration_factor: 1,
    contracts_used: 10,
  };
}

describe("gex-depth-scope", () => {
  it("depthScopeKey joins multi-expiry scopes", () => {
    assert.equal(depthScopeKey(["2026-08-20", "2026-08-14"]), "2026-08-14|2026-08-20");
    assert.equal(depthScopeKey(["2026-08-14"]), "2026-08-14");
    assert.equal(depthScopeKey(null), null);
  });

  it("resolveDepthForScope returns scoped ladder when present", () => {
    const near = ladder(1);
    const aug14 = ladder(99);
    const out = resolveDepthForScope(near, { "2026-08-14": aug14 }, ["2026-08-14"]);
    assert.equal(out?.levels[0]?.notional, 99);
  });

  it("resolveDepthForScope falls back to near-term aggregate", () => {
    const near = ladder(1);
    const out = resolveDepthForScope(near, {}, ["2026-08-14"]);
    assert.equal(out?.levels[0]?.notional, 1);
  });

  it("depthScopeUsesNearTermFallback is true only when scoped ladder missing", () => {
    assert.equal(depthScopeUsesNearTermFallback({}, ["2026-08-14"]), true);
    assert.equal(
      depthScopeUsesNearTermFallback({ "2026-08-14": ladder(1) }, ["2026-08-14"]),
      false,
    );
    assert.equal(depthScopeUsesNearTermFallback({}, null), false);
  });
});
