import assert from "node:assert/strict";
import test from "node:test";
import { secondsSinceIso, timeAgoCompactFromIso, timeAgoFromIso } from "./admin-time-ago";

const NOW = Date.parse("2026-09-04T16:00:00.000Z");

test("timeAgoFromIso: future timestamp beyond tolerance reads as clock skew", () => {
  const iso = new Date(NOW + 60_000).toISOString();
  assert.equal(timeAgoFromIso(iso, NOW), "clock skew");
});

test("timeAgoFromIso: small future skew within tolerance reads as just now", () => {
  const iso = new Date(NOW + 2_000).toISOString();
  assert.equal(timeAgoFromIso(iso, NOW), "just now");
});

test("timeAgoFromIso: null/invalid returns em dash", () => {
  assert.equal(timeAgoFromIso(null, NOW), "—");
  assert.equal(timeAgoFromIso("not-a-date", NOW), "—");
});

test("timeAgoCompactFromIso: future timestamp beyond tolerance reads as skew", () => {
  const iso = new Date(NOW + 60_000).toISOString();
  assert.equal(timeAgoCompactFromIso(iso, NOW), "skew");
});

test("timeAgoCompactFromIso: recent past uses compact seconds", () => {
  const iso = new Date(NOW - 12_000).toISOString();
  assert.equal(timeAgoCompactFromIso(iso, NOW), "12s");
});

test("secondsSinceIso: future timestamp beyond tolerance returns null", () => {
  const iso = new Date(NOW + 60_000).toISOString();
  assert.equal(secondsSinceIso(iso, NOW), null);
});

test("secondsSinceIso: clamps small negative skew to zero", () => {
  const iso = new Date(NOW + 2_000).toISOString();
  assert.equal(secondsSinceIso(iso, NOW), 0);
});
