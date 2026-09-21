import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// REGRESSION (2026-09-21 live divergence — see docs/audit/findings-staging/): `swingHorizonForLargo`'s
// `watch_count` is the STATUS-based back-compat split (`status === "WATCH"`, i.e. score below the
// commit floor) — it is NOT the same population as `section_counts.WATCH`, the member-facing "Watch"
// rail the desk actually renders. `sectionForSwingPlay` (serving.ts) routes a FORMING-stage candidate
// to the WATCH section BEFORE it ever checks the floor, so a name that already cleared the floor
// (status "COMMIT") but hasn't triggered yet lands in section_counts.WATCH while being invisible to
// watch_count. Measured live 2026-09-21: two fetches of the same lane, minutes apart, read
// watch_count 0 while section_counts.WATCH read 2 — an ordinary snapshot refresh, not an error. This
// is the same root shape as the already-fixed `committed_count` confusion (2026-09-08 incident,
// product-reads-swing-open-count.test.ts) — a status-based field silently answering a section-based
// question — so it gets the same disambiguating note.

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
  scoreFloor: 60,
  scoreFloorGraduated: false,
  committed: [],
  watch: [],
  // Mirrors the live divergence: zero plays carry the back-compat status "WATCH" (all currently-
  // persisted pre-entry candidates already cleared the floor), yet two of them are still FORMING and
  // so route to the member-facing WATCH section regardless of floor status.
  committedCount: 1,
  watchCount: 0,
  sections: {
    COMMIT_NOW: new Array(1).fill({}),
    WAITING_FOR_ENTRY: [],
    WATCH: new Array(2).fill({}),
    RESEARCH: [],
    MANAGING: new Array(24).fill({}),
    SCALING_OUT: new Array(35).fill({}),
    EXITING: [],
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

describe("swingHorizonForLargo — watch_count_note disambiguates watch_count from section_counts.WATCH", () => {
  it("surfaces a note when the status-based watch_count diverges from the member-facing WATCH section", async () => {
    const r = (await swingHorizonForLargo()) as Record<string, unknown>;
    assert.equal(r.available, true);
    assert.equal(r.watch_count, 0);
    const sectionCounts = r.section_counts as Record<string, number>;
    assert.equal(sectionCounts.WATCH, 2);
    assert.notEqual(r.watch_count, sectionCounts.WATCH);
    assert.equal(typeof r.watch_count_note, "string");
    assert.match(String(r.watch_count_note), /section_counts\.WATCH/);
  });
});
