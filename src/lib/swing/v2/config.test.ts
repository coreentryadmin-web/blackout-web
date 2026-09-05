import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSwingConfluenceEnforced,
  isSwingCortexEnforced,
  isSwingEarningsGateEnforced,
  isSwingHaltGateEnforced,
  isSwingRegimeGateEnforced,
  isSwingQuoteStaleGateEnforced,
  isSwingDailyBarGateEnforced,
  isSwingEngineV2Enabled,
} from "./config";

test("isSwingEngineV2Enabled: LIVE on by default", () => {
  assert.equal(isSwingEngineV2Enabled({}), true);
});

test("isSwingEngineV2Enabled: explicit opt-out", () => {
  assert.equal(isSwingEngineV2Enabled({ SWING_ENGINE_V2_DISABLED: "1" }), false);
  assert.equal(isSwingEngineV2Enabled({ SWING_ENGINE_V2: "0" }), false);
});

test("isSwingConfluenceEnforced: LIVE when V2 on; opt-out only", () => {
  assert.equal(isSwingConfluenceEnforced({}), true);
  assert.equal(isSwingConfluenceEnforced({ SWING_ENGINE_V2_ENFORCE_CONFLUENCE: "0" }), false);
  assert.equal(isSwingConfluenceEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});

test("isSwingCortexEnforced: LIVE when V2 on; opt-out only", () => {
  assert.equal(isSwingCortexEnforced({}), true);
  assert.equal(isSwingCortexEnforced({ SWING_ENGINE_V2_ENFORCE_CORTEX: "0" }), false);
  assert.equal(isSwingCortexEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});

test("isSwingEarningsGateEnforced: LIVE when V2 on; opt-out only", () => {
  assert.equal(isSwingEarningsGateEnforced({}), true);
  assert.equal(isSwingEarningsGateEnforced({ SWING_ENGINE_V2_ENFORCE_EARNINGS: "0" }), false);
  assert.equal(isSwingEarningsGateEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});

test("isSwingHaltGateEnforced: LIVE when V2 on; opt-out only", () => {
  assert.equal(isSwingHaltGateEnforced({}), true);
  assert.equal(isSwingHaltGateEnforced({ SWING_ENGINE_V2_ENFORCE_HALT: "0" }), false);
  assert.equal(isSwingHaltGateEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});

test("isSwingRegimeGateEnforced: LIVE when V2 on; opt-out only", () => {
  assert.equal(isSwingRegimeGateEnforced({}), true);
  assert.equal(isSwingRegimeGateEnforced({ SWING_ENGINE_V2_ENFORCE_REGIME: "0" }), false);
  assert.equal(isSwingRegimeGateEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});

test("isSwingQuoteStaleGateEnforced: LIVE when V2 on; opt-out only", () => {
  assert.equal(isSwingQuoteStaleGateEnforced({}), true);
  assert.equal(isSwingQuoteStaleGateEnforced({ SWING_ENGINE_V2_ENFORCE_QUOTE_STALE: "0" }), false);
  assert.equal(isSwingQuoteStaleGateEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});

test("isSwingDailyBarGateEnforced: OFF by default until reference-bar signal is opt-in", () => {
  assert.equal(isSwingDailyBarGateEnforced({}), false);
  assert.equal(isSwingDailyBarGateEnforced({ SWING_ENGINE_V2_ENFORCE_DAILY_BAR: "1" }), true);
  assert.equal(isSwingDailyBarGateEnforced({ SWING_ENGINE_V2_DISABLED: "1" }), false);
});
