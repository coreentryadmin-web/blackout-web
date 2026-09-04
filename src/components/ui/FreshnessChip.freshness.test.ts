import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveFreshnessStatus } from "./FreshnessChip";

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
