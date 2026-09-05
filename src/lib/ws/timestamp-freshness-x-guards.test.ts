import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ageHoursFromIso,
  minutesSinceIso,
  WS_TIMESTAMP_FUTURE_TOLERANCE_MS,
} from "./timestamp-freshness";

test("minutesSinceIso: future skew beyond tolerance returns null", () => {
  const now = Date.parse("2026-09-05T17:00:00.000Z");
  const future = new Date(now + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 1_000).toISOString();
  assert.equal(minutesSinceIso(future, now), null);
});

test("minutesSinceIso: clamps near-future skew to 0 minutes", () => {
  const now = Date.parse("2026-09-05T17:00:00.000Z");
  const nearFuture = new Date(now + 2_000).toISOString();
  assert.equal(minutesSinceIso(nearFuture, now), 0);
});

test("ageHoursFromIso: future skew beyond tolerance returns stale sentinel", () => {
  const now = Date.parse("2026-09-05T17:00:00.000Z");
  const future = new Date(now + WS_TIMESTAMP_FUTURE_TOLERANCE_MS + 60_000).toISOString();
  assert.equal(ageHoursFromIso(future, 999, now), 999);
});

test("x automation uses shared ISO age guards", () => {
  const engage = readFileSync("src/lib/x-engage-engine.ts", "utf8");
  const api = readFileSync("src/lib/x-api.ts", "utf8");
  const guard = readFileSync("src/lib/x-post-guard.ts", "utf8");
  assert.match(engage, /ageHoursFromIso/);
  assert.match(api, /minutesSinceIso/);
  assert.match(guard, /minutesSinceIso/);
});
