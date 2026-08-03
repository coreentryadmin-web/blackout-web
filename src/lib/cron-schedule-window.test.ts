import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInOffScheduleIdleGap,
  lastExpectedCronFireUtc,
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

  it("spx-signal-weight-optimize: off-window gap between weekday 22:00 UTC fires", () => {
    const cron = "0 22 * * 1-5";
    const now = new Date("2026-08-03T20:41:00.000Z"); // Mon — ops #1550 false positive
    assert.equal(isInOffScheduleIdleGap(cron, now), true);
    const last = lastExpectedCronFireUtc(cron, now);
    const next = nextExpectedCronFireUtc(cron, now);
    assert.equal(last?.toISOString(), "2026-07-31T22:00:00.000Z");
    assert.equal(next?.toISOString(), "2026-08-03T22:00:00.000Z");
  });

  it("spx-signal-weight-optimize: at scheduled fire time is not idle", () => {
    const cron = "0 22 * * 1-5";
    const now = new Date("2026-08-03T22:00:00.000Z");
    assert.equal(isInOffScheduleIdleGap(cron, now), false);
  });
});
