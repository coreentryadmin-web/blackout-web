import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// `swingHorizonForLargo` (get_swing_horizon) is the Largo tool for the SWING horizon lane. It reads
// the persisted discovery snapshot (`readSwingServingSnapshot`) ONLY to pull `spotsByTicker` for
// `getSwingServingLane` — the snapshot's own `asOf`/`sessionDay` (the scan's freshness stamp) were
// fetched and then silently discarded, so the tool response carried NO timestamp of any kind. A
// model reading `sample_plays`/`section_counts` had no way to tell a lane built from a scan that ran
// moments ago from one built from a scan that is hours or days stale (the persisted-snapshot TTL is
// 26h — see `SWING_SERVING_TTL_SEC` in serving-lane.ts) — a direct violation of the Largo product
// contract's "time"/"freshness" points (docs/audit/LARGO-PRODUCT-CONTRACT.md).
//
// This file mocks "../swing/serving-lane" directly (rather than sharing product-reads.test.ts's
// module-level mocks) so it can control the persisted snapshot precisely — both a present snapshot
// (proving the scan stamp is threaded through, not fabricated as "now") and an absent one (proving
// the field degrades to `null`, never silently omitted or invented).

mock.module("server-only", { namedExports: {} });

mock.module("../db", {
  namedExports: {
    dbConfigured: () => true,
    fetchZeroDteSetupLogRange: async () => [],
    fetchLatestSwingSnapshotEvents: async () => new Map(),
    fetchOpenSwingPositions: async () => [],
    fetchRecentHelixSignalOutcomes: async () => [],
  },
});

mock.module("../banger/positions-db", {
  namedExports: {
    fetchBangerBoardRows: async () => [],
    fetchBangerOpenCount: async () => 0,
  },
});

const FAKE_LANE = {
  horizon: "SWING",
  label: "Swing",
  tag: "SWING",
  holdLabel: "days-weeks",
  exit: "trim_scale",
  scoreFloor: 50,
  scoreFloorGraduated: true,
  committed: [],
  watch: [],
  committedCount: 0,
  watchCount: 0,
  sections: {},
};

// Mutable so each test can pick what the persisted snapshot looks like.
let SNAPSHOT: { asOf: string; sessionDay: string; spotsByTicker?: Record<string, number> } | null =
  null;

mock.module("../swing/serving-lane", {
  namedExports: {
    readSwingServingSnapshot: async () => SNAPSHOT,
    discoverSwingFromPersisted: async () => null,
    getSwingServingLane: async () => FAKE_LANE,
  },
});

let swingHorizonForLargo: typeof import("./product-reads").swingHorizonForLargo;

before(async () => {
  ({ swingHorizonForLargo } = await import("./product-reads"));
});

describe("swingHorizonForLargo — scan freshness (Largo product contract)", () => {
  it("threads the persisted scan's own asOf/sessionDay through as scan_as_of/scan_session_day", async () => {
    SNAPSHOT = { asOf: "2026-09-03T14:22:00.000Z", sessionDay: "2026-09-03" };
    const r = (await swingHorizonForLargo()) as Record<string, unknown>;
    assert.equal(r.available, true);
    // The scan stamp must be the SNAPSHOT's own value, not this request's clock.
    assert.equal(r.scan_as_of, "2026-09-03T14:22:00.000Z");
    assert.equal(r.scan_session_day, "2026-09-03");
    // The read's own clock is a SEPARATE field, per the same convention bangerBoardForLargo already
    // uses — this proves the two are not conflated.
    assert.match(String(r.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.match(String(r.session_date), /^\d{4}-\d{2}-\d{2}$/);
    assert.notEqual(r.as_of, r.scan_as_of);
  });

  it("reports scan_as_of/scan_session_day as null (never fabricated) when no scan is persisted", async () => {
    SNAPSHOT = null;
    const r = (await swingHorizonForLargo()) as Record<string, unknown>;
    assert.equal(r.available, true);
    assert.equal(r.scan_as_of, null);
    assert.equal(r.scan_session_day, null);
    // The read's own clock is still present — an empty/gated lane is still a real read.
    assert.match(String(r.as_of), /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});
