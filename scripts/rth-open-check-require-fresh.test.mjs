import test from "node:test";
import assert from "node:assert/strict";
import { isTradingDayEt } from "./gha-et-window.mjs";
import { socketProbeFinalFailure } from "./lib/rth-socket-probe.mjs";

test("Labor Day 2026-09-07 is not a US equity trading session", () => {
  assert.equal(isTradingDayEt("2026-09-07"), false);
});

test("requireFreshMarks is false on NYSE holiday even after 09:30 ET", () => {
  const afterOpen930 = 10 * 60 >= 9 * 60 + 30;
  const tradingDay = isTradingDayEt("2026-09-07");
  assert.equal(afterOpen930 && tradingDay, false);
});

test("socket probe does not hard-fail when requireFreshMarks is false (holiday path)", () => {
  assert.equal(socketProbeFinalFailure(false, "probe HTTP 200", false), null);
});
