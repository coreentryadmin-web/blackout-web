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
