import { test } from "node:test";
import assert from "node:assert/strict";
import { assessPrintWindow, etMinutesFromTime } from "./print-window-eval.mjs";

const TODAY = "2026-08-28";
const MID_SESSION = 9 * 60 + 35; // 09:35 ET

test("etMinutesFromTime parses HH:MM and rejects garbage", () => {
  assert.equal(etMinutesFromTime("16:30"), 16 * 60 + 30);
  assert.equal(etMinutesFromTime("07:00:00"), 7 * 60);
  assert.equal(etMinutesFromTime(null), null);
  assert.equal(etMinutesFromTime("not-a-time"), null);
  assert.equal(etMinutesFromTime("25:99"), null);
});

test("a print dated tomorrow never threatens today, even with no time", () => {
  const v = assessPrintWindow({ date: "2026-08-29", time: null, dateStatus: "confirmed" }, TODAY, MID_SESSION);
  assert.equal(v.verdict, "after_close");
  assert.equal(v.threatensToday, false);
});

test("confirmed after-close print today is exemptible", () => {
  const v = assessPrintWindow({ date: TODAY, time: "16:05", dateStatus: "confirmed" }, TODAY, MID_SESSION);
  assert.equal(v.verdict, "after_close");
  assert.equal(v.threatensToday, false);
});

test("confirmed pre-open print that already landed is exemptible", () => {
  const v = assessPrintWindow({ date: TODAY, time: "07:00", dateStatus: "confirmed" }, TODAY, MID_SESSION);
  assert.equal(v.verdict, "pre_open_landed");
  assert.equal(v.threatensToday, false);
});

test("confirmed pre-open print not yet landed still threatens", () => {
  const v = assessPrintWindow({ date: TODAY, time: "09:00", dateStatus: "confirmed" }, TODAY, 8 * 60);
  assert.equal(v.verdict, "pre_open_pending");
  assert.equal(v.threatensToday, true);
});

test("confirmed intraday print always threatens", () => {
  const v = assessPrintWindow({ date: TODAY, time: "12:00", dateStatus: "confirmed" }, TODAY, MID_SESSION);
  assert.equal(v.verdict, "intraday");
  assert.equal(v.threatensToday, true);
});

test("projected (unconfirmed) date never earns the after-close exemption", () => {
  const v = assessPrintWindow({ date: TODAY, time: "17:00", dateStatus: "projected" }, TODAY, MID_SESSION);
  assert.equal(v.verdict, "unknown");
  assert.equal(v.threatensToday, true);
});

test("untimed row on today fails closed as unknown/threatening", () => {
  const v = assessPrintWindow({ date: TODAY, time: null, dateStatus: "confirmed" }, TODAY, MID_SESSION);
  assert.equal(v.verdict, "unknown");
  assert.equal(v.threatensToday, true);
});
