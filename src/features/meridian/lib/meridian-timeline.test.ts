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

test("parseMeridianEventId REJECTS an id whose date is not a date", () => {
  // The exact shape that produced a HTTP 200 with a half-populated brief on production
  // (2026-08-18): trailing garbage on the date. `pack.history` survived because the pack path
  // slices to 10 chars; the enrichment path fed the raw string into date arithmetic and served
  // an empty print history, which reads as "this company has no earnings history".
  assert.equal(parseMeridianEventId("earnings:TGT:2026-08-19undefined"), null);

  for (const bad of [
    "earnings:TGT:notadate",
    "earnings:TGT:2026-8-19", // unpadded — not the format every downstream comparison assumes
    "earnings:TGT:",
    "macro:2026-08-19undefined:CPI",
    "opex:2026-08-21x",
    "fda:MRNA:20260815",
  ]) {
    assert.equal(parseMeridianEventId(bad), null, `expected null for ${bad}`);
  }
});

test("parseMeridianEventId still accepts every well-formed id", () => {
  // The guard must reject garbage WITHOUT narrowing the real surface — a ticker with a dot or a
  // digit, and a macro slug that itself contains colons, all remain valid.
  assert.equal(parseMeridianEventId("earnings:BRK.B:2026-08-19")?.ticker, "BRK.B");
  assert.equal(parseMeridianEventId("earnings:tgt:2026-08-19")?.ticker, "TGT");
  assert.equal(parseMeridianEventId("macro:2026-08-12:CPI:CORE")?.slug, "CPI:CORE");
  assert.equal(parseMeridianEventId("opex:2026-08-21")?.date, "2026-08-21");
  assert.equal(parseMeridianEventId("fda:MRNA:2026-08-15")?.date, "2026-08-15");
});
