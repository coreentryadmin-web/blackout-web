import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyErrorSpike } from "./error-sink";

test("classifyErrorSpike: below warn -> none", () => {
  assert.equal(classifyErrorSpike(0, 25, 75), "none");
  assert.equal(classifyErrorSpike(24, 25, 75), "none");
});

test("classifyErrorSpike: warn boundary inclusive -> warning", () => {
  assert.equal(classifyErrorSpike(25, 25, 75), "warning");
  assert.equal(classifyErrorSpike(74, 25, 75), "warning");
});

test("classifyErrorSpike: crit boundary inclusive -> critical", () => {
  assert.equal(classifyErrorSpike(75, 25, 75), "critical");
  assert.equal(classifyErrorSpike(1000, 25, 75), "critical");
});
