import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { activeLegacyEditionDates } from "./legacy-edition-dates";

describe("legacy-edition-dates", () => {
  test("evening publish window includes today and next trading day", () => {
    const dates = activeLegacyEditionDates(new Date("2026-09-02T22:00:00Z"));
    assert.deepEqual(dates, ["2026-09-02", "2026-09-03"]);
  });

  test("RTH session day includes today and next trading day", () => {
    const dates = activeLegacyEditionDates(new Date("2026-09-03T15:00:00Z"));
    assert.deepEqual(dates, ["2026-09-03", "2026-09-04"]);
  });
});
