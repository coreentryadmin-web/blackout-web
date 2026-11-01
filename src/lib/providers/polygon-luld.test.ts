import { test } from "node:test";
import assert from "node:assert/strict";
import {
  luldIndicatorHaltState,
  luldMsFromRawTimestamp,
  normalizeLuldWsMessages,
} from "./polygon-luld";
import { hasActiveLuldHalt, applyLuldHaltEvents, luldHaltsStore } from "../ws/luld-halts-store";

test("luldIndicatorHaltState maps SIP halt/resume codes", () => {
  assert.equal(luldIndicatorHaltState(3), true);
  assert.equal(luldIndicatorHaltState(4), false);
  assert.equal(luldIndicatorHaltState(1), null);
});

test("normalizeLuldWsMessages parses LULD frames", () => {
  const rows = normalizeLuldWsMessages([
    { ev: "LULD", T: "SPY", h: 601, l: 599, i: 3, t: 1_718_000_000_000 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.symbol, "SPY");
  assert.equal(rows[0]?.active, true);
});

// BUG FIX regression (2026-11-01): a raw `t` already in epoch MILLISECONDS (~1.7e12, exactly
// what Massive's own LULD docs say the field is) used to fall into the ">1e12 => divide by 1000"
// branch and get silently shrunk by 1000x into a seconds-scale number — so `new Date(ts)` in
// luld-halts-store.ts's applyLuldHaltEvents would stamp `halted_at` in January 1970 instead of
// now. Assert the ms value survives unchanged.
test("normalizeLuldWsMessages keeps an already-millisecond t unchanged", () => {
  const msEpoch = 1_718_000_000_000; // a real epoch-ms value (~June 2024)
  const rows = normalizeLuldWsMessages([
    { ev: "LULD", T: "SPY", h: 601, l: 599, i: 3, t: msEpoch },
  ]);
  assert.equal(rows[0]?.ts, msEpoch);
});

test("luldMsFromRawTimestamp disambiguates seconds/ms/microseconds/nanoseconds", () => {
  const now = 1_700_000_000_000;
  // Seconds epoch (~1.7e9) -> ms.
  assert.equal(luldMsFromRawTimestamp(1_700_000_000, now), 1_700_000_000_000);
  // Already ms (~1.7e12) -> unchanged (the exact case the bug mishandled).
  assert.equal(luldMsFromRawTimestamp(1_700_000_000_000, now), 1_700_000_000_000);
  // Microseconds (~1.7e15) -> divide by 1000 to get ms.
  assert.equal(luldMsFromRawTimestamp(1_700_000_000_000_000, now), 1_700_000_000_000);
  // Nanoseconds (~1.7e18, the real wire-verified LULD scale) -> divide by 1e6 to get ms.
  assert.equal(luldMsFromRawTimestamp(1_700_000_000_000_000_000, now), 1_700_000_000_000);
  // Non-finite / zero / negative all fall back to `now`.
  assert.equal(luldMsFromRawTimestamp(NaN, now), now);
  assert.equal(luldMsFromRawTimestamp(0, now), now);
  assert.equal(luldMsFromRawTimestamp(-5, now), now);
});

test("hasActiveLuldHalt proxies SPY halt to SPX watch list", () => {
  luldHaltsStore.halts.clear();
  applyLuldHaltEvents([{ symbol: "SPY", active: true, indicator: 3, ts: Date.now() }]);
  assert.equal(hasActiveLuldHalt(["SPX"]), true);
  luldHaltsStore.halts.clear();
});
