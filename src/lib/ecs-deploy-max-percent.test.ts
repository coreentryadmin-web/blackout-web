import { test } from "node:test";
import assert from "node:assert/strict";
import { ceilingTasks, minimumMaximumPercent } from "./ecs-deploy-max-percent.ts";

test("minimumMaximumPercent clears autoscaling floor 5 at 120%", () => {
  const m = minimumMaximumPercent(5);
  assert.equal(m, 120);
  assert.ok(ceilingTasks(5, m!) >= 6);
});

test("minimumMaximumPercent clears scaled-down desired=2 (2026-10-20 deploy hang)", () => {
  const m = minimumMaximumPercent(2);
  assert.ok(m !== null && m > 120);
  assert.ok(ceilingTasks(2, m!) >= 3);
});

test("minimumMaximumPercent still fits vCPU quota at autoscaling max", () => {
  const m = minimumMaximumPercent(12);
  assert.equal(m, 120);
  const peak = ceilingTasks(12, m!) * 2 + 2;
  assert.ok(peak <= 30);
});

test("minimumMaximumPercent works for every count 1..12", () => {
  for (let desired = 1; desired <= 12; desired++) {
    const m = minimumMaximumPercent(desired);
    assert.ok(m !== null, `no maximumPercent for desired=${desired}`);
    assert.ok(
      ceilingTasks(desired, m!) > desired,
      `desired=${desired} max=${m} grants no spare slot`,
    );
  }
});
