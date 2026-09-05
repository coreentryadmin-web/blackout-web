import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isSwingConfluenceEnforced,
  isSwingCortexEnforced,
  isSwingEarningsGateEnforced,
  isSwingHaltGateEnforced,
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
