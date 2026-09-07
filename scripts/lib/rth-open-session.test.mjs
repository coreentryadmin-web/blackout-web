import test from "node:test";
import assert from "node:assert/strict";
import { shouldRunRthSessionChecks } from "./rth-open-session.mjs";
import { isTradingDayEt } from "../gha-et-window.mjs";

test("shouldRunRthSessionChecks: Labor Day 2026-09-07 is not a trading session", () => {
  assert.equal(isTradingDayEt("2026-09-07"), false);
  assert.equal(shouldRunRthSessionChecks(false), false);
});

test("shouldRunRthSessionChecks: regular weekday runs session gates", () => {
  assert.equal(isTradingDayEt("2026-09-08"), true);
  assert.equal(shouldRunRthSessionChecks(true), true);
});
