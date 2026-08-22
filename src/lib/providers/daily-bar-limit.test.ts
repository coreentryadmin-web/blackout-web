import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dailyBarLimitForWindow } from "./polygon";

/**
 * These numbers are the ones MEASURED against production on 2026-08-22, not invented ones — each
 * case is a window that was actually shipping with a cap too small for it.
 */
describe("a daily-bar cap is derived from the window, never fixed", () => {
  test("the three live truncations are all covered", () => {
    // swing-active-refresh / swing-discovery: 200 calendar days, 139 sessions available, cap was 60.
    assert.ok(dailyBarLimitForWindow("2026-02-03", "2026-08-22") >= 139);
    // nighthawk market-wide: 45 calendar days, 33 sessions available, cap was 30.
    assert.ok(dailyBarLimitForWindow("2026-07-08", "2026-08-22") >= 33);
    // meridian-reaction: the original ~380-day/120 bug, 262 sessions available.
    assert.ok(dailyBarLimitForWindow("2025-08-07", "2026-08-22") >= 262);
  });

  test("it exceeds the trading sessions a window can physically hold", () => {
    // 0.7 is above 5/7 (0.714 sessions per calendar day)? No — it is BELOW it, so the +10 is what
    // carries short windows. Assert the property that matters rather than the constants.
    for (const days of [5, 16, 45, 120, 200, 380, 1000]) {
      const from = new Date(Date.UTC(2026, 0, 1));
      const to = new Date(Date.UTC(2026, 0, 1) + days * 86_400_000);
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      const maxSessions = Math.ceil(days * (5 / 7)); // every weekday a session, no holidays
      const cap = dailyBarLimitForWindow(ymd(from), ymd(to));
      assert.ok(cap >= maxSessions, `${days}d: cap ${cap} < ${maxSessions} possible sessions`);
    }
  });

  test("a malformed or inverted window falls back rather than requesting the world", () => {
    assert.equal(dailyBarLimitForWindow("not-a-date", "2026-08-22"), 120);
    assert.equal(dailyBarLimitForWindow("2026-08-22", "2026-08-22"), 120);
    assert.equal(dailyBarLimitForWindow("2026-08-22", "2026-08-01"), 120);
  });

  test("it is bounded at both ends", () => {
    assert.equal(dailyBarLimitForWindow("2026-08-20", "2026-08-22"), 120, "short windows floor at 120");
    assert.equal(dailyBarLimitForWindow("1990-01-01", "2026-08-22"), 5000, "and cannot exceed 5000");
  });
});
