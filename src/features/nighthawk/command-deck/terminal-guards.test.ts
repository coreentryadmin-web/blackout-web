// PlayTerminal management-panel render gates: the 15:30-ET time-stop is 0DTE-only, and a CONDOR
// never draws a directional trim/ratchet ladder.
import { test } from "node:test";
import assert from "node:assert/strict";

import { showsRatchetTrack, showsTimeStopClock, showsTrimScaleLadder } from "./terminal-guards.ts";
import type { TerminalPlay } from "./types.ts";

const TRIM_POLICY = {
  policy: "trim_scale" as const,
  hard_stop_pct: -50,
  target_pct: 100,
  trim_levels: [{ trigger_pct: 25, fraction: 1 / 3, premium: 2.5, fired: false }],
  runner_fraction: 1 / 3,
  stop_premium: 1.0,
  target_premium: 4.0,
  time_stop_et: "15:30",
};

test("time-stop clock shows ONLY for a still-open 0DTE row", () => {
  assert.equal(showsTimeStopClock({ horizon: "ZERO_DTE", status: "OPEN" }), true);
  assert.equal(showsTimeStopClock({ horizon: "ZERO_DTE", status: "HOLD" }), true);
  assert.equal(showsTimeStopClock({ horizon: "ZERO_DTE", status: "TRIM" }), true);
  // CLOSED 0DTE → nothing left to time out.
  assert.equal(showsTimeStopClock({ horizon: "ZERO_DTE", status: "CLOSED" }), false);
  // Multi-day/week horizons must NOT get a "flat by 15:30 today" countdown.
  assert.equal(showsTimeStopClock({ horizon: "SWING", status: "OPEN" }), false);
  assert.equal(showsTimeStopClock({ horizon: "LEAPS", status: "OPEN" }), false);
  assert.equal(showsTimeStopClock({ horizon: "LEGACY", status: "WATCH" }), false);
});

test("a CONDOR row never gets the directional trim-scale ladder (even with a trim_scale policy)", () => {
  const condor: Pick<TerminalPlay, "exitModel" | "exitPolicy" | "isCondor"> = {
    exitModel: "SCALE_OUT",
    exitPolicy: TRIM_POLICY,
    isCondor: true,
  };
  assert.equal(showsTrimScaleLadder(condor), false); // suppressed for a credit structure
  // A directional trim_scale row DOES get the ladder.
  assert.equal(showsTrimScaleLadder({ exitModel: "SCALE_OUT", exitPolicy: TRIM_POLICY, isCondor: null }), true);
  // A ratchet policy never counts as a trim ladder.
  assert.equal(
    showsTrimScaleLadder({ exitModel: "RATCHET", exitPolicy: { ...TRIM_POLICY, policy: "ratchet" }, isCondor: null }),
    false
  );
});

test("a CONDOR row never gets the directional −50/+100 ratchet track either", () => {
  assert.equal(showsRatchetTrack({ exitModel: "RATCHET", isCondor: true, progress: 0.5 }), false);
  // A directional ratchet row with a track position DOES get it (the prod-default view).
  assert.equal(showsRatchetTrack({ exitModel: "RATCHET", isCondor: null, progress: 0.5 }), true);
  // No progress (e.g. a horizon SCALE_OUT row) → no track.
  assert.equal(showsRatchetTrack({ exitModel: "RATCHET", isCondor: null, progress: null }), false);
});
