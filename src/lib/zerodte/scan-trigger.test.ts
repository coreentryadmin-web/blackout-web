import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMaterialFlowAlert,
  canFire,
  createScanDebouncer,
  dteOf,
  EVENT_MIN_PREMIUM,
  EVENT_MIN_INTERVAL_MS,
} from "./scan-trigger";

const NOW = Date.parse("2026-07-22T17:00:00Z"); // ~13:00 ET
const today = "2026-07-22";
const tomorrow = "2026-07-23";
const nextWeek = "2026-07-29";

test("dteOf: today → 0, tomorrow → 1, next week → 7, garbage → null", () => {
  assert.equal(dteOf(today, NOW), 0);
  assert.equal(dteOf(tomorrow, NOW), 1);
  assert.equal(dteOf(nextWeek, NOW), 7);
  assert.equal(dteOf("not-a-date", NOW), null);
});

test("material: a big swept 0DTE print fires", () => {
  assert.equal(isMaterialFlowAlert({ premium: 1_500_000, has_sweep: true, expiry: today }, NOW), true);
});

test("NOT material: small premium, no sweep, or too-far-dated", () => {
  assert.equal(isMaterialFlowAlert({ premium: EVENT_MIN_PREMIUM - 1, has_sweep: true, expiry: today }, NOW), false, "below premium floor");
  assert.equal(isMaterialFlowAlert({ premium: 5_000_000, has_sweep: false, expiry: today }, NOW), false, "not swept");
  assert.equal(isMaterialFlowAlert({ premium: 5_000_000, has_sweep: true, expiry: nextWeek }, NOW), false, "too far-dated (7 DTE)");
});

test("material: 1-DTE is in-window, 2-DTE is not", () => {
  assert.equal(isMaterialFlowAlert({ premium: 2_000_000, has_sweep: true, expiry: tomorrow }, NOW), true);
  assert.equal(isMaterialFlowAlert({ premium: 2_000_000, has_sweep: true, expiry: "2026-07-24" }, NOW), false);
});

test("canFire: first fire always allowed; then gated by the interval", () => {
  assert.equal(canFire(null, NOW), true);
  assert.equal(canFire(NOW, NOW + EVENT_MIN_INTERVAL_MS - 1), false);
  assert.equal(canFire(NOW, NOW + EVENT_MIN_INTERVAL_MS), true);
});

test("debouncer: fires once, suppresses a burst, then fires again after the interval", () => {
  const d = createScanDebouncer(1000);
  let fires = 0;
  const fire = () => { fires += 1; };
  assert.equal(d.maybeFire(0, fire), true);
  assert.equal(d.maybeFire(200, fire), false); // within interval → suppressed
  assert.equal(d.maybeFire(999, fire), false);
  assert.equal(d.maybeFire(1000, fire), true); // interval elapsed → fires
  assert.equal(fires, 2);
});
