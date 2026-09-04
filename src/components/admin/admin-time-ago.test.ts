import assert from "node:assert/strict";
import test from "node:test";
import {
  adminAgeMsFromIso,
  isoAgeSec,
  openDurationLabelFromIso,
  timeAgoCompactFromIso,
  timeAgoFromIso,
} from "./admin-time-ago";

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

test("timeAgoCompactFromIso: future timestamp beyond tolerance reads as clock skew", () => {
  const iso = new Date(NOW + 60_000).toISOString();
  assert.equal(timeAgoCompactFromIso(iso, NOW), "clock skew");
});

test("openDurationLabelFromIso: future timestamp beyond tolerance reads as clock skew", () => {
  const iso = new Date(NOW + 60_000).toISOString();
  assert.equal(openDurationLabelFromIso(iso, NOW), " · open clock skew");
});

test("isoAgeSec: small future skew within tolerance clamps to zero", () => {
  const iso = new Date(NOW + 2_000).toISOString();
  assert.deepEqual(isoAgeSec(iso, NOW), { kind: "ok", sec: 0 });
});

test("adminAgeMsFromIso: future timestamp returns null (treat as stale/untrusted)", () => {
  const iso = new Date(NOW + 60_000).toISOString();
  assert.equal(adminAgeMsFromIso(iso, NOW), null);
});

test("adminAgeMsFromIso: past timestamp returns clamped age", () => {
  const iso = new Date(NOW - 45_000).toISOString();
  assert.equal(adminAgeMsFromIso(iso, NOW), 45_000);
});
