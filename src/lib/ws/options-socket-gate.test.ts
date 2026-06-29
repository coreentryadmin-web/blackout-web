import { test } from "node:test";
import assert from "node:assert/strict";
import { optionsSocketGateOpen, inOptionsMarketHours } from "./options-socket";

// June 2026 → ET is EDT (UTC-4).
const MON_RTH = new Date("2026-06-29T14:30:00Z"); // Mon 10:30 ET — inside 09:30–16:00
const MON_AFTERCLOSE = new Date("2026-06-29T21:30:00Z"); // Mon 17:30 ET
const SUNDAY = new Date("2026-06-28T15:00:00Z"); // weekend

test("inOptionsMarketHours: weekday RTH true, off-hours/weekend false", () => {
  assert.equal(inOptionsMarketHours(MON_RTH), true);
  assert.equal(inOptionsMarketHours(MON_AFTERCLOSE), false);
  assert.equal(inOptionsMarketHours(SUNDAY), false);
});

// The core P2-D invariant: a NON-leader NEVER holds a socket — regardless of RTH or the
// off-hours override. This is what collapses N replicas to a single live options WS.
test("optionsSocketGateOpen: non-leader is always false", () => {
  assert.equal(optionsSocketGateOpen(false, false, MON_RTH), false);
  assert.equal(optionsSocketGateOpen(false, true, MON_RTH), false); // even forced
  assert.equal(optionsSocketGateOpen(false, false, SUNDAY), false);
});

// The leader holds the socket during RTH, and rests off-hours unless the escape hatch forces it.
test("optionsSocketGateOpen: leader holds during RTH, rests off-hours (unless forced)", () => {
  assert.equal(optionsSocketGateOpen(true, false, MON_RTH), true); // leader + RTH → open
  assert.equal(optionsSocketGateOpen(true, false, MON_AFTERCLOSE), false); // leader + off-hours → rest
  assert.equal(optionsSocketGateOpen(true, false, SUNDAY), false); // leader + weekend → rest
  assert.equal(optionsSocketGateOpen(true, true, MON_AFTERCLOSE), true); // forced off-hours hatch
});

// Safety: during RTH a leader is ALWAYS open regardless of the off-hours flag — the off-hours
// override can only ADD off-hours connectivity, never remove RTH connectivity.
test("optionsSocketGateOpen: RTH leader open regardless of the off-hours flag", () => {
  assert.equal(optionsSocketGateOpen(true, false, MON_RTH), true);
  assert.equal(optionsSocketGateOpen(true, true, MON_RTH), true);
});
