import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  monthlyExpiryYmd,
  priorOpexDates,
  thirdFridayYmd,
  upcomingOpexDates,
} from "./meridian-timeline";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";

describe("monthly OpEx rolls back off a holiday third Friday", () => {
  test("the live defect: 2026-06-19 is Juneteenth, so June's expiry is Thursday the 18th", () => {
    // Measured on prod 2026-08-21: the prior-OpEx panel carried a 2026-06-19 row that was
    // permanently null — no close, no session move — because the market was shut. Polygon's
    // I:SPX bars run 06-18 → 06-22 with nothing between.
    assert.equal(thirdFridayYmd(2026, 6), "2026-06-19", "the raw third Friday is unchanged");
    assert.equal(isTradingDayEt("2026-06-19"), false, "…and it is not a trading day");
    assert.equal(monthlyExpiryYmd(2026, 6), "2026-06-18");
  });

  test("the panel now carries the REAL June expiry, not the phantom", () => {
    // The worse half of the defect was never the dud row — it was that the genuine expiry was
    // missing from the history entirely, so pin accuracy graded over a set with a hole in it.
    const prior = priorOpexDates("2026-09-18", 6);
    assert.ok(prior.includes("2026-06-18"), `real June expiry missing: ${prior.join(" ")}`);
    assert.ok(!prior.includes("2026-06-19"), `phantom expiry still present: ${prior.join(" ")}`);
    assert.equal(prior.length, 6, "still six rows — the fix replaces, it does not drop");
  });

  test("every date either generator emits is a trading day", () => {
    // The property that matters, asserted over a wide span rather than the two known cases.
    for (const before of ["2026-09-18", "2027-01-15", "2027-09-17"]) {
      for (const d of priorOpexDates(before, 12)) {
        assert.equal(isTradingDayEt(d), true, `priorOpexDates(${before}) emitted non-trading ${d}`);
      }
    }
    for (const d of upcomingOpexDates("2026-06-01", 400)) {
      assert.equal(isTradingDayEt(d), true, `upcomingOpexDates emitted non-trading ${d}`);
    }
  });

  test("an ordinary month is untouched — this must not shift 58 of 60 expiries", () => {
    for (const [y, m, want] of [
      [2026, 7, "2026-07-17"],
      [2026, 8, "2026-08-21"],
      [2026, 9, "2026-09-18"],
      [2026, 3, "2026-03-20"],
      [2026, 12, "2026-12-18"],
    ] as Array<[number, number, string]>) {
      assert.equal(monthlyExpiryYmd(y, m), want, `${y}-${m}`);
      assert.equal(monthlyExpiryYmd(y, m), thirdFridayYmd(y, m), `${y}-${m} should be unrolled`);
    }
  });

  test("2027 Juneteenth rolls too — this recurs, it is not a one-off patch", () => {
    assert.equal(thirdFridayYmd(2027, 6), "2027-06-18");
    assert.equal(isTradingDayEt("2027-06-18"), false);
    assert.equal(monthlyExpiryYmd(2027, 6), "2027-06-17");
  });

  test("a malformed month yields empty rather than a fabricated date", () => {
    assert.equal(monthlyExpiryYmd(2026, 13), "");
    assert.equal(monthlyExpiryYmd(2026, 0), "");
  });
});
