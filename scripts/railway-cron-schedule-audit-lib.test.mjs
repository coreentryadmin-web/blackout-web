import { test } from "node:test";
import assert from "node:assert/strict";
import { utcBandToEt } from "./railway-cron-schedule-audit-lib.mjs";

test("utcBandToEt reads a plain hour-range field correctly", () => {
  // SPX-Engine-Evaluation style: hour field "11-21" is a genuine dash range.
  const band = utcBandToEt("*/5 11-21 * * 1-5");
  assert.ok(band);
  assert.equal(band.utc, "11:00–21:59 UTC");
  assert.equal(band.edt, "7:00–17:59 ET (EDT, Mar–Nov)");
  assert.equal(band.est, "6:00–16:59 ET (EST, Nov–Mar)");
});

test("utcBandToEt does NOT mistake the trailing weekday range for the hour band", () => {
  // banger-discovery real schedule: hour field is a COMMA LIST ("20,21"), not
  // a dash range. The buggy implementation this replaces scanned the whole
  // cron string with one unanchored regex and fell through to matching the
  // trailing weekday range "1-5" (Mon-Fri) instead, printing "1:00-5:59 UTC"
  // as if that were the firing hours. There is no single continuous UTC
  // window for a comma-list hour field, so the fixed version must return null.
  const band = utcBandToEt("15 20,21 * * 1-5");
  assert.equal(band, null);
});

test("utcBandToEt returns null for other real comma-list-hour crons in this repo", () => {
  for (const cron of [
    "10 20,21 * * 1-5", // GEX-EOD-Snapshot
    "25 13,14 * * 1-5", // Largo-Morning-Brief
    "0 13,14 * * 1-5", // nighthawk-backfill-repair
    "15 13,14 * * 1-5", // NightHawk-Morning-Confirm
    "30 20,21 * * 1-5", // NightHawk-Outcomes-Cron
  ]) {
    assert.equal(utcBandToEt(cron), null, `expected null band for "${cron}"`);
  }
});

test("utcBandToEt returns null for crons with no dash-range hour field at all", () => {
  assert.equal(utcBandToEt("0 */6 * * *"), null); // Alert-Outcome-Sync
  assert.equal(utcBandToEt("*/5 * * * *"), null); // Cron-Staleness-Watchdog
  assert.equal(utcBandToEt("0 12,14,16,18,20,22,0 * * *"), null); // x-intel
  assert.equal(utcBandToEt("0 22 * * 1-5"), null); // SPX-Signal-Weight-Optimize (bare hour, no range)
});

test("utcBandToEt still returns a band for a dash-range hour field even without a trailing weekday range", () => {
  // Make sure the fix isn't accidentally keyed off "must have a weekday range to ignore" —
  // it must work from field position alone.
  const band = utcBandToEt("*/15 21-23 * * *");
  assert.ok(band);
  assert.equal(band.utc, "21:00–23:59 UTC");
});
