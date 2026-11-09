import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInOffScheduleIdleGap,
  isAwaitingSecondaryUtcBandFire,
  isBeforeTodaysScheduledCronFires,
  lastExpectedCronFireUtc,
  longIdleSinceLastHandshake,
  nextExpectedCronFireUtc,
} from "./cron-schedule-window";

describe("cron-schedule-window", () => {
  it("x-replies: off-window gap after 22:20 UTC until next weekday 13:20", () => {
    const cron = "20 13-22 * * 1-5";
    const now = new Date("2026-07-30T00:14:00.000Z"); // Wed 8:14pm ET
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-07-29T22:20:00.000Z");
    assert.equal(next?.toISOString(), "2026-07-30T13:20:00.000Z");
  });

  it("x-replies: in-window between hourly :20 fires — missed tick should not be idle", () => {
    const cron = "20 13-22 * * 1-5";
    const now = new Date("2026-07-29T14:25:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), false);
  });

  it("x-replies: before first daily fire is off-window idle", () => {
    const cron = "20 13-22 * * 1-5";
    const now = new Date("2026-07-29T12:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
  });

  it("x-growth: off-window gap after 23:30 UTC", () => {
    const cron = "0/30 13-23 * * *";
    const now = new Date("2026-07-30T00:14:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-07-29T23:30:00.000Z");
  });

  it("x-autopost: long gap between midnight and noon UTC fires", () => {
    const cron = "0 12,14,16,18,20,22,0 * * *";
    const now = new Date("2026-07-30T08:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
  });

  it("x-autopost: short gap between 12:00 and 14:00 is not idle", () => {
    const cron = "0 12,14,16,18,20,22,0 * * *";
    const now = new Date("2026-07-30T13:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), false);
  });

  it("zerodte-grade: off-window gap before 20:00 UTC weekday post-close band", () => {
    const cron = "*/15 20-22 * * 1-5";
    const now = new Date("2026-07-30T12:52:00.000Z"); // Thu 8:52 AM ET — ops #1331 false positive
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-07-29T22:45:00.000Z");
    assert.equal(next?.toISOString(), "2026-07-30T20:00:00.000Z");
  });

  it("zerodte-grade: in-window between :15 fires — missed tick should not be idle", () => {
    const cron = "*/15 20-22 * * 1-5";
    const now = new Date("2026-07-30T20:25:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), false);
  });

  it("spx-signal-weight-optimize: off-window gap Mon before 22:00 UTC after Fri run — ops #1550", () => {
    const cron = "0 22 * * 1-5";
    const now = new Date("2026-08-03T20:38:00.000Z"); // Mon 4:38 PM ET — ops #1550 false positive
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-07-31T22:00:00.000Z");
    assert.equal(next?.toISOString(), "2026-08-03T22:00:00.000Z");
  });

  it("spx-signal-weight-optimize: in-window at scheduled 22:00 UTC — missed tick should not be idle", () => {
    const cron = "0 22 * * 1-5";
    const now = new Date("2026-08-03T22:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), false);
  });

  it("gex-eod-snapshot: off-window gap Mon before 20:10 UTC after Fri run — ops #1983", () => {
    const cron = "10 20,21 * * 1-5";
    const now = new Date("2026-08-10T05:00:00.000Z"); // Mon 1:00 AM ET
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-08-07T21:10:00.000Z");
    assert.equal(next?.toISOString(), "2026-08-10T20:10:00.000Z");
  });

  it("nighthawk-backfill-repair: between 13:00 and 14:00 UTC bands awaiting in-window tick — ops 2026-11-03", () => {
    const cron = "0 13,14 * * 1-5";
    const now = new Date("2026-11-03T13:59:00.000Z"); // Mon ~8:59 AM ET (EST)
    assert.equal(isAwaitingSecondaryUtcBandFire(cron, now), true);
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
  });

  it("nighthawk-backfill-repair: after 14:00 UTC band is no longer awaiting", () => {
    const cron = "0 13,14 * * 1-5";
    const now = new Date("2026-11-03T14:05:00.000Z");
    assert.equal(isAwaitingSecondaryUtcBandFire(cron, now), false);
  });

  it("nighthawk-morning-confirm: off-window gap Mon before 13:15 UTC after Fri run — ops #1983", () => {
    const cron = "15 13,14 * * 1-5";
    const now = new Date("2026-08-10T05:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-08-07T14:15:00.000Z");
    assert.equal(next?.toISOString(), "2026-08-10T13:15:00.000Z");
  });

  it("largo-morning-brief: off-window gap before 13:25 UTC weekday fire — ops #2569", () => {
    const cron = "25 13,14 * * 1-5";
    const now = new Date("2026-08-21T12:52:00.000Z"); // Fri 8:52 AM ET
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-08-20T14:25:00.000Z");
    assert.equal(next?.toISOString(), "2026-08-21T13:25:00.000Z");
  });

  it("largo-morning-brief: in-window at scheduled 13:25 UTC — missed tick should not be idle", () => {
    const cron = "25 13,14 * * 1-5";
    const now = new Date("2026-08-21T13:25:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), false);
  });

  it("nighthawk-backfill-repair: between 13:00 and 14:00 UTC bands is schedule-idle — cron audit query false positive", () => {
    const cron = "0 13,14 * * 1-5";
    const now = new Date("2026-11-03T13:59:00.000Z"); // Tue 8:59 AM ET (EST) — before the 14:00 band
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-11-03T13:00:00.000Z");
    assert.equal(next?.toISOString(), "2026-11-03T14:00:00.000Z");
  });

  it("nighthawk-outcomes: off-window gap Mon before 20:30 UTC after Fri run — ops #1983", () => {
    const cron = "30 20,21 * * 1-5";
    const now = new Date("2026-08-10T05:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-08-07T21:30:00.000Z");
    assert.equal(next?.toISOString(), "2026-08-10T20:30:00.000Z");
  });

  // BUG: a bare "N/M" minute/hour field (no leading range or "*") is valid cron/Quartz step
  // syntax meaning "start at N, repeat every M" — e.g. "5/15" = :05, :20, :35, :50. parseIntList's
  // `stepOnly` branch matched the field but discarded the start value (group 1) and stepped from
  // the field's bare `min` instead, so "5/15" silently produced the same fires as "0/15" (:00,
  // :15, :30, :45) — a parse that looks successful (no throw, a non-empty result) but is simply
  // wrong whenever the start value isn't already equal to the field's own minimum. Every
  // registered `schedule_cron_utc` in cron-registry.ts happens to use "*/N" or "A-B/N" (whose own
  // branches already carry the start correctly) or a start of exactly 0, which is why this never
  // surfaced live — but the bare "N/M" form is still real cron syntax this same function already
  // claims to parse (the sibling `starStep`/`stepMatch` branches), so it must not silently return
  // the wrong set the moment a schedule actually uses a non-zero start.
  it("bare N/M step field honors the start value, not the field's bare minimum", () => {
    const cron = "5/15 10 * * *";
    const now = new Date("2026-07-30T10:10:00.000Z");
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-07-30T10:05:00.000Z");
    assert.equal(next?.toISOString(), "2026-07-30T10:20:00.000Z");
  });

  // BUG: a named weekday RANGE ("MON-FRI", case-insensitive) matched none of parseDow's branches
  // — not the numeric `rangeMatch` regex (letters, not digits), not the single-name `DOW_NAMES`
  // lookup (the key is the whole "MON-FRI" string, which isn't in that map) — so it fell through
  // to the bare `Number(part) % 7` branch, which is `NaN % 7` = NaN. The allowed-day Set then
  // contains only NaN, which `.has(dow)` never matches for any real 0-6 day, so
  // enumerateFiresOnUtcDay silently returns zero fires for EVERY day, forever. That is not a loud
  // failure: lastExpectedCronFireUtc/nextExpectedCronFireUtc both return null with no throw, and
  // isInOffScheduleIdleGap's `if (!bounds) return true` then reports the job as permanently
  // off-schedule-idle — the watchdog's "nothing to see here" state — for a schedule that is
  // actually supposed to fire every weekday. This form isn't hypothetical: it's the literal
  // EventBridge syntax several real crons here are described in (`cron(*/5 11-21 ? * MON-FRI *)`
  // — see heatmap-warm/uw-cache-refresh/bie-full-state-snapshot route comments), and
  // isDualBandMorningUtcSchedule a few lines below already special-cases the exact string
  // `dowField.toUpperCase() === "MON-FRI"`, proving this textual form is expected to reach this
  // file's parser, not just the numeric "1-5" every `cron-registry.ts` row happens to use today.
  it("named weekday range (MON-FRI) parses the same fires as the numeric range (1-5)", () => {
    const numeric = "0 9 * * 1-5";
    const named = "0 9 * * MON-FRI";
    const now = new Date("2026-11-04T10:00:00.000Z"); // Wednesday
    assert.equal(
      lastExpectedCronFireUtc(named, now)?.toISOString(),
      lastExpectedCronFireUtc(numeric, now)?.toISOString()
    );
    assert.equal(lastExpectedCronFireUtc(named, now)?.toISOString(), "2026-11-04T09:00:00.000Z");
    assert.equal(
      nextExpectedCronFireUtc(named, now)?.toISOString(),
      nextExpectedCronFireUtc(numeric, now)?.toISOString()
    );
    assert.equal(nextExpectedCronFireUtc(named, now)?.toISOString(), "2026-11-05T09:00:00.000Z");
  });

  it("named weekday range (TUE-THU) is honored, not silently dropped", () => {
    const cron = "0 9 * * TUE-THU";
    const wednesday = new Date("2026-11-04T10:00:00.000Z"); // Wednesday
    assert.equal(lastExpectedCronFireUtc(cron, wednesday)?.toISOString(), "2026-11-04T09:00:00.000Z");
  });

  it("isBeforeTodaysScheduledCronFires: Monday morning before post-close band", () => {
    const cron = "30 20,21 * * 1-5";
    const now = new Date("2026-11-09T15:55:00.000Z");
    assert.equal(isBeforeTodaysScheduledCronFires(cron, now), true);
    const after = new Date("2026-11-09T21:00:00.000Z");
    assert.equal(isBeforeTodaysScheduledCronFires(cron, after), false);
  });

  it("longIdleSinceLastHandshake: Friday→Monday gap is long; Monday→Tuesday is not", () => {
    const monday = new Date("2026-11-09T15:55:00.000Z");
    assert.equal(longIdleSinceLastHandshake("2026-11-07T21:15:00.000Z", monday), true);
    const tuesday = new Date("2026-11-10T15:55:00.000Z");
    assert.equal(longIdleSinceLastHandshake("2026-11-09T21:30:00.000Z", tuesday), false);
  });
});
