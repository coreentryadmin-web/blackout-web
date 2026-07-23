import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCadence, scanCadenceFromEt } from "./cadence.ts";

test("opening drive and power hour scan fastest; midday relaxes", () => {
  assert.equal(scanCadence(5).phase, "OPENING_DRIVE"); // 9:35
  assert.equal(scanCadence(5).intervalMs, 30_000);
  assert.equal(scanCadence(200).phase, "MIDDAY"); // ~12:50
  assert.equal(scanCadence(200).intervalMs, 180_000);
  assert.equal(scanCadence(330).phase, "POWER_HOUR"); // ~15:00
  assert.equal(scanCadence(330).intervalMs, 30_000);
});

test("power hour is faster than midday (information arrival accelerates into the close)", () => {
  assert.ok(scanCadence(330).intervalMs! < scanCadence(200).intervalMs!);
});

test("boundaries land on the right phase", () => {
  assert.equal(scanCadence(44).phase, "OPENING_DRIVE");
  assert.equal(scanCadence(45).phase, "MORNING");
  assert.equal(scanCadence(89).phase, "MORNING");
  assert.equal(scanCadence(90).phase, "MIDDAY");
  assert.equal(scanCadence(299).phase, "MIDDAY");
  assert.equal(scanCadence(300).phase, "POWER_HOUR");
  assert.equal(scanCadence(360).phase, "LATE");
  assert.equal(scanCadence(390).phase, "CLOSED");
});

test("pre-open is a slow keep-warm; after close is idle", () => {
  assert.equal(scanCadence(-30).phase, "PRE_OPEN");
  assert.equal(scanCadence(-30).intervalMs, 120_000);
  assert.equal(scanCadence(400).phase, "CLOSED");
  assert.equal(scanCadence(400).intervalMs, null);
});

test("non-trading day is CLOSED / idle regardless of clock", () => {
  const c = scanCadence(5, false);
  assert.equal(c.phase, "CLOSED");
  assert.equal(c.intervalMs, null);
});

test("unknown session time degrades to CLOSED, never a fabricated interval", () => {
  assert.equal(scanCadence(NaN).intervalMs, null);
});

test("scanCadenceFromEt maps wall-clock parts to the same cadence", () => {
  assert.equal(scanCadenceFromEt(9, 35).phase, "OPENING_DRIVE"); // 9:35 → 5 min in
  assert.equal(scanCadenceFromEt(15, 5).phase, "POWER_HOUR"); // 15:05 → 335 min in
  assert.equal(scanCadenceFromEt(12, 30).phase, "MIDDAY");
});
