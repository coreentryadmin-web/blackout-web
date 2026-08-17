import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMeridianTimeline,
  daysUntilEt,
  parseMeridianEventId,
  priorOpexDates,
  thirdFridayYmd,
  upcomingOpexDates,
} from "./meridian-timeline";

test("daysUntilEt: same day is 0, tomorrow is 1", () => {
  assert.equal(daysUntilEt("2026-08-16", "2026-08-16"), 0);
  assert.equal(daysUntilEt("2026-08-17", "2026-08-16"), 1);
});

test("thirdFridayYmd: August 2026 third Friday", () => {
  assert.equal(thirdFridayYmd(2026, 8), "2026-08-21");
});

test("buildMeridianTimeline: merges macro + earnings + fda sorted by date", () => {
  const items = buildMeridianTimeline({
    todayYmd: "2026-08-10",
    daysAhead: 14,
    macro: [
      { event: "CPI", date: "2026-08-12", time: "08:30", impact: "high" },
      { event: "FOMC Decision", date: "2026-08-20", time: "14:00", impact: "high" },
    ],
    earnings: [
      {
        ticker: "NVDA",
        name: "NVIDIA",
        report_date: "2026-08-14",
        when: "afterhours",
        expected_move_pct: 8.2,
      },
    ],
    fda: [
      {
        ticker: "MRNA",
        date: "2026-08-15",
        drug: "mRNA-1283",
        indication: "RSV vaccine",
        event_label: "PDUFA",
      },
    ],
    includeOpex: false,
  });
  assert.equal(items.length, 4);
  assert.equal(items[0]!.kind, "macro");
  assert.equal(items[1]!.kind, "earnings");
  assert.equal(items[2]!.kind, "fda");
});

test("parseMeridianEventId: macro, earnings, opex, fda", () => {
  assert.deepEqual(parseMeridianEventId("macro:2026-08-12:CPI"), {
    kind: "macro",
    date: "2026-08-12",
    slug: "CPI",
  });
  assert.deepEqual(parseMeridianEventId("earnings:NVDA:2026-08-14"), {
    kind: "earnings",
    date: "2026-08-14",
    ticker: "NVDA",
  });
  assert.deepEqual(parseMeridianEventId("opex:2026-08-21"), {
    kind: "opex",
    date: "2026-08-21",
  });
  assert.deepEqual(parseMeridianEventId("fda:MRNA:2026-08-15"), {
    kind: "fda",
    date: "2026-08-15",
    ticker: "MRNA",
  });
});

test("upcomingOpexDates: includes third Friday within window", () => {
  const dates = upcomingOpexDates("2026-08-01", 30);
  assert.ok(dates.includes("2026-08-21"));
});

test("priorOpexDates: walks back monthly third Fridays", () => {
  const dates = priorOpexDates("2026-08-21", 3);
  assert.ok(dates.every((d) => d < "2026-08-21"));
  assert.equal(dates.length, 3);
  assert.equal(dates[0], thirdFridayYmd(2026, 7));
});
