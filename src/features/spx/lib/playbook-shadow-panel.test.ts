import test from "node:test";
import assert from "node:assert/strict";
import { buildPlaybookShadowPanel } from "./playbook-shadow-panel";
import type { PlayTechnicals } from "./spx-play-technicals";
import type { SpxDeskPayload } from "./spx-desk";

const TECH: PlayTechnicals = {
  available: true,
  m5_trend: "up",
  m5_ema20: 7500,
  m5_rsi: 55,
  m5_rsi_warning: null,
  m3_close: 7501,
  breakout: {
    vwap_reclaim: true,
    vwap_lost: false,
    hod_break: false,
    lod_break: false,
    pdh_break: false,
    pdl_break: false,
  },
};

const DESK = {
  available: true,
  market_open: true,
  price: 7501,
  vwap: 7498,
  above_vwap: true,
  regime: "Bullish",
  flow_0dte_net: 1_000_000,
} as SpxDeskPayload;

test("buildPlaybookShadowPanel returns null when technicals unavailable", () => {
  assert.equal(buildPlaybookShadowPanel(DESK, { ...TECH, available: false }), null);
});

test("buildPlaybookShadowPanel returns three registry verdicts in shadow mode", () => {
  const panel = buildPlaybookShadowPanel(DESK, TECH);
  assert.ok(panel);
  assert.equal(panel!.mode, "shadow");
  assert.equal(panel!.verdicts.length, 3);
  assert.equal(panel!.verdicts[0]?.playbook_id, "PB-01");
  assert.equal(panel!.verdicts[0]?.name, "VWAP Reclaim");
});
