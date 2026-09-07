import assert from "node:assert/strict";
import test from "node:test";
import { isDeployCacheWarmAllowed } from "./cache-warm-deploy-gate.mjs";

test("isDeployCacheWarmAllowed: rejects Saturday (desk-warm force storm on 2026-09-05)", () => {
  // Saturday 2026-09-05 17:00 UTC ≈ 1 PM ET — inside 4–8 window on a weekday would pass, but not Sat.
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-05T17:00:00.000Z")), false);
});

test("isDeployCacheWarmAllowed: rejects Sunday", () => {
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-06T15:00:00.000Z")), false);
});

test("isDeployCacheWarmAllowed: accepts weekday inside 4 AM–8 PM ET", () => {
  // Friday 2026-09-04 18:00 UTC = 2 PM ET
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-04T18:00:00.000Z")), true);
});

test("isDeployCacheWarmAllowed: rejects weekday dead-of-night before 4 AM ET", () => {
  // Friday 2026-09-04 08:00 UTC = 4 AM ET — boundary: 4:00 AM inclusive
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-04T08:00:00.000Z")), true);
  // 3:59 AM ET
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-04T07:59:00.000Z")), false);
});

test("isDeployCacheWarmAllowed: rejects weekday after 8 PM ET", () => {
  // Friday 2026-09-05 00:30 UTC = 8:30 PM ET Thu... wait 2026-09-05 is Friday
  // Fri 2026-09-05 00:30 UTC = Thu 8:30 PM ET — use Fri evening instead
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-05T00:30:00.000Z")), false);
});

test("isDeployCacheWarmAllowed: rejects a NYSE holiday that falls on a weekday (Labor Day 2026-09-07)", () => {
  // Monday 2026-09-07 17:00 UTC = 1 PM ET — inside the 4 AM-8 PM weekday window, but a full-day
  // NYSE closure (Labor Day). Live bug confirmed the same day: this gate returned true here before
  // the holiday check was added, letting validate:deploy-class scripts hammer desk-warm?force=1
  // all session while the server-side warmers correctly stayed off via isEtExtendedWarmHours.
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-07T17:00:00.000Z")), false);
});

test("isDeployCacheWarmAllowed: still accepts an ordinary weekday one day after a holiday", () => {
  // Tuesday 2026-09-08 17:00 UTC = 1 PM ET — a normal trading day right after Labor Day, proving
  // the holiday check doesn't over-match into adjacent days.
  assert.equal(isDeployCacheWarmAllowed(new Date("2026-09-08T17:00:00.000Z")), true);
});
