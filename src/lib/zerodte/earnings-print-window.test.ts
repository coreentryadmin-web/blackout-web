import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPrintWindow, etMinutesFromTime } from "./earnings-print-window";

const TODAY = "2026-08-20";
const NOON = 12 * 60;

test("etMinutesFromTime: parses HH:MM[:SS], rejects anything it cannot trust", () => {
  assert.equal(etMinutesFromTime("16:20:00"), 980);
  assert.equal(etMinutesFromTime("09:30"), 570);
  assert.equal(etMinutesFromTime("00:00:00"), 0);
  assert.equal(etMinutesFromTime(null), null);
  assert.equal(etMinutesFromTime(""), null);
  assert.equal(etMinutesFromTime("garbage"), null);
  // Out-of-range must be rejected, not silently wrapped into a plausible-looking minute.
  assert.equal(etMinutesFromTime("25:00"), null);
  assert.equal(etMinutesFromTime("12:99"), null);
});

test("AFTER-CLOSE: a confirmed 16:00+ print cannot threaten a 0DTE that is already flat", () => {
  const a = assessPrintWindow(
    { date: TODAY, time: "16:20:00", dateStatus: "confirmed" },
    TODAY,
    NOON
  );
  assert.equal(a.verdict, "after_close");
  assert.equal(a.threatensToday, false);
  assert.match(a.reason, /already flat/);
  assert.equal(a.minutesUntil, 980 - NOON);

  // The close itself counts as after-close: a 0DTE expires AT 16:00.
  assert.equal(
    assessPrintWindow({ date: TODAY, time: "16:00:00", dateStatus: "confirmed" }, TODAY, NOON)
      .verdict,
    "after_close"
  );
});

test("INTRADAY: a confirmed mid-session print is the dangerous case and stays blocked", () => {
  const a = assessPrintWindow(
    { date: TODAY, time: "13:00:00", dateStatus: "confirmed" },
    TODAY,
    NOON
  );
  assert.equal(a.verdict, "intraday");
  assert.equal(a.threatensToday, true);
  assert.match(a.reason, /INSIDE the cash session/);
});

test("PRE-OPEN: landed is exempt, still-pending is not — the boundary is `now`, not the clock face", () => {
  const landed = assessPrintWindow(
    { date: TODAY, time: "07:00:00", dateStatus: "confirmed" },
    TODAY,
    NOON // it is already noon; the 07:00 print happened
  );
  assert.equal(landed.verdict, "pre_open_landed");
  assert.equal(landed.threatensToday, false);
  assert.ok(landed.minutesUntil! < 0, "already landed => negative countdown");

  const pending = assessPrintWindow(
    { date: TODAY, time: "07:00:00", dateStatus: "confirmed" },
    TODAY,
    6 * 60 // 06:00 — the print is still an hour out
  );
  assert.equal(pending.verdict, "pre_open_pending");
  assert.equal(pending.threatensToday, true, "an unlanded gap is still ahead of us");

  // 09:30 is the open — a print AT the open is still pre-open, not intraday.
  assert.equal(
    assessPrintWindow({ date: TODAY, time: "09:30:00", dateStatus: "confirmed" }, TODAY, NOON)
      .verdict,
    "pre_open_landed"
  );
});

test("FAIL-CLOSED: a PROJECTED date never earns the after-close exemption", () => {
  // Same 16:20 print that is exempt when confirmed — but Benzinga guessed the date, so the time
  // carries that uncertainty and the exemption (which rests on knowing the position is flat first)
  // does not apply.
  const a = assessPrintWindow(
    { date: TODAY, time: "16:20:00", dateStatus: "projected" },
    TODAY,
    NOON
  );
  assert.equal(a.verdict, "unknown");
  assert.equal(a.threatensToday, true);
  assert.match(a.reason, /projected/);
});

test("FAIL-CLOSED: an untimed print today is threatening, never assumed safe", () => {
  for (const time of [null, undefined, "", "garbage"]) {
    const a = assessPrintWindow({ date: TODAY, time, dateStatus: "confirmed" }, TODAY, NOON);
    assert.equal(a.verdict, "unknown", `time=${String(time)}`);
    assert.equal(a.threatensToday, true);
    assert.equal(a.minutesUntil, null);
  }
});

test("FAIL-CLOSED: a row with no readable DATE is treated as today, not as another day", () => {
  // The date-based exemption is the only one that works without a time, so it must not fire on a
  // missing/garbage date — that would exempt every malformed row.
  const a = assessPrintWindow({ date: null, time: null, dateStatus: "confirmed" }, TODAY, NOON);
  assert.equal(a.threatensToday, true);
  const b = assessPrintWindow({ date: "not-a-date", time: null, dateStatus: "confirmed" }, TODAY, NOON);
  assert.equal(b.threatensToday, true);
});

test("ANOTHER DAY: settled by the date alone, with or without a time", () => {
  const a = assessPrintWindow(
    { date: "2026-08-25", time: null, dateStatus: "projected" },
    TODAY,
    NOON
  );
  assert.equal(a.verdict, "after_close");
  assert.equal(a.threatensToday, false);
  assert.match(a.reason, /not today/);
});

test("the classifier is PURE — same inputs, same verdict, no clock reads", () => {
  const input = { date: TODAY, time: "16:20:00", dateStatus: "confirmed" } as const;
  const a = assessPrintWindow(input, TODAY, NOON);
  const b = assessPrintWindow(input, TODAY, NOON);
  assert.deepEqual(a, b);
  // And `now` genuinely moves the answer where it should: the same pre-open print flips verdict
  // either side of its own print time, which is the only time-dependence in the module.
  assert.notEqual(
    assessPrintWindow({ date: TODAY, time: "07:00", dateStatus: "confirmed" }, TODAY, 6 * 60).verdict,
    assessPrintWindow({ date: TODAY, time: "07:00", dateStatus: "confirmed" }, TODAY, 8 * 60).verdict
  );
});
