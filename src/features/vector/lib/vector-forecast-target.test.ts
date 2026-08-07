import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDaysBetween,
  nearestForwardExpiry,
  resolveForecastTarget,
  tradingMinutesBetween,
  RTH_CLOSE_ET_MIN,
  RTH_OPEN_ET_MIN,
  RTH_SESSION_MIN,
} from "./vector-forecast-target";

// 2026-08-03 Mon … 08-07 Fri, 08-08/09 weekend, 08-10 Mon. Weekends only — a holiday behaves
// identically (both are just "not a trading day" to this module).
const isTradingDay = (ymd: string) => {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
};
const NOON = 12 * 60;
const NOW = Date.parse("2026-08-04T16:00:00Z"); // Tue 12:00 ET
const opts = (over: Partial<Parameters<typeof resolveForecastTarget>[0]> = {}) => ({
  kind: "expiry" as const,
  nowMs: NOW,
  etMinuteOfDay: NOON,
  sessionYmd: "2026-08-04",
  expiries: ["2026-08-07", "2026-08-14"],
  isTradingDay,
  ...over,
});

test("tradingMinutesBetween: same day counts only the RTH slice", () => {
  assert.equal(tradingMinutesBetween("2026-08-04", NOON, "2026-08-04", RTH_CLOSE_ET_MIN, isTradingDay), 240);
  assert.equal(
    tradingMinutesBetween("2026-08-04", RTH_OPEN_ET_MIN, "2026-08-04", RTH_CLOSE_ET_MIN, isTradingDay),
    RTH_SESSION_MIN
  );
});

test("tradingMinutesBetween: endpoints clamp into the session", () => {
  // Pre-open "now" is worth a FULL session, not "a few extra minutes"; post-close is worth none.
  // Without the clamp an 04:00 ET poll would inflate the window with 5.5 untradeable hours.
  assert.equal(tradingMinutesBetween("2026-08-04", 4 * 60, "2026-08-04", RTH_CLOSE_ET_MIN, isTradingDay), RTH_SESSION_MIN);
  assert.equal(tradingMinutesBetween("2026-08-04", 23 * 60, "2026-08-04", RTH_CLOSE_ET_MIN, isTradingDay), 0);
});

test("tradingMinutesBetween: weekends contribute ZERO — the whole point of a trading clock", () => {
  // Fri close → Mon close is ONE session (Monday), not three days. Calendar minutes would say 4,320.
  assert.equal(
    tradingMinutesBetween("2026-08-07", RTH_CLOSE_ET_MIN, "2026-08-10", RTH_CLOSE_ET_MIN, isTradingDay),
    RTH_SESSION_MIN
  );
  // Tue noon → Fri close: 240 today + Wed + Thu + Fri = 240 + 3·390.
  assert.equal(
    tradingMinutesBetween("2026-08-04", NOON, "2026-08-07", RTH_CLOSE_ET_MIN, isTradingDay),
    240 + 3 * RTH_SESSION_MIN
  );
});

test("tradingMinutesBetween: a backwards or absurd span yields 0 rather than spinning", () => {
  assert.equal(tradingMinutesBetween("2026-08-07", NOON, "2026-08-04", RTH_CLOSE_ET_MIN, isTradingDay), 0);
  assert.equal(tradingMinutesBetween("2020-01-01", NOON, "2030-01-01", RTH_CLOSE_ET_MIN, isTradingDay), 0);
});

test("nearestForwardExpiry ignores past expiries and dedupes", () => {
  assert.equal(nearestForwardExpiry(["2026-07-31", "2026-08-14", "2026-08-07", "2026-08-07"], "2026-08-04"), "2026-08-07");
  assert.equal(nearestForwardExpiry(["2026-08-04"], "2026-08-04"), "2026-08-04", "today counts as forward");
  assert.equal(nearestForwardExpiry(["2026-07-31"], "2026-08-04"), null, "an all-past chain has no target");
});

test("calendarDaysBetween is DST-proof (UTC-anchored across the US fall-back weekend)", () => {
  assert.equal(calendarDaysBetween("2026-10-31", "2026-11-02"), 2);
});

test("expiry target: charm window spans the real run-up, in TRADING minutes", () => {
  const t = resolveForecastTarget(opts())!;
  assert.equal(t.targetYmd, "2026-08-07");
  assert.equal(t.chainExpiry, "2026-08-07");
  assert.equal(t.tradingMinutesRemaining, 240 + 3 * RTH_SESSION_MIN);
  // Window measured from TODAY'S open, so tFrac falls monotonically as the member watches.
  assert.equal(t.horizonMin, 4 * RTH_SESSION_MIN);
  assert.equal(t.caveat, null);
});

test("synthetic closeMs puts the forecaster on the trading clock; targetCloseMs stays wall-clock", () => {
  const t = resolveForecastTarget(opts())!;
  // closeMs - nowMs IS trading minutes remaining — that is the only way to hand the forecaster a
  // trading-time tMin, since it derives tMin from that subtraction.
  assert.equal((t.closeMs - NOW) / 60_000, t.tradingMinutesRemaining);
  // The real instant is ~3 calendar days out and must NOT equal the synthetic one.
  assert.ok(t.targetCloseMs > t.closeMs, "wall-clock target is later than the trading-time target");
  assert.equal((t.targetCloseMs - NOW) / 60_000, 3 * 24 * 60 + (RTH_CLOSE_ET_MIN - NOON));
});

test("eod target on a non-expiry day is allowed but CAVEATED, and keeps the forward book's tenor", () => {
  const t = resolveForecastTarget(opts({ kind: "eod" }))!;
  assert.equal(t.targetYmd, "2026-08-04", "the cone terminates today");
  assert.equal(t.chainExpiry, "2026-08-07", "but the gamma comes from the Friday book");
  assert.equal(t.tradingMinutesRemaining, 240);
  assert.equal(t.horizonMin, RTH_SESSION_MIN, "one session's charm ramp");
  assert.match(t.caveat ?? "", /no expiry pin at this close/i);
  // Tenor tracks the CHAIN, not the target: a Friday book priced at Friday's tenor, not today's.
  assert.ok(t.structYears > 3 / 365, `structYears ${t.structYears} should reflect the 08-07 expiry`);
});

test("eod target ON an expiry day carries no caveat and collapses to the 0DTE case", () => {
  const t = resolveForecastTarget(opts({ kind: "eod", expiries: ["2026-08-04", "2026-08-07"] }))!;
  assert.equal(t.chainExpiry, "2026-08-04");
  assert.equal(t.caveat, null);
  assert.equal(t.horizonMin, RTH_SESSION_MIN);
});

test("structYears is CALENDAR time — a weekend still burns theta", () => {
  // Thu → next Mon expiry crosses a weekend: 4 calendar days, though only 2 trading sessions.
  // Charm runs on trading time, but BSM tenor must not.
  const t = resolveForecastTarget(
    opts({ sessionYmd: "2026-08-06", etMinuteOfDay: RTH_OPEN_ET_MIN, expiries: ["2026-08-10"] })
  )!;
  assert.ok(t.structYears >= 4 / 365, `structYears ${t.structYears} must span the calendar gap, not 2 sessions`);
  assert.equal(t.horizonMin, 3 * RTH_SESSION_MIN, "Thu + Fri + Mon sessions");
});

test("returns null rather than fabricating a target", () => {
  // No forward expiry at all.
  assert.equal(resolveForecastTarget(opts({ expiries: ["2026-07-31"] })), null);
  assert.equal(resolveForecastTarget(opts({ expiries: [] })), null);
  // After the close on the target day — zero trading minutes left, so there is nothing to project.
  assert.equal(resolveForecastTarget(opts({ kind: "eod", etMinuteOfDay: 23 * 60, expiries: ["2026-08-04"] })), null);
  // Garbage inputs.
  assert.equal(resolveForecastTarget(opts({ nowMs: Number.NaN })), null);
  assert.equal(resolveForecastTarget(opts({ sessionYmd: "" })), null);
});

test("horizonMin is never smaller than the minutes remaining", () => {
  // Guards the ratio the forecaster divides by: tFrac = tMin/horizonMin must never exceed 1 before
  // its own clamp, or the charm ramp would start out of range on an odd session.
  for (const etMin of [0, RTH_OPEN_ET_MIN, NOON, RTH_CLOSE_ET_MIN - 1]) {
    for (const kind of ["eod", "expiry"] as const) {
      const t = resolveForecastTarget(opts({ kind, etMinuteOfDay: etMin }));
      if (!t) continue;
      assert.ok(t.horizonMin >= t.tradingMinutesRemaining, `${kind}@${etMin}: ${t.horizonMin} < ${t.tradingMinutesRemaining}`);
      assert.ok(t.structYears > 0 && Number.isFinite(t.structYears));
    }
  }
});
