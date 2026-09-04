import { test } from "node:test";
import assert from "node:assert/strict";
import { ageMinFromIso, ageSecFromIso, isWsUpdatedAtFresh, wsUpdatedAtAgeMs } from "./timestamp-freshness";

test("wsUpdatedAtAgeMs clamps negative skew to 0", () => {
  const now = 1_000_000;
  assert.equal(wsUpdatedAtAgeMs(now + 2_000, now), 0);
  assert.equal(wsUpdatedAtAgeMs(now - 5_000, now), 5_000);
});

test("ageSecFromIso returns null for clock-skewed future ISO timestamps", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const future = new Date(now + 60_000).toISOString();
  assert.equal(ageSecFromIso(future, now), null);
});

test("ageSecFromIso clamps small future skew within tolerance", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const nearFuture = new Date(now + 2_000).toISOString();
  assert.equal(ageSecFromIso(nearFuture, now), 0);
});

test("ageMinFromIso rounds trusted age to whole minutes", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  const past = new Date(now - 120_000).toISOString();
  assert.equal(ageMinFromIso(past, now), 2);
});

test("isWsUpdatedAtFresh rejects future timestamps beyond tolerance", () => {
  const now = 1_000_000;
  assert.equal(isWsUpdatedAtFresh(now + 6_000, 60_000, now), false);
  assert.equal(isWsUpdatedAtFresh(now + 4_000, 60_000, now), true);
  assert.equal(isWsUpdatedAtFresh(now - 30_000, 60_000, now), true);
  assert.equal(isWsUpdatedAtFresh(now - 90_000, 60_000, now), false);
});
