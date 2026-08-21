import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MERIDIAN_LARGO_WINDOW_DAYS,
  normalizeDaysAhead,
  normalizeImpact,
  normalizeKind,
  normalizeLimit,
  shapeTimelineItems,
  timelineInterpretation,
  toLargoTimelineItem,
} from "./meridian-timeline-for-largo";

/** Shaped like real timeline items, taken from a live 2026-08-21 read. */
const RAW = [
  { id: "macro:2026-08-21:US-Flash-Services-PMI", kind: "macro", title: "US Flash Services PMI", subtitle: "US macro", date: "2026-08-21", time: "09:45", impact: "medium", days_until: 0, ticker: null },
  { id: "opex:2026-08-21", kind: "opex", title: "August OpEx", subtitle: null, date: "2026-08-21", time: "16:00", impact: "high", days_until: 0, ticker: null },
  { id: "earnings:BJ:2026-08-21", kind: "earnings", title: "BJ earnings", date: "2026-08-21", time: "07:00", impact: "low", days_until: 0, ticker: "BJ", date_status: "confirmed", importance: 2, is_printed: false, expected_move_pct: 6.1, sector_label: "Retail" },
  { id: "earnings:NVDA:2026-08-26", kind: "earnings", title: "NVDA earnings", date: "2026-08-26", time: "16:20", impact: "high", days_until: 5, ticker: "NVDA", date_status: "confirmed", importance: 5, is_printed: false, expected_move_pct: 5.33, sector_label: "Semis & Electronics" },
  { id: "earnings:CRM:2026-09-03", kind: "earnings", title: "CRM earnings", date: "2026-09-03", time: "16:05", impact: "medium", days_until: 13, ticker: "CRM" },
  { id: "earnings:LATE:2026-09-25", kind: "earnings", title: "LATE earnings", date: "2026-09-25", time: null, impact: "high", days_until: 35, ticker: "LATE" },
];

const F = (over: Partial<Parameters<typeof shapeTimelineItems>[1]> = {}) => ({
  kind: null, impact: null, ticker: null, daysAhead: 21, ...over,
});

describe("shapeTimelineItems", () => {
  test("the fetch window and the ASKED-FOR window are different, and the ask is what filters", () => {
    // The tool always fetches 21 days so it hits the key cron/meridian-warm populates; narrowing
    // to the caller's window happens here. A 7-day ask must not leak the 13- and 35-day items.
    const out = shapeTimelineItems(RAW, F({ daysAhead: 7 }), 40);
    assert.deepEqual(out.items.map((i) => i.ticker), [null, null, "BJ", "NVDA"]);
    assert.ok(out.items.every((i) => i.days_until <= 7));
    assert.equal(MERIDIAN_LARGO_WINDOW_DAYS, 21, "must match DEFAULT_WARM_DAYS or the cache misses");

    // The 35-day row is reachable when the window is actually widened — proving the exclusions
    // elsewhere in this file are the window doing its job, not the fixture being short.
    const wide = shapeTimelineItems(RAW, F({ daysAhead: 40 }), 40);
    assert.equal(wide.items.length, 6);
    assert.equal(wide.items.at(-1)!.ticker, "LATE");
  });

  test("impact means THAT BAR OR ABOVE — asking for medium must not hide the high-impact events", () => {
    // The trap this avoids: an equality filter on `medium` returns the PMI and hides OpEx and
    // NVDA, so a member asking for 'medium and above' gets the least important events only.
    // LATE (high, 35d) is outside the 21-day default window, so it is absent from both.
    const med = shapeTimelineItems(RAW, F({ impact: "medium" }), 40);
    assert.deepEqual(med.items.map((i) => i.impact), ["high", "medium", "high", "medium"]);
    assert.equal(med.items.some((i) => i.impact === "low"), false, "low must be excluded");

    const high = shapeTimelineItems(RAW, F({ impact: "high" }), 40);
    assert.ok(high.items.every((i) => i.impact === "high"));
    assert.deepEqual(high.items.map((i) => i.id), ["opex:2026-08-21", "earnings:NVDA:2026-08-26"]);
  });

  test("sorted by date, then impact descending — 'what matters next' reads off the top", () => {
    const out = shapeTimelineItems(RAW, F(), 40);
    const sameDay = out.items.filter((i) => i.date === "2026-08-21");
    assert.deepEqual(sameDay.map((i) => i.impact), ["high", "medium", "low"]);
    const dates = out.items.map((i) => i.date);
    assert.deepEqual(dates, [...dates].sort(), "dates must be ascending");
  });

  test("a truncation is REPORTED, never silent", () => {
    // A capped list that looks complete is the same defect as a rate without its denominator.
    const out = shapeTimelineItems(RAW, F(), 2);
    assert.equal(out.items.length, 2);
    assert.equal(out.total_matched, 5, "5 of the 6 fixture rows are inside the 21-day window");
    assert.equal(out.truncated, true);

    const all = shapeTimelineItems(RAW, F(), 40);
    assert.equal(all.truncated, false);
    assert.equal(all.total_matched, all.items.length);
  });

  test("ticker filter is case-insensitive and never matches a null ticker", () => {
    const out = shapeTimelineItems(RAW, F({ ticker: "nvda" }), 40);
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0]!.id, "earnings:NVDA:2026-08-26");
    assert.equal(shapeTimelineItems(RAW, F({ ticker: "" }), 40).items.length, 5, "empty ticker is no filter");
  });

  test("every field is present and null-normalized, never undefined", () => {
    // An absent key and a null one read the same to a model; only one survives JSON.
    const item = toLargoTimelineItem(RAW[4]!);
    for (const [k, v] of Object.entries(item)) assert.notEqual(v, undefined, `${k} must be null, not undefined`);
    assert.equal(item.expected_move_pct, null, "no implied move on file is null, not 0");
    assert.equal(item.is_printed, null);
    assert.equal(JSON.parse(JSON.stringify(item)).sector_label, null);
  });

  test("empty and missing input give an empty list, never a throw", () => {
    for (const v of [[], null, undefined]) {
      const out = shapeTimelineItems(v, F(), 40);
      assert.deepEqual(out.items, []);
      assert.equal(out.total_matched, 0);
      assert.equal(out.truncated, false);
    }
  });
});

describe("argument normalization: a bad argument narrows, it never empties", () => {
  test("an unrecognised kind or impact is NO filter, not an impossible one", () => {
    // Returning zero rows for a typo would read as "nothing is scheduled", which is a lie about
    // the market rather than about the argument.
    assert.equal(normalizeKind("Earnings"), "earnings");
    assert.equal(normalizeKind("banana"), null);
    assert.equal(normalizeKind(undefined), null);
    assert.equal(normalizeImpact("HIGH"), "high");
    assert.equal(normalizeImpact("critical"), null);
    assert.equal(shapeTimelineItems(RAW, F({ kind: normalizeKind("banana") }), 40).items.length, 5);
  });

  test("the window and the limit clamp rather than throw or fetch the world", () => {
    assert.equal(normalizeDaysAhead(400), 30);
    assert.equal(normalizeDaysAhead(0), 1);
    assert.equal(normalizeDaysAhead(-5), 1);
    assert.equal(normalizeDaysAhead("banana"), 7);
    assert.equal(normalizeDaysAhead(undefined), 7);
    assert.equal(normalizeDaysAhead(14), 14);
    assert.equal(normalizeLimit(9999), 200);
    assert.equal(normalizeLimit(0), 1);
    assert.equal(normalizeLimit("x"), 40);
  });
});

test("the interpretation states what the payload cannot show on its own", () => {
  const s = timelineInterpretation(412);
  assert.match(s, /ET \(America\/New_York\)/, "the model must not read the date as UTC");
  assert.match(s, /get_meridian_event/, "the id has to be usable");
  assert.match(s, /THAT BAR OR ABOVE/, "the impact filter's semantics are not guessable");
  assert.match(s, /412 rows/, "a dropped field must say it was dropped, and how big it was");
  assert.match(s, /null means .* not that the move is zero/i);
  // With nothing dropped it must not claim a row count it does not have.
  assert.doesNotMatch(timelineInterpretation(0), /\d+ rows/);
});

test("an ABSENT reading is null however it arrives — null, undefined or empty string", () => {
  // The live bug this pins. `Number(null)` is 0 and `Number.isFinite(0)` is true, so a naive
  // coercion published "expected move 0%" for every name with no options-implied move on file —
  // 83 of the 90 earnings items on the 2026-08-21 timeline. An absent measurement presented as a
  // measured zero is worse than a gap, because a reader acts on it.
  //
  // All three spellings of absence are asserted because they took DIFFERENT code paths: the
  // original fixture omitted the field (undefined → NaN → null, which worked), while the live
  // payload sends an explicit null (→ 0, which did not).
  for (const absent of [null, undefined, ""]) {
    const item = toLargoTimelineItem({
      id: "earnings:NVDA:2026-08-26", kind: "earnings", title: "NVDA earnings",
      date: "2026-08-26", impact: "high", days_until: 5, ticker: "NVDA",
      expected_move_pct: absent, importance: absent, days_until_typo: absent,
    });
    assert.equal(item.expected_move_pct, null, `expected_move_pct from ${JSON.stringify(absent)}`);
    assert.equal(item.importance, null, `importance from ${JSON.stringify(absent)}`);
  }

  // A REAL zero still survives as zero — the guard must not swallow a genuine reading.
  const real = toLargoTimelineItem({
    id: "earnings:X:2026-08-26", kind: "earnings", title: "X", date: "2026-08-26",
    impact: "low", days_until: 0, ticker: "X", expected_move_pct: 0, importance: 0,
  });
  assert.equal(real.expected_move_pct, 0);
  assert.equal(real.importance, 0);
  assert.equal(real.days_until, 0, "a zero days_until is today, not missing");
});
