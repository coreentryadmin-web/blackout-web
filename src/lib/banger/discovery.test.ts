import { test } from "node:test";
import assert from "node:assert/strict";
import {
  screenBangerMovers,
  nearestWeeklyExpiry,
  DEFAULT_BANGER_SCREEN_CONFIG,
  type GroupedDailyRow,
} from "./discovery.ts";

function row(t: string, o: number, h: number, l: number, c: number, v: number): GroupedDailyRow {
  return { T: t, o, h, l, c, v };
}

test("screenBangerMovers keeps a qualifying banger (gain, volume, closed strong)", () => {
  const rows: GroupedDailyRow[] = [row("ANET", 10, 12.6, 9.8, 12.5, 2_000_000)];
  const out = screenBangerMovers(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ticker, "ANET");
  assert.ok(Math.abs(out[0]!.gain - 0.25) < 1e-9);
});

test("screenBangerMovers drops low gain, low volume, out-of-band price, and weak close", () => {
  const rows: GroupedDailyRow[] = [
    row("LOWGAIN", 10, 10.3, 9.9, 10.2, 5_000_000), // 2% gain < 5% floor
    row("LOWVOL", 10, 12, 9.8, 11.9, 100_000), // under 1M volume
    row("PENNY", 1, 1.3, 0.9, 1.29, 5_000_000), // under $5 floor
    row("MEGA", 500, 530, 495, 528, 5_000_000), // over $400 ceiling
    row("WEAK", 10, 14, 9.5, 10.1, 5_000_000), // gave back most of the range into the close
  ];
  const out = screenBangerMovers(rows);
  assert.equal(out.length, 0);
});

test("screenBangerMovers sorts by dollar-volume descending and applies NO top-N cap (zero caps)", () => {
  const rows: GroupedDailyRow[] = [];
  for (let i = 0; i < 40; i++) {
    rows.push(row(`T${i}`, 10, 12, 9.8, 11.9, 1_000_000 + i * 10_000));
  }
  const out = screenBangerMovers(rows);
  assert.equal(out.length, 40, "every qualifying row survives — no top-N slice");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1]!.dollar >= out[i]!.dollar, "sorted by $-volume desc");
  }
});

test("screenBangerMovers ignores malformed rows instead of throwing", () => {
  const rows = [
    row("GOOD", 10, 12, 9.8, 11.9, 2_000_000),
    { T: "BAD", o: 0, h: NaN, l: 1, c: 2, v: 1 } as unknown as GroupedDailyRow,
    { T: "", o: 10, h: 12, l: 9, c: 11, v: 2_000_000 } as GroupedDailyRow,
  ];
  const out = screenBangerMovers(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.ticker, "GOOD");
});

test("screenBangerMovers config overrides are honored (e.g. tighter min-gain)", () => {
  const rows: GroupedDailyRow[] = [row("MILD", 10, 10.7, 9.9, 10.6, 5_000_000)]; // 6% gain
  assert.equal(screenBangerMovers(rows, DEFAULT_BANGER_SCREEN_CONFIG).length, 1);
  assert.equal(
    screenBangerMovers(rows, { ...DEFAULT_BANGER_SCREEN_CONFIG, minGain: 0.1 }).length,
    0,
  );
});

test("nearestWeeklyExpiry walks forward to the next Friday at least minAhead days out", () => {
  // 2026-08-04 is a Tuesday.
  assert.equal(nearestWeeklyExpiry("2026-08-04", 4), "2026-08-14"); // +4d = Sat 08-08 -> next Fri 08-14
  // 2026-08-03 is a Monday; +4d lands on Friday 08-07 exactly.
  assert.equal(nearestWeeklyExpiry("2026-08-03", 4), "2026-08-07");
});

test("nearestWeeklyExpiry defaults minAhead to 4", () => {
  assert.equal(nearestWeeklyExpiry("2026-08-03"), nearestWeeklyExpiry("2026-08-03", 4));
});
