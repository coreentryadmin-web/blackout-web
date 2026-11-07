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
  // x-api.ts dropped out of this ratchet 2026-11-07: its only "time since" logic
  // (minutesSinceLastOwnPost, built on minutesSinceIso) was dead code with zero callers
  // anywhere in the repo since #7387 moved the live posting-cadence age check to
  // x-post-guard.ts's own minutesSinceLastProductPost (which still uses minutesSinceIso
  // and is still covered below). x-api.ts now does no ISO-age arithmetic of its own, so
  // there is nothing left for this guard to protect there — re-add an assertion on
  // x-api.ts if it grows a new age computation that should use the shared helper instead
  // of reimplementing date math inline.
  const engage = readFileSync("src/lib/x-engage-engine.ts", "utf8");
  const guard = readFileSync("src/lib/x-post-guard.ts", "utf8");
  assert.match(engage, /ageHoursFromIso/);
  assert.match(guard, /minutesSinceIso/);
});
