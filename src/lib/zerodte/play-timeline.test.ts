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

test("buildPlayTimeline: reconstructed tranches carry timed replay (bar-walk-REPRODUCIBLE stop — reconstruction's own terminal leg stands, no redundant close node)", () => {
  // FINDINGS 2026-10-16: this fixture's real exit (exitReason: "stop") is exactly the reason
  // category the bar-walk reconstruction's own terminal "stopped" tranche already models —
  // record.ts's realExitIsBarWalkReproducible precedence (which play-timeline.ts now mirrors)
  // says the reconstruction stands unmodified here. Explicit `exitReason: "stop"` makes that
  // intent unambiguous; previously this fixture omitted exitReason entirely, which happened to
  // produce the same `times` array either way (the live-only override and the untouched
  // reconstruction land on the identical 14:12 slot by coincidence) — exactly the "same-reason/
  // same-timestamp case that can't expose the discrepancy" this module's header comment used to
  // cite as the reason no test covered the suppression bug. The pnlPct/label assertions below
  // are the real discriminator: they fail if the override wrongly fired here.
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
    exitReason: "stop",
    exitAt: "2026-08-03T14:12:00-04:00",
    exitPnlPct: -12,
  });
  const times = events.filter((e) => e.atEt).map((e) => e.atEt);
  assert.deepEqual(times, ["11:20", "11:32", "12:01", "12:45", "14:12"]);
  // Exactly one event at 14:12 — the reconstruction's OWN terminal tranche, not a second,
  // redundant real-close node appended beside it.
  const finalEvents = events.filter((e) => e.atEt === "14:12");
  assert.equal(finalEvents.length, 1);
  assert.equal(finalEvents[0]?.label, "Stopped");
  // The tranche's own -50% leg P&L, NOT the real blended -12% — proves the real exit did not
  // override the reconstruction for this bar-walk-reproducible reason.
  assert.equal(finalEvents[0]?.pnlPct, -50);
  assert.match(timelineFootnote(events) ?? "", /reconstructed/i);
});

test("buildPlayTimeline: real live-only RATCHET exit after a fictitious terminal tranche is never suppressed (ARM 2026-10-15 shape)", () => {
  // Live shape: a genuine partial-bank tranche, then a bar-walk reconstruction that "kept
  // trading" a already-closed position straight into a fictitious +87.72% target — the real
  // engine exit was a live ratchet-floor close for +1.87%, six minutes AFTER the fictitious
  // target's own at_et. Before this fix, the fictitious "+87.72% Target" node rendered and the
  // real +1.87% ratchet close never appeared on the timeline at all.
  const events = buildPlayTimeline({
    status: "CLOSED",
    tranches: [
      { tranche: 1, fraction: 0.333, exit_pnl_pct: 20, exit_reason: "trim_scale_first", at_et: "12:01" },
      { tranche: 2, fraction: 0.667, exit_pnl_pct: 87.72, exit_reason: "doubled", at_et: "15:19" },
    ],
    closedReason: "ratchet",
    exitReason: "ratchet",
    exitAt: "2026-08-03T15:25:00-04:00",
    exitPnlPct: 1.87,
  });
  // The fictitious terminal "doubled" leg must never render.
  assert.ok(!events.some((e) => e.label === "Target" && e.pnlPct === 87.72));
  // The real ratchet close must render, with its own real time and real P&L.
  const real = events.find((e) => e.atEt === "15:25");
  assert.equal(real?.label, "Ratchet exit");
  assert.equal(real?.pnlPct, 1.87);
  // The genuine earlier partial-bank tranche is kept, not erased.
  assert.ok(events.some((e) => e.label === "Trim" && e.pnlPct === 20));
});

test("buildPlayTimeline: real live-only FLAT exit BEFORE a fictitious terminal tranche is never suppressed, and the fictitious node is dropped rather than merely outranked by sort order (BB 2026-10-15 shape)", () => {
  // Live shape: the real engine exit (a flat theta-bleed timeout, -5%) happened THREE HOURS
  // before the bar-walk reconstruction's own fictitious "+90% Target" node. A naive fix that
  // only APPENDS the real close event (relying on the existing chronological sort to place it
  // correctly) would put the real -5% close BEFORE the fictitious +90% node in the rendered
  // list — still self-contradictory (reads as "closed at -5%, then later hit +90% target").
  // The fictitious terminal leg must be dropped outright, not just outranked by time.
  const events = buildPlayTimeline({
    status: "CLOSED",
    tranches: [
      { tranche: 1, fraction: 0.333, exit_pnl_pct: 10, exit_reason: "trim_scale_first", at_et: "10:00" },
      { tranche: 2, fraction: 0.667, exit_pnl_pct: 90, exit_reason: "doubled", at_et: "15:29" },
    ],
    closedReason: "flat",
    exitReason: "flat",
    exitAt: "2026-08-03T12:21:00-04:00",
    exitPnlPct: -5,
  });
  assert.ok(!events.some((e) => e.label === "Target" || e.pnlPct === 90));
  const real = events.find((e) => e.atEt === "12:21");
  assert.equal(real?.label, "Flat timeout");
  assert.equal(real?.pnlPct, -5);
  assert.ok(events.some((e) => e.label === "Trim" && e.pnlPct === 10));
  // Exactly two events total: the genuine earlier trim + the real flat close — no third,
  // fictitious node sitting after it.
  assert.equal(events.length, 2);
});

test("buildPlayTimeline: real live-only exit falling BETWEEN two non-terminal tranches drops only the later one (FINDINGS 2026-10-16 follow-up to #6086)", () => {
  // #6086 only ever checked the reconstruction's TERMINAL leg (stopped/time_stop/doubled) for
  // being fictitious once a real, live-only exit supersedes it. It never checked EARLIER,
  // non-terminal legs (trim_scale_first/trim_scale_second) — but the bar-walk reconstruction
  // replays the WHOLE session regardless of when the real exit happened, so a partial-bank leg
  // can land chronologically AFTER the real close exactly like the terminal leg can. This
  // fixture isolates that case with no terminal leg at all in the array, so only the new
  // after-the-real-exit check (not the pre-existing terminal check) can be responsible for
  // dropping the later tranche.
  const events = buildPlayTimeline({
    status: "CLOSED",
    tranches: [
      { tranche: 1, fraction: 0.5, exit_pnl_pct: 15, exit_reason: "trim_scale_first", at_et: "11:00" },
      { tranche: 2, fraction: 0.5, exit_pnl_pct: 60, exit_reason: "trim_scale_second", at_et: "13:00" },
    ],
    closedReason: "ratchet",
    exitReason: "ratchet",
    exitAt: "2026-08-03T12:00:00-04:00",
    exitPnlPct: 8,
  });
  // The earlier, genuinely-pre-exit trim survives untouched.
  assert.ok(events.some((e) => e.label === "Trim" && e.pnlPct === 15 && e.atEt === "11:00"));
  // The later, non-terminal tranche — chronologically AFTER the real exit — must now be dropped.
  // Before this fix it would have survived (only terminal reasons were ever checked).
  assert.ok(!events.some((e) => e.pnlPct === 60));
  const real = events.find((e) => e.atEt === "12:00");
  assert.equal(real?.label, "Ratchet exit");
  assert.equal(real?.pnlPct, 8);
  assert.equal(events.length, 2);
});

test("buildPlayTimeline: live ARM 2026-10-15 shape — non-terminal trim_scale_second AFTER the real ratchet exit is dropped alongside the terminal leg", () => {
  // Real production shape confirmed live 2026-10-15 via GET /api/market/zerodte/record: ARM's
  // real ratchet-floor close fired at 11:25 ET (peak armed at +5.14%, closed +1.87%), but the
  // bar-walk reconstruction kept "trading" the already-closed position through a trim_scale_second
  // at 15:03 ET (+40.79%) and a terminal doubled leg at 15:19 ET (+87.72%) — BOTH chronologically
  // after the real close, and before this fix only the terminal leg was ever dropped.
  const events = buildPlayTimeline({
    status: "CLOSED",
    tranches: [
      { tranche: 1, fraction: 0.33, exit_pnl_pct: 12.63, exit_reason: "trim_scale_first", at_et: "11:21" },
      { tranche: 2, fraction: 0.33, exit_pnl_pct: 40.79, exit_reason: "trim_scale_second", at_et: "15:03" },
      { tranche: 3, fraction: 0.33, exit_pnl_pct: 87.72, exit_reason: "doubled", at_et: "15:19" },
    ],
    closedReason: "ratchet",
    exitReason: "ratchet",
    exitAt: "2026-10-15T15:25:01.522Z", // 11:25 ET (EDT, UTC-4)
    exitPnlPct: 1.87,
  });
  // The genuine earlier trim (before the real exit) survives.
  assert.ok(events.some((e) => e.label === "Trim" && e.pnlPct === 12.63 && e.atEt === "11:21"));
  // Neither fictitious post-close leg renders — the non-terminal one (the actual gap) nor the
  // terminal one (#6086's existing coverage).
  assert.ok(!events.some((e) => e.pnlPct === 40.79));
  assert.ok(!events.some((e) => e.pnlPct === 87.72));
  const real = events.find((e) => e.atEt === "11:25");
  assert.equal(real?.label, "Ratchet exit");
  assert.equal(real?.pnlPct, 1.87);
  assert.equal(events.length, 2);
});

test("buildPlayTimeline: live BB 2026-10-15 shape — every reconstructed tranche lands after the real flat exit, so none of them render", () => {
  // Real production shape confirmed live 2026-10-15: BB's real flat-theta-bleed close fired at
  // 12:21 ET, but ALL THREE reconstructed tranches (trim_scale_first 12:45 ET, trim_scale_second
  // 15:02 ET, terminal doubled 15:29 ET) are chronologically after it — before this fix, the two
  // non-terminal legs would both have rendered as if they happened to a position that was
  // already closed for real.
  const events = buildPlayTimeline({
    status: "CLOSED",
    tranches: [
      { tranche: 1, fraction: 0.33, exit_pnl_pct: 14, exit_reason: "trim_scale_first", at_et: "12:45" },
      { tranche: 2, fraction: 0.33, exit_pnl_pct: 42.5, exit_reason: "trim_scale_second", at_et: "15:02" },
      { tranche: 3, fraction: 0.33, exit_pnl_pct: 90, exit_reason: "doubled", at_et: "15:29" },
    ],
    closedReason: "flat",
    exitReason: "flat",
    exitAt: "2026-10-15T16:21:19.581Z", // 12:21 ET (EDT, UTC-4)
    exitPnlPct: -5,
  });
  assert.ok(!events.some((e) => e.pnlPct === 14));
  assert.ok(!events.some((e) => e.pnlPct === 42.5));
  assert.ok(!events.some((e) => e.pnlPct === 90));
  const real = events.find((e) => e.atEt === "12:21");
  assert.equal(real?.label, "Flat timeout");
  assert.equal(real?.pnlPct, -5);
  assert.equal(events.length, 1);
});

test("buildPlayTimeline: reconstruction with no real exit at all stands unmodified (legacy/incomplete row)", () => {
  // No exitPnlPct at all (no entry_context.exit ever stamped) — the reconstruction's own
  // terminal tranche is the only information available and must stand, exactly like
  // record.ts's own "no real exit → reconstruction wins" fallback.
  const events = buildPlayTimeline({
    status: "CLOSED",
    tranches: [
      { tranche: 1, fraction: 1, exit_pnl_pct: 100, exit_reason: "doubled", at_et: "13:00" },
    ],
    closedReason: "doubled",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.label, "Target");
  assert.equal(events[0]?.pnlPct, 100);
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
