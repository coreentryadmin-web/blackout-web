import { test } from "node:test";
import assert from "node:assert/strict";
import { coachingAlertAgeFields } from "./coaching-alert-age";

test("coachingAlertAgeFields: null/undefined generatedAt returns null fields, not stale", () => {
  assert.deepEqual(coachingAlertAgeFields(null, Date.now()), { ageMs: null, ageMinutes: null, stale: false });
  assert.deepEqual(coachingAlertAgeFields(undefined, Date.now()), { ageMs: null, ageMinutes: null, stale: false });
});

test("coachingAlertAgeFields: unparseable timestamp returns null fields", () => {
  assert.deepEqual(coachingAlertAgeFields("not-a-date", Date.now()), { ageMs: null, ageMinutes: null, stale: false });
});

test("coachingAlertAgeFields: ordinary past timestamp ages normally", () => {
  const now = 1_800_000_000_000;
  const generatedAt = new Date(now - 5 * 60_000).toISOString(); // 5 minutes ago
  const out = coachingAlertAgeFields(generatedAt, now);
  assert.equal(out.ageMs, 5 * 60_000);
  assert.equal(out.ageMinutes, 5);
  assert.equal(out.stale, false);
});

test("coachingAlertAgeFields: age past the 60-minute threshold is stale", () => {
  const now = 1_800_000_000_000;
  const generatedAt = new Date(now - 90 * 60_000).toISOString(); // 90 minutes ago
  const out = coachingAlertAgeFields(generatedAt, now);
  assert.equal(out.ageMinutes, 90);
  assert.equal(out.stale, true);
});

test("coachingAlertAgeFields: a future generated_at (RDS-vs-app clock skew) clamps to zero, not negative", () => {
  const now = 1_800_000_000_000;
  // generated_at 30 seconds AHEAD of this process's clock (ordinary skew, not corruption).
  const generatedAt = new Date(now + 30_000).toISOString();
  const out = coachingAlertAgeFields(generatedAt, now);
  assert.equal(out.ageMs, 0);
  assert.equal(out.ageMinutes, 0, "must never report a negative age (e.g. -1) for a fresh, merely future-skewed row");
  assert.equal(out.stale, false);
});

test("coachingAlertAgeFields: sub-second future skew (the reachable-at-1ms case) still clamps to zero", () => {
  const now = 1_800_000_000_000;
  const generatedAt = new Date(now + 1).toISOString(); // 1ms in the future
  const out = coachingAlertAgeFields(generatedAt, now);
  assert.equal(out.ageMs, 0);
  assert.equal(out.ageMinutes, 0, "Math.floor(-0.0001/60000) would otherwise report -1 minutes for 1ms of skew");
});

test("coachingAlertAgeFields: accepts a Date object as well as a string/ISO timestamp", () => {
  const now = 1_800_000_000_000;
  const generatedAt = new Date(now - 60_000);
  const out = coachingAlertAgeFields(generatedAt, now);
  assert.equal(out.ageMinutes, 1);
});
