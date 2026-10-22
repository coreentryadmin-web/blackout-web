import assert from "node:assert/strict";
import test from "node:test";

import { SWING_SCAN_PHASES } from "@/lib/swing/scan-cadence";
import {
  probeSwingDiscoveryServingSnapshot,
  swingDiscoveryHandshakeStaleMin,
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
