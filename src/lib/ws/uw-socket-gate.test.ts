import { test } from "node:test";
import assert from "node:assert/strict";
import { inOptionsMarketHours } from "./options-socket";
import { uwSocketGateOpen } from "./uw-socket";

const MON_RTH = new Date("2026-06-29T14:30:00Z"); // Mon 10:30 ET
const MON_AFTERCLOSE = new Date("2026-06-29T21:30:00Z"); // Mon 17:30 ET
const SUNDAY = new Date("2026-06-28T15:00:00Z");

test("inOptionsMarketHours baseline for UW gate", () => {
  assert.equal(inOptionsMarketHours(MON_RTH), true);
  assert.equal(inOptionsMarketHours(MON_AFTERCLOSE), false);
});

test("uwSocketGateOpen: non-leader always false", () => {
  assert.equal(uwSocketGateOpen(false, false, MON_RTH), false);
  assert.equal(uwSocketGateOpen(false, true, MON_RTH), false);
});

test("uwSocketGateOpen: leader holds during RTH, rests off-hours unless forced", () => {
  assert.equal(uwSocketGateOpen(true, false, MON_RTH), true);
  assert.equal(uwSocketGateOpen(true, false, MON_AFTERCLOSE), false);
  assert.equal(uwSocketGateOpen(true, true, MON_AFTERCLOSE), true);
});
