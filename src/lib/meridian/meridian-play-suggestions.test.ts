import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { suggestedPlayFromThermal } from "./meridian-play-suggestions";
import type { MeridianThermalTape } from "@/features/meridian/lib/meridian-types";

describe("suggested plays from thermal data", () => {
  const baseThermal: MeridianThermalTape = {
    available: true,
    spot: 500,
    call_wall: 505,
    put_wall: 495,
    max_pain: 502,
    gex_king_strike: 500,
    net_gex_label: "short",
    gamma_regime: "gamma flip",
    level_scopes: {},
  };

  test("returns null when thermal is unavailable", () => {
    const play = suggestedPlayFromThermal(null, 2.5, "2026-09-05");
    assert.equal(play, null);
  });

  test("returns null when expected move is unavailable", () => {
    const play = suggestedPlayFromThermal(baseThermal, null, "2026-09-05");
    assert.equal(play, null);
  });

  test("returns null when earnings date is unavailable", () => {
    const play = suggestedPlayFromThermal(baseThermal, 2.5, null);
    assert.equal(play, null);
  });

  test("returns null when walls are missing", () => {
    const thermal: MeridianThermalTape = { ...baseThermal, call_wall: null };
    const play = suggestedPlayFromThermal(thermal, 2.5, "2026-09-05");
    assert.equal(play, null);
  });

  test("generates play with call-wall-heavy regime (puts primary)", () => {
    // call_wall (505) > put_wall (495) → dealer short call gamma → puts primary
    const play = suggestedPlayFromThermal(baseThermal, 2.5, "2026-09-03"); // Wednesday
    assert.ok(play);
    assert.equal(play.primary_side, "P");
    assert.equal(play.hedge_side, "C");
    assert.equal(play.primary_strike, 495);
    assert.equal(play.hedge_strike, 505);
    assert.equal(play.thesis, "GEX walls favor puts");
  });

  test("generates play with put-wall-heavy regime (calls primary)", () => {
    // put_wall (510) > call_wall (490) → dealer short put gamma → calls primary
    const thermal: MeridianThermalTape = {
      ...baseThermal,
      call_wall: 490,
      put_wall: 510,
    };
    const play = suggestedPlayFromThermal(thermal, 2.5, "2026-09-03");
    assert.ok(play);
    assert.equal(play.primary_side, "C");
    assert.equal(play.hedge_side, "P");
    assert.equal(play.primary_strike, 490);
    assert.equal(play.hedge_strike, 510);
    assert.equal(play.thesis, "GEX walls favor calls");
  });

  test("calculates positioning_pct from wall ratio", () => {
    // call_wall=505, put_wall=495 → 505/(505+495) = 0.505 = 51%
    const play = suggestedPlayFromThermal(baseThermal, 2.5, "2026-09-03");
    assert.ok(play);
    assert.equal(play.positioning_pct, 51);
  });

  test("selects expiry as next Friday", () => {
    // 2026-09-03 is Wednesday → next Friday is 2026-09-05
    const play = suggestedPlayFromThermal(baseThermal, 2.5, "2026-09-03");
    assert.ok(play);
    assert.equal(play.expiry, "2026-09-05");
  });

  test("labels regime as 'balanced' when walls are within 5% of each other", () => {
    // Walls 50 and 48 → ratio 1.04, within 5% of 1.0
    const thermal: MeridianThermalTape = {
      ...baseThermal,
      call_wall: 502.5,
      put_wall: 497.5,
    };
    const play = suggestedPlayFromThermal(thermal, 2.5, "2026-09-03");
    assert.ok(play);
    assert.equal(play.thesis, "Walls balanced");
  });
});
