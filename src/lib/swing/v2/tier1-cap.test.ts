import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSwingTier1Cap } from "./tier1-cap";
import { isSwingConfluenceEnforced } from "./config";

test("resolveSwingTier1Cap: legacy mode returns fixed cap", () => {
  const r = resolveSwingTier1Cap(500, 40, {});
  assert.equal(r.dynamic, false);
  assert.equal(r.cap, 40);
});

test("resolveSwingTier1Cap: V2 dynamic sizes to pool with floor/ceiling", () => {
  const env = { SWING_ENGINE_V2: "1", SWING_TIER1_CAP_MIN: "80", SWING_TIER1_CAP_MAX: "200" };
  const thin = resolveSwingTier1Cap(50, 40, env);
  assert.equal(thin.dynamic, true);
  assert.equal(thin.cap, 80); // floor binds on thin day

  const wide = resolveSwingTier1Cap(600, 40, env);
  assert.equal(wide.cap, 200); // ceiling binds: ceil(600*0.35)=210 → 200

  const mid = resolveSwingTier1Cap(200, 40, env);
  assert.equal(mid.cap, 80); // ceil(200*0.35)=70 → floor 80
});

test("resolveSwingTier1Cap: kill-switch disables dynamic", () => {
  const r = resolveSwingTier1Cap(500, 40, { SWING_ENGINE_V2: "1", SWING_ENGINE_V2_DISABLED: "1" });
  assert.equal(r.dynamic, false);
  assert.equal(r.cap, 40);
});

test("isSwingConfluenceEnforced: requires master V2 + enforce flag", () => {
  assert.equal(isSwingConfluenceEnforced({ SWING_ENGINE_V2: "1", SWING_ENGINE_V2_ENFORCE_CONFLUENCE: "1" }), true);
  assert.equal(isSwingConfluenceEnforced({ SWING_ENGINE_V2: "1" }), false);
  assert.equal(isSwingConfluenceEnforced({ SWING_ENGINE_V2_ENFORCE_CONFLUENCE: "1" }), false);
});
