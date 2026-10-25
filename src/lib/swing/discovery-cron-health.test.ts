import assert from "node:assert/strict";
import test from "node:test";

import { SWING_SCAN_PHASES } from "@/lib/swing/scan-cadence";
import {
  probeSwingDiscoveryServingSnapshot,
  swingDiscoveryHandshakeStaleMin,
  swingDiscoveryPhasesEndedBefore,
  worstOrdinarySwingDiscoveryGapMin,
} from "@/lib/swing/discovery-cron-health";
import type { SwingServingSnapshot } from "@/lib/swing/serving-lane";

test("worstOrdinarySwingDiscoveryGapMin matches serving-lane regression math", () => {
  const postCloseEndMin = SWING_SCAN_PHASES.find((w) => w.phase === "POST_CLOSE")!.endMin;
  const preOpenStartMin = SWING_SCAN_PHASES.find((w) => w.phase === "PRE_OPEN")!.startMin;
  const minutesInDay = 24 * 60;
  const expected =
    minutesInDay - postCloseEndMin + 2 * minutesInDay + preOpenStartMin;
  assert.equal(worstOrdinarySwingDiscoveryGapMin(), expected);
});

test("swingDiscoveryHandshakeStaleMin exceeds the 36h registry default", () => {
  assert.ok(swingDiscoveryHandshakeStaleMin() > 36 * 60);
});

test("probeSwingDiscoveryServingSnapshot: fresh when snapshot matches today after PRE_OPEN", () => {
  const now = new Date("2026-10-22T16:30:00.000Z"); // 12:30 ET Wed — MIDDAY
  const snap: SwingServingSnapshot = {
    asOf: "2026-10-22T13:00:00.000Z",
    sessionDay: "2026-10-22",
    dossiers: [],
    plays: [],
    watch: [],
  };
  const probe = probeSwingDiscoveryServingSnapshot(snap, now);
  assert.equal(probe.fresh, true);
});

test("probeSwingDiscoveryServingSnapshot: not fresh when session day lags", () => {
  const now = new Date("2026-10-22T16:30:00.000Z");
  const snap: SwingServingSnapshot = {
    asOf: "2026-10-20T23:50:00.000Z",
    sessionDay: "2026-10-20",
    dossiers: [],
    plays: [],
    watch: [],
  };
  const probe = probeSwingDiscoveryServingSnapshot(snap, now);
  assert.equal(probe.fresh, false);
  assert.match(probe.detail, /lags expected/);
});

// BUG FIX (Ask Largo standing mandate, 2026-10-25): SWING_SCAN_PHASES is explicitly documented as
// NOT chronologically ordered (POST_CLOSE is listed first for render purposes) — this function used
// to return its filtered result in that array order instead of ended-order, so `[length-1]` picked
// the wrong "most recently ended" phase.
test("swingDiscoveryPhasesEndedBefore returns phases in the order they ENDED, not SWING_SCAN_PHASES' array order", () => {
  const now = new Date("2026-10-24T01:00:00.000Z"); // 21:00 ET Fri (EDT) — after POST_CLOSE (ends 20:00), before OVERNIGHT (ends 24:00)
  const ended = swingDiscoveryPhasesEndedBefore(now, "2026-10-23");
  assert.deepEqual(ended, ["PRE_OPEN", "MIDDAY", "POWER_HOUR", "POST_CLOSE"]);
  assert.equal(ended[ended.length - 1], "POST_CLOSE", "the LAST element must be the phase that ended most recently");
});

// Same bug, at the probeSwingDiscoveryServingSnapshot level: a snapshot timestamped BEFORE POST_CLOSE
// even started cannot possibly reflect POST_CLOSE (the primary phase) having run, and must not read fresh.
test("probeSwingDiscoveryServingSnapshot: not fresh when snapshot predates POST_CLOSE, checked after POST_CLOSE ended", () => {
  const now = new Date("2026-10-24T01:00:00.000Z"); // 21:00 ET Fri
  const snap: SwingServingSnapshot = {
    asOf: "2026-10-23T19:05:00.000Z", // 15:05 ET — before POWER_HOUR (15:00-16:00) and POST_CLOSE (16:15-20:00)
    sessionDay: "2026-10-23",
    dossiers: [],
    plays: [],
    watch: [],
  };
  const probe = probeSwingDiscoveryServingSnapshot(snap, now);
  assert.equal(probe.fresh, false, "a snapshot predating POST_CLOSE's own start cannot prove POST_CLOSE ran");
});
