import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";

// REGRESSION (2026-09-22 live audit): `swingHorizonForLargo`'s `sample_plays` maps each of the first
// 8 `[...committed, ...watch]` rows to `{ticker, status, direction, horizon, score, reason}` — no
// gate or real-position signal at all. `committed_count_note` already discloses, at the AGGREGATE
// level, that status "COMMIT" means "score cleared the floor," not "real open position" (the
// 2026-09-08 incident this same file's sibling test covers) — but a member asking Largo "what's
// committed in swings right now" gets individual names from `sample_plays`, not the aggregate count,
// and those per-row objects carried none of that caveat.
//
// Live repro 2026-09-22: AMD and META both sampled with status "COMMIT" (score cleared the floor)
// while carrying real, populated `commitGateBlockedBy` (G-S12 halt-feed-stale / G-S6 confluence /
// G-S14 cortex veto on gex-walls) and no `positionId` — i.e. genuinely NOT open positions, blocked by
// the same real-time commit gates commit.ts enforces before any capital moves. Largo reading the old
// sample shape had no way to distinguish these two from a genuinely open, unblocked position sampled
// alongside them, and could describe them to a member as committed/actionable with no caveat.

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

const GATE_BLOCKED_CANDIDATE = {
  ticker: "AMD",
  status: "COMMIT",
  direction: "LONG",
  horizon: "SWING",
  score: 82.4,
  reason: "C 600 exp 2026-09-30 (9DTE, Δ0.69, OI 308)",
  commitGateBlockedBy: ["gate:G-S12:halt_feed_stale", "gate:G-S6:confluence", "gate:G-S14:cortex_veto:gex-walls"],
  // No positionId — never reached the real ledger.
};

const REAL_OPEN_POSITION = {
  ticker: "AAPL",
  status: "COMMIT",
  direction: "LONG",
  horizon: "SWING",
  score: 0,
  reason: null,
  positionId: 40,
  commitGateBlockedBy: [],
};

const FAKE_LANE = {
  horizon: "SWING",
  label: "Swing",
  tag: "SWING",
  holdLabel: "days-weeks",
  exit: "trim_scale",
  scoreFloor: 50,
  scoreFloorGraduated: true,
  committed: [REAL_OPEN_POSITION, GATE_BLOCKED_CANDIDATE],
  watch: [],
  committedCount: 2,
  watchCount: 0,
  sections: {
    COMMIT_NOW: new Array(1).fill({}),
    WAITING_FOR_ENTRY: [],
    WATCH: [],
    RESEARCH: [],
    MANAGING: new Array(1).fill({}),
    SCALING_OUT: [],
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

describe("swingHorizonForLargo — sample_plays discloses gate-blocked / no-real-position per row", () => {
  it("flags a floor-cleared, gate-blocked candidate as commit_gate_blocked:true and open_position:false", async () => {
    const r = (await swingHorizonForLargo()) as Record<string, unknown>;
    assert.equal(r.available, true);
    const sample = r.sample_plays as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(sample));
    const amd = sample.find((p) => p.ticker === "AMD");
    assert.ok(amd, "AMD must appear in the sample");
    assert.equal(amd!.status, "COMMIT");
    assert.equal(amd!.commit_gate_blocked, true, "AMD's real commitGateBlockedBy must surface per-row");
    assert.equal(amd!.open_position, false, "AMD has no positionId — not a real ledger row");
  });

  it("flags a genuinely open, unblocked position as commit_gate_blocked:false and open_position:true", async () => {
    const r = (await swingHorizonForLargo()) as Record<string, unknown>;
    const sample = r.sample_plays as Array<Record<string, unknown>>;
    const aapl = sample.find((p) => p.ticker === "AAPL");
    assert.ok(aapl, "AAPL must appear in the sample");
    assert.equal(aapl!.commit_gate_blocked, false);
    assert.equal(aapl!.open_position, true, "AAPL carries a real positionId");
  });
});
