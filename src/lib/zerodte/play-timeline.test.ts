import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlayTimeline,
  isoToEtClock,
  parseCommittedAtEt,
  readExitStampFromEntryContext,
  readTimelineTranchesFromEntryContext,
  timelineFootnote,
} from "./play-timeline";

test("isoToEtClock formats America/New_York wall clock", () => {
  assert.equal(isoToEtClock("2026-08-03T15:20:00-04:00"), "15:20");
});

test("parseCommittedAtEt extracts HH:MM from pinned commit strings", () => {
  assert.equal(parseCommittedAtEt("2026-08-03 11:32 ET"), "11:32");
  assert.equal(parseCommittedAtEt("11:32 ET"), "11:32");
});

test("buildPlayTimeline: live open play — flag, entry, peak without fake trim times", () => {
  const events = buildPlayTimeline({
    status: "TRIM",
    firstFlaggedAt: "2026-08-03T11:20:00-04:00",
    committedAtEt: "2026-08-03 11:32 ET",
    entry: 3.2,
    pnlPct: 35,
    peak: 87,
    nowEt: "12:01",
    exitPolicy: {
      policy: "trim_scale",
      hard_stop_pct: -50,
      target_pct: 100,
      trim_levels: [{ trigger_pct: 25, fraction: 0.333, premium: 4, fired: true }],
      runner_fraction: 0.334,
      stop_premium: 1.6,
      target_premium: 6.4,
      time_stop_et: "15:30",
    },
  });
  assert.equal(events[0]?.label, "Triggered");
  assert.equal(events[0]?.atEt, "11:20");
  assert.equal(events.find((e) => e.label === "Entry")?.atEt, "11:32");
  assert.ok(events.some((e) => e.kind === "trim" && e.atEt == null));
  assert.ok(events.some((e) => e.label === "+87%"));
  assert.ok(events.some((e) => e.kind === "now" && e.label === "+35%"));
});

test("buildPlayTimeline: reconstructed tranches carry timed replay", () => {
  const events = buildPlayTimeline({
    status: "CLOSED",
    firstFlaggedAt: "2026-08-03T11:20:00-04:00",
    committedAtEt: "2026-08-03 11:32 ET",
    tranches: [
      { tranche: 1, fraction: 0.333, exit_pnl_pct: 35, exit_reason: "trim_scale_first", at_et: "12:01" },
      { tranche: 2, fraction: 0.333, exit_pnl_pct: 87, exit_reason: "trim_scale_second", at_et: "12:45" },
      { tranche: 3, fraction: 0.334, exit_pnl_pct: -50, exit_reason: "stopped", at_et: "14:12" },
    ],
    closedReason: "stopped",
    exitAt: "2026-08-03T14:12:00-04:00",
    exitPnlPct: -12,
  });
  const times = events.filter((e) => e.atEt).map((e) => e.atEt);
  assert.deepEqual(times, ["11:20", "11:32", "12:01", "12:45", "14:12"]);
  assert.match(timelineFootnote(events) ?? "", /reconstructed/i);
});

test("readTimelineTranchesFromEntryContext reads executable tranches", () => {
  const tranches = readTimelineTranchesFromEntryContext({
    executable: {
      tranches: [
        { tranche: 1, fraction: 0.333, exit_pnl_pct: 25, exit_reason: "trim_scale_first", at_et: "10:15" },
      ],
    },
  });
  assert.equal(tranches?.length, 1);
  assert.equal(tranches?.[0]?.at_et, "10:15");
});

test("readExitStampFromEntryContext reads engine exit stamp", () => {
  const exit = readExitStampFromEntryContext({
    exit: {
      reason: "plan_stop",
      detail: "Mark hit stop",
      pnl_pct: -50,
      peak_pnl_pct: 40,
      at: "2026-08-03T14:12:00-04:00",
    },
  });
  assert.equal(exit.reason, "plan_stop");
  assert.equal(isoToEtClock(exit.at), "14:12");
});
