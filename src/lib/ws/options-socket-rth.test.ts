import { test } from "node:test";
import assert from "node:assert/strict";
import { inOptionsMarketHours, shouldMaintainSocket } from "./options-socket";

// Fixed reference instants (June 2026 → ET is EDT, UTC-4).
const MON_RTH = new Date("2026-06-29T14:30:00Z"); // Mon 10:30 ET — inside 09:30–16:00
const MON_PREOPEN = new Date("2026-06-29T11:00:00Z"); // Mon 07:00 ET — before open
const MON_AFTERCLOSE = new Date("2026-06-29T21:30:00Z"); // Mon 17:30 ET — after close
const SUNDAY = new Date("2026-06-28T15:00:00Z"); // Sun 11:00 ET — weekend
const SATURDAY = new Date("2026-06-27T15:00:00Z"); // Sat 11:00 ET — weekend

function withOffHoursForced<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.OPTIONS_WS_OFFHOURS_RECONNECT;
  if (value === undefined) delete process.env.OPTIONS_WS_OFFHOURS_RECONNECT;
  else process.env.OPTIONS_WS_OFFHOURS_RECONNECT = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.OPTIONS_WS_OFFHOURS_RECONNECT;
    else process.env.OPTIONS_WS_OFFHOURS_RECONNECT = prev;
  }
}

test("inOptionsMarketHours: weekday RTH -> true", () => {
  assert.equal(inOptionsMarketHours(MON_RTH), true);
});

test("inOptionsMarketHours: weekday pre-open / after-close -> false", () => {
  assert.equal(inOptionsMarketHours(MON_PREOPEN), false);
  assert.equal(inOptionsMarketHours(MON_AFTERCLOSE), false);
});

test("inOptionsMarketHours: weekend -> false", () => {
  assert.equal(inOptionsMarketHours(SATURDAY), false);
  assert.equal(inOptionsMarketHours(SUNDAY), false);
});

// The safety property the P2-D fix relies on: during RTH the socket is ALWAYS maintained,
// regardless of the off-hours escape-hatch env — so the fix is a strict no-op during market
// hours and cannot starve Night's Watch live valuations.
test("shouldMaintainSocket: RTH -> true regardless of escape-hatch env", () => {
  assert.equal(withOffHoursForced(undefined, () => shouldMaintainSocket(MON_RTH)), true);
  assert.equal(withOffHoursForced("0", () => shouldMaintainSocket(MON_RTH)), true);
  assert.equal(withOffHoursForced("1", () => shouldMaintainSocket(MON_RTH)), true);
});

test("shouldMaintainSocket: off-hours -> false by default (no reconnect churn)", () => {
  assert.equal(withOffHoursForced(undefined, () => shouldMaintainSocket(SUNDAY)), false);
  assert.equal(withOffHoursForced(undefined, () => shouldMaintainSocket(MON_AFTERCLOSE)), false);
});

test("shouldMaintainSocket: off-hours + escape hatch on -> true (operator rollback)", () => {
  assert.equal(withOffHoursForced("1", () => shouldMaintainSocket(SUNDAY)), true);
  assert.equal(withOffHoursForced("true", () => shouldMaintainSocket(MON_AFTERCLOSE)), true);
});
