import assert from "node:assert/strict";
import test from "node:test";
import { spxDegradedFlag } from "./rth-spx-play-flags.mjs";

test("spxDegradedFlag: no flag when not degraded", () => {
  assert.equal(spxDegradedFlag({ action: "SCANNING" }), null);
});

test("spxDegradedFlag: warming path is AMBER not RED", () => {
  const flag = spxDegradedFlag({
    degraded: true,
    assessed: false,
    available: false,
    action: "SCANNING",
    headline: "Desk warming — play state unavailable",
  });
  assert.equal(flag?.severity, "AMBER");
  assert.equal(flag?.code, "WARMING");
});

test("spxDegradedFlag: evaluated-but-degraded stays RED", () => {
  const flag = spxDegradedFlag({
    degraded: true,
    assessed: true,
    available: true,
    action: "WATCH",
  });
  assert.equal(flag?.severity, "RED");
  assert.equal(flag?.code, "DEGRADED");
});
