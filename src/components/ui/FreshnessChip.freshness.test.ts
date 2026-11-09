import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveFreshnessStatus, formatFreshnessTimestamp } from "./FreshnessChip";

test("effectiveFreshnessStatus: future-skewed asOf reads stale not live", () => {
  const asOf = new Date("2026-09-04T15:00:10.000Z");
  const now = Date.parse("2026-09-04T15:00:00.000Z"); // 10s in the future
  assert.equal(effectiveFreshnessStatus("live", asOf, now, 5_000), "stale");
});

test("effectiveFreshnessStatus: within future tolerance stays live", () => {
  const asOf = new Date("2026-09-04T15:00:03.000Z");
  const now = Date.parse("2026-09-04T15:00:00.000Z"); // 3s future (< 5s tolerance)
  assert.equal(effectiveFreshnessStatus("live", asOf, now, 60_000), "live");
});

test("effectiveFreshnessStatus: staleAfterMs still flips live to stale", () => {
  const asOf = new Date("2026-09-04T15:00:00.000Z");
  const now = Date.parse("2026-09-04T15:00:12.000Z");
  assert.equal(effectiveFreshnessStatus("live", asOf, now, 10_000), "stale");
});

test("formatFreshnessTimestamp anchors the hover-title stamp to ET, not the viewer's local zone", () => {
  // Same bug class as #7824/#7826/#7828: a bare `toLocaleString()` with no `timeZone` renders in
  // whatever zone the viewer's device is set to. Pick an instant that is a DIFFERENT calendar day
  // in ET than in a far-ahead zone, and prove the formatted stamp still reads the ET day/hour
  // regardless of `process.env.TZ`.
  const asOf = new Date("2026-07-14T02:15:00.000Z"); // 2026-07-13, 22:15 EDT (one day earlier in ET)
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Auckland"; // UTC+12 in July — local date would read 7/14
    const stamp = formatFreshnessTimestamp(asOf);
    assert.ok(stamp.includes("7/13/2026"), `expected the ET calendar day (7/13/2026) in "${stamp}"`);
    assert.ok(stamp.includes("10:15:00 PM"), `expected the ET wall-clock time in "${stamp}"`);
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});
