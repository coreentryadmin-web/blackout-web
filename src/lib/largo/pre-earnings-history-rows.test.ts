import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { toPreEarningsHistoryRows, type PrintHistoryInput } from "./pre-earnings-history-rows";

/** Shaped like a real `loadMeridianEarningsPrintHistory` row, newest first. */
const PRINTS: PrintHistoryInput[] = [
  {
    report_date: "2026-08-20",
    surprise_pct: -31.9,
    beat: false,
    expected_move_pct: null,
    session_change_pct: 3.51,
    next_day_change_pct: -0.42,
    reaction_basis: "bmo_session",
  },
  {
    report_date: "2026-05-13",
    surprise_pct: -92,
    beat: false,
    expected_move_pct: 4.2,
    session_change_pct: 7.41,
    next_day_change_pct: 1.05,
    reaction_basis: "amc_next_session",
  },
  {
    report_date: "2026-03-19",
    surprise_pct: -41.6,
    beat: false,
    expected_move_pct: null,
    session_change_pct: 3.01,
    next_day_change_pct: null,
    reaction_basis: "assumed_report_session",
  },
];

describe("toPreEarningsHistoryRows: the projection must not drop the reaction", () => {
  test("the move and its basis survive — the exact fields the old inline map discarded", () => {
    // The pack used to keep only { report_date, surprise_pct, beat, expected_move_pct }, so the
    // Largo path got prints with NO move on them while history_summary still asserted an
    // "avg session move" computed from these very numbers.
    const rows = toPreEarningsHistoryRows(PRINTS);

    assert.equal(rows[0].session_change_pct, 3.51);
    assert.equal(rows[0].next_day_change_pct, -0.42);
    assert.equal(rows[0].reaction_basis, "bmo_session");
    assert.equal(rows[1].session_change_pct, 7.41);
    assert.equal(rows[1].reaction_basis, "amc_next_session");
  });

  test("an ASSUMED anchoring is flagged — the model's equivalent of the UI's tilde", () => {
    // 7.41% vs 3.01% on one real print is the measured cost of getting this wrong. An assumed
    // basis on an AMC reporter is pre-print DRIFT, not a reaction, so it must not read as one.
    const rows = toPreEarningsHistoryRows(PRINTS);

    assert.equal(rows[2].reaction_basis, "assumed_report_session");
    assert.equal(rows[2].reaction_assumed, true);
    // A known basis is never flagged.
    assert.equal(rows[0].reaction_assumed, false);
    assert.equal(rows[1].reaction_assumed, false);
  });

  test("an assumed basis with NO measured move is not flagged as assumed", () => {
    // Nothing was measured, so there is no value for the caveat to be about. Flagging it would
    // invent a qualification on a number that does not exist.
    const rows = toPreEarningsHistoryRows([
      { report_date: "2026-01-01", reaction_basis: "assumed_report_session", session_change_pct: null },
    ]);
    assert.equal(rows[0].reaction_assumed, false);
    assert.equal(rows[0].session_change_pct, null);
  });

  test("the EPS columns the old projection did keep are still carried", () => {
    const rows = toPreEarningsHistoryRows(PRINTS);
    assert.equal(rows[0].report_date, "2026-08-20");
    assert.equal(rows[0].surprise_pct, -31.9);
    assert.equal(rows[0].beat, false);
    assert.equal(rows[1].expected_move_pct, 4.2);
  });

  test("every field is present and null-normalized, never undefined", () => {
    // An absent key and a null one read the same to a model, but only one survives JSON.
    const rows = toPreEarningsHistoryRows([{ report_date: "2026-08-20" }]);
    const expected = [
      "report_date",
      "report_weekday",
      "surprise_pct",
      "beat",
      "expected_move_pct",
      "reaction_pct",
      "reaction_measure",
      "reaction_settled",
      "session_change_pct",
      "next_day_change_pct",
      "reaction_basis",
      "reaction_assumed",
    ];
    assert.deepEqual(Object.keys(rows[0]).sort(), [...expected].sort());
    for (const k of expected) {
      assert.notEqual(
        (rows[0] as Record<string, unknown>)[k],
        undefined,
        `${k} must be null, not undefined`
      );
    }
    assert.equal(JSON.parse(JSON.stringify(rows[0])).session_change_pct, null);
  });

  test("order is preserved and the cap applies", () => {
    const rows = toPreEarningsHistoryRows(PRINTS, 2);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.report_date), ["2026-08-20", "2026-05-13"]);
  });

  test("empty, null and undefined input all give an empty list, never a throw", () => {
    assert.deepEqual(toPreEarningsHistoryRows([]), []);
    assert.deepEqual(toPreEarningsHistoryRows(null), []);
    assert.deepEqual(toPreEarningsHistoryRows(undefined), []);
    assert.deepEqual(toPreEarningsHistoryRows(PRINTS, 0), []);
    assert.deepEqual(toPreEarningsHistoryRows(PRINTS, -3), []);
  });
});

describe("weekday travels with every report date", () => {
  test("the report date's ET weekday is carried, so BMO/AMC reasoning need not infer it", () => {
    // In production a model called 2026-08-18 a Monday. It is a Tuesday. BMO/AMC reasoning is
    // weekday reasoning — the session that trades an after-close FRIDAY print is Monday, not
    // Saturday — so the weekday has to travel with the date rather than be re-derived.
    const rows = toPreEarningsHistoryRows([
      { report_date: "2026-08-18" }, // Tuesday
      { report_date: "2026-08-21" }, // Friday
      { report_date: "2026-08-20" }, // Thursday
    ]);
    assert.equal(rows[0].report_weekday, "Tuesday");
    assert.equal(rows[1].report_weekday, "Friday");
    assert.equal(rows[2].report_weekday, "Thursday");
  });

  test("a row with no report date carries no weekday, rather than a fabricated one", () => {
    const rows = toPreEarningsHistoryRows([{ report_date: null }]);
    assert.equal(rows[0].report_weekday, null);
  });

  test("the weekday is ET, not UTC — the two disagree for a whole evening every day", () => {
    // Parsing "YYYY-MM-DD" alone is UTC midnight, which lands on the PREVIOUS ET day and would
    // report the wrong weekday for every date. weekdayEt anchors at noon for exactly this reason.
    const rows = toPreEarningsHistoryRows([{ report_date: "2026-01-01" }]);
    assert.equal(rows[0].report_weekday, "Thursday");
  });
});

test("the pack row carries the REACTION, and says how it was read", () => {
  // A post-close print that gapped up then faded. The two numbers disagree in sign, so a row
  // that carried only `session_change_pct` would tell the model the stock fell on a print it
  // rose on. Both travel, and `reaction_measure` says which is which.
  const rows = toPreEarningsHistoryRows([
    {
      report_date: "2026-05-14",
      reaction_pct: 7,
      reaction_measure: "prior_close_to_close",
      session_change_pct: -1.83,
      next_day_change_pct: -0.93,
      reaction_basis: "amc_next_session",
    },
  ]);

  assert.equal(rows[0].reaction_pct, 7);
  assert.equal(rows[0].reaction_measure, "prior_close_to_close");
  assert.equal(rows[0].session_change_pct, -1.83, "still carried — it is a real quantity");
  assert.equal(rows[0].reaction_assumed, false);
});

test("a print with no reaction at all claims neither a measure nor an assumption", () => {
  const rows = toPreEarningsHistoryRows([
    { report_date: "2026-05-14", reaction_basis: null, reaction_pct: null, session_change_pct: null },
  ]);
  assert.equal(rows[0].reaction_pct, null);
  assert.equal(rows[0].reaction_measure, null);
  assert.equal(rows[0].reaction_assumed, false);
});

test("an unsettled reaction reaches the model flagged, not disguised as settled history", () => {
  // Measured on prod 2026-08-21 at 09:46 ET: today's BMO prints arrived as
  // `reaction_measure: "session_open_to_close"` sixteen minutes into a session closing at 16:00,
  // with no provisional marker anywhere. The model had no way to tell a still-moving number from
  // a print three quarters old, which is the difference between context and a false comparison.
  const rows = toPreEarningsHistoryRows([
    {
      report_date: "2026-08-21",
      reaction_pct: -4.74,
      reaction_measure: "session_open_to_last",
      reaction_settled: false,
      reaction_basis: "bmo_session",
      session_change_pct: -4.74,
    },
    {
      report_date: "2026-05-20",
      reaction_pct: -1.77,
      reaction_measure: "prior_close_to_close",
      reaction_settled: true,
      reaction_basis: "amc_next_session",
      session_change_pct: -1.25,
    },
  ]);

  assert.equal(rows[0].reaction_settled, false, "today's print is still moving");
  assert.equal(rows[0].reaction_measure, "session_open_to_last");
  assert.equal(rows[1].reaction_settled, true, "a settled print is unaffected");
  assert.equal(rows[1].reaction_measure, "prior_close_to_close");

  // Both survive JSON — an absent key and a false one read very differently to a model.
  assert.equal(JSON.parse(JSON.stringify(rows[0])).reaction_settled, false);
});
