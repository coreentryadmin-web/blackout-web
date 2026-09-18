import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// REGRESSION (2026-09-08 live incident — see docs/audit/findings-staging/): `swingHorizonForLargo`'s
// `committed_count` counts every play with status "COMMIT", which for SWING means "score cleared the
// commit floor" — a candidate that has NOT yet opened a real position carries the same status as one
// that has (live-plays.ts stamps status "COMMIT" on real ledger rows too, for back-compat). A member
// asked Largo "how many swing plays are open" and the live board showed 4 while the raw API field
// read 14 — Largo had no unambiguous open-position count in its own tool payload to answer from.
// `open_position_count` (MANAGING + SCALING_OUT + EXITING from the lane's own section_counts) is that
// missing, unambiguous total.

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
  // Mirrors the live incident: 14 total "COMMIT"-status plays, only 4 of which are real open
  // positions (2 MANAGING, 1 SCALING_OUT, 1 EXITING) — the rest are pre-entry COMMIT_NOW/
  // WAITING_FOR_ENTRY candidates that never reached the ledger.
  committedCount: 14,
  watchCount: 26,
  sections: {
    COMMIT_NOW: new Array(3).fill({}),
    WAITING_FOR_ENTRY: new Array(7).fill({}),
    WATCH: new Array(26).fill({}),
    RESEARCH: [],
    MANAGING: new Array(2).fill({}),
    SCALING_OUT: new Array(1).fill({}),
    EXITING: new Array(1).fill({}),
  },
};

mock.module("../swing/serving-lane", {
  namedExports: {
    readSwingServingSnapshot: async () => null,
    discoverSwingFromPersisted: async () => null,
    getSwingServingLane: async () => FAKE_LANE,
  },
});

let swingHorizonForLargo: typeof import("./product-reads").swingHorizonForLargo;

before(async () => {
  ({ swingHorizonForLargo } = await import("./product-reads"));
});

describe("swingHorizonForLargo — open_position_count disambiguates committed_count", () => {
  it("surfaces open_position_count as the sum of the three LIVE sections, distinct from committed_count", async () => {
    const r = (await swingHorizonForLargo()) as Record<string, unknown>;
    assert.equal(r.available, true);
    assert.equal(r.committed_count, 14);
    assert.equal(r.open_position_count, 4);
    assert.notEqual(r.committed_count, r.open_position_count);
    assert.equal(typeof r.committed_count_note, "string");
    assert.match(String(r.committed_count_note), /not a count of open positions/i);
  });
});
