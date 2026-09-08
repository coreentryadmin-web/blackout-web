import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePositioningForSwing } from "./positioning";

test("scorePositioningForSwing: admits long into positive gamma below call wall", () => {
  const hit = scorePositioningForSwing({
    ticker: "NVDA",
    spot: 140,
    change_pct: 1.2,
    asof: "2026-09-04T20:00:00.000Z",
    flip: 138,
    call_wall: 145,
    put_wall: 130,
    max_pain: null,
    gex_king_strike: 142,
    net_gex: 1e9,
    gamma_posture: "long",
    gamma_regime_read: "long gamma",
    net_vex: 0,
    vanna_posture: null,
    vanna_regime_read: "",
    net_dex: null,
    dex_posture: null,
    dex_regime_read: null,
    net_charm: null,
    charm_posture: null,
    charm_regime_read: null,
    nearest_wall: null,
    distance_to_flip_pct: 1.4,
    flip_nearest: 138,
    flip_crossings: 1,
    distance_to_nearest_flip_pct: 1.4,
    shift_summary: null,
  });
  assert.ok(hit);
  assert.equal(hit!.direction, "LONG");
  assert.equal(hit!.ticker, "NVDA");
});

test("scorePositioningForSwing: returns null when no wall alignment", () => {
  const miss = scorePositioningForSwing({
    ticker: "NVDA",
    spot: 200,
    change_pct: 5,
    asof: "2026-09-04T20:00:00.000Z",
    flip: 180,
    call_wall: 145,
    put_wall: 130,
    max_pain: null,
    gex_king_strike: 190,
    net_gex: 1e9,
    gamma_posture: "long",
    gamma_regime_read: "long gamma",
    net_vex: 0,
    vanna_posture: null,
    vanna_regime_read: "",
    net_dex: null,
    dex_posture: null,
    dex_regime_read: null,
    net_charm: null,
    charm_posture: null,
    charm_regime_read: null,
    nearest_wall: null,
    distance_to_flip_pct: 10,
    flip_nearest: 180,
    flip_crossings: 1,
    distance_to_nearest_flip_pct: 10,
    shift_summary: null,
  });
  assert.equal(miss, null);
});
