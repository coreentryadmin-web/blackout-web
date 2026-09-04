import assert from "node:assert/strict";
import test from "node:test";
import { timeAgoFromIso } from "./admin-time-ago";

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
