import { test } from "node:test";
import assert from "node:assert/strict";
import { isBangerEngineEnabled } from "./flag.ts";

test("isBangerEngineEnabled defaults ON when unset", () => {
  assert.equal(isBangerEngineEnabled({} as NodeJS.ProcessEnv), true);
});

test("isBangerEngineEnabled is OFF for common falsy spellings", () => {
  for (const v of ["0", "false", "off", "no", "OFF", " False "]) {
    assert.equal(isBangerEngineEnabled({ BANGER_ENGINE_ENABLED: v } as NodeJS.ProcessEnv), false, v);
  }
});

test("isBangerEngineEnabled is ON for any other value", () => {
  for (const v of ["1", "true", "on", "yes"]) {
    assert.equal(isBangerEngineEnabled({ BANGER_ENGINE_ENABLED: v } as NodeJS.ProcessEnv), true, v);
  }
});
