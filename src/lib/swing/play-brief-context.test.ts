import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { SwingPositionRow } from "@/lib/db";
import type { BangerPositionRow } from "@/lib/banger/positions-db";

// REGRESSION (Ask Largo standing mandate, 2026-09-12): `loadOpenBook()` used to read ONLY
// `swing_positions`, so `bookContextSection`'s theme/direction overlap check was blind to every
// Engine B (Banger) open position — 80 of 85 (94%) of the live SWING lane, confirmed against prod
// via GET /api/market/nighthawk/horizons?view=swings the same day this test was written. This file
// proves `loadOpenBook()` (exercised through `loadSwingPlayBriefContext`) now merges BOTH tables
// into the same `PortfolioPosition[]`, gated by the same `isBangerEngineEnabled()` flag
// `fetchActiveSwingPlaysForMarks` (live-marks-active.ts) already uses for the equivalent merge on
// the live-marks lane, and fails soft (keeps the swing-native rows) if the banger fetch itself
// errors.

let mockOpenSwingRows: SwingPositionRow[] = [];
let mockBangerRows: BangerPositionRow[] = [];
let bangerEngineEnabled = true;
let bangerFetchShouldThrow = false;

// PERFORMANCE REGRESSION (standing latency mandate, 2026-09-22): meridian/meridianPeer and
// ecosystem used to be `await`ed in strict sequence (meridian, THEN meridianPeer, THEN the
// Promise.all carrying ecosystem/vector/etc), so their artificial delays below summed. Fixed,
// they race concurrently and only the meridian->meridianPeer CHAIN (still real: meridianPeer
// reads meridian's own result) contributes its own delay on top of a single meridian wait.
const SOURCE_DELAY_MS = 150;
let meridianDelayMs = 0;
let ecosystemDelayMs = 0;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function swingRow(ticker: string, id: number, direction: "long" | "short" = "long"): SwingPositionRow {
  return {
    id,
    commit_key: `k-${ticker}-${id}`,
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-09-02",
    ticker,
    direction,
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: null,
    contract_strike: 110,
    contract_expiry: "2026-09-18",
    contract_type: direction === "short" ? "put" : "call",
    contract_occ: null,
    contract_delta: 0.6,
    entry_underlying_px: 100,
    thesis_invalidation_px: 90,
    target_underlying_px: 120,
    entry_premium: 4.9,
    last_mark: 9.7,
    last_mark_at: "2026-09-04T21:45:18.549Z",
    peak_premium: 9.7,
    trough_premium: 4.15,
    underlying_mfe: 118,
    underlying_mae: 98,
    realized_pnl_pct: null,
    entry_context: {},
    gate_calibration_json: {},
    feature_vector: {},
    plan_json: null,
    scale_out_grade: null,
    grade_json: null,
    grade_methodology: null,
    legacy_grade: null,
    status: "HOLD",
    first_seen_at: "2026-09-02T20:31:43.000Z",
    committed_at: "2026-09-02T20:31:43.000Z",
    closed_at: null,
    graded_at: null,
    updated_at: "2026-09-04T21:45:18.549Z",
  };
}

function bangerRow(ticker: string, id: number): BangerPositionRow {
  return {
    id,
    commit_key: `b-${ticker}-${id}`,
    session_date: "2026-09-10",
    ticker,
    discovery_gain: 0.25,
    discovery_vol: 1_000_000,
    discovery_dollar_vol: 5_000_000,
    discovery_close_strength: 0.8,
    contract_strike: 50,
    contract_expiry: "2026-09-25",
    contract_occ: `O:${ticker}260925C00050000`,
    entry_premium: 2.1,
    last_mark: 2.6,
    last_mark_at: "2026-09-11T20:00:00.000Z",
    peak_premium: 2.9,
    scaled_already: false,
    scale_out_action: null,
    scale_out_reason: null,
    partial_realized_premium: null,
    realized_pnl_pct: null,
    realized_pnl_usd: null,
    entry_context: {},
    status: "OPEN",
    first_seen_at: "2026-09-10T13:31:00.000Z",
    committed_at: "2026-09-10T13:31:00.000Z",
    closed_at: null,
    updated_at: "2026-09-11T20:00:00.000Z",
  };
}

mock.module("../db", {
  namedExports: {
    fetchOpenSwingPositions: async () => mockOpenSwingRows,
    fetchSwingPositionById: async () => null,
    fetchSwingPositionChain: async () => [],
    // Ask Largo mandate round 19 (2026-09-18): ticker-scoped historical context
    // (play-brief-ticker-history.ts) — defaults to an empty ledger read so existing fixtures in
    // this file (none of which exercise the new "Ticker track record" section) keep composing the
    // same brief they always did (tickerTrackRecord resolves to null on an empty row set).
    fetchSwingPositionsByTicker: async () => [],
  },
});

mock.module("../banger/positions-db", {
  namedExports: {
    fetchBangerOpenBookRows: async () => {
      if (bangerFetchShouldThrow) throw new Error("banger fetch failed");
      return mockBangerRows;
    },
  },
});

mock.module("../banger/flag", {
  namedExports: {
    isBangerEngineEnabled: () => bangerEngineEnabled,
  },
});

mock.module("../bie/ecosystem-context", {
  namedExports: {
    fetchEcosystemContext: async () => {
      if (ecosystemDelayMs > 0) await delay(ecosystemDelayMs);
      return null;
    },
  },
});

mock.module("../bie/vector-full-state", {
  namedExports: { fetchVectorFullState: async () => null },
});

mock.module("./play-brief-meridian", {
  namedExports: {
    fetchMeridianForTicker: async () => {
      if (meridianDelayMs > 0) await delay(meridianDelayMs);
      return null;
    },
  },
});

mock.module("./play-brief-meridian-peer", {
  namedExports: { fetchMeridianPeerForBrief: async () => null },
});

mock.module("./calibration-cache", {
  namedExports: { readSwingArchetypeTrackRecord: async () => null },
});

mock.module("./play-brief-resolve", {
  namedExports: {
    resolveSwingPlayForBrief: async () => ({
      play: {
        id: "SWING:TEST",
        ticker: "TEST",
        direction: "LONG",
        contract: "50C · 15DTE",
        score: 70,
        status: "WATCH",
        horizon: "SWING",
        exitModel: "SCALE_OUT",
        recommendation: "BUY",
        factors: [],
        gates: [],
      },
      scanAsOf: "2026-09-12T13:00:00.000Z",
      scanSessionDay: "2026-09-12",
      laneRows: [],
    }),
  },
});

describe("loadSwingPlayBriefContext: openBook merges swing_positions AND banger_positions", () => {
  let mod: typeof import("./play-brief-context");

  before(async () => {
    mod = await import("./play-brief-context");
  });

  it("includes banger-origin open positions in ctx.openBook, without a positionId", async () => {
    mockOpenSwingRows = [swingRow("AAPL", 37)];
    mockBangerRows = [bangerRow("EBS", 501), bangerRow("CRSR", 502)];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;

    const ctx = await mod.loadSwingPlayBriefContext({ playId: "SWING:TEST", ticker: "TEST" });
    assert.ok(ctx, "context must resolve");
    const book = ctx!.openBook;
    assert.ok(book, "openBook must not be null");
    assert.equal(book!.length, 3, "must contain both the swing-native row and both banger rows");

    const aapl = book!.find((p) => p.ticker === "AAPL");
    assert.ok(aapl, "swing-native AAPL row must be present");
    assert.equal(aapl!.positionId, 37, "swing-native row keeps its real ledger positionId");

    const ebs = book!.find((p) => p.ticker === "EBS");
    assert.ok(ebs, "banger-origin EBS row must be present — this is the fix");
    assert.equal(ebs!.direction, "LONG", "banger positions are always long calls");
    assert.equal(
      ebs!.positionId,
      undefined,
      "a banger row's own id must NOT be stamped as positionId — banger_positions and " +
        "swing_positions are separate id sequences that can collide",
    );

    const crsr = book!.find((p) => p.ticker === "CRSR");
    assert.ok(crsr, "banger-origin CRSR row must be present");
  });

  it("respects isBangerEngineEnabled() — disabled Engine B leaves the book swing-only", async () => {
    mockOpenSwingRows = [swingRow("NRG", 34)];
    mockBangerRows = [bangerRow("EBS", 501)];
    bangerEngineEnabled = false;
    bangerFetchShouldThrow = false;

    const ctx = await mod.loadSwingPlayBriefContext({ playId: "SWING:TEST", ticker: "TEST" });
    const book = ctx!.openBook;
    assert.ok(book);
    assert.equal(book!.length, 1, "only the swing-native row when Engine B is disabled");
    assert.equal(book![0]!.ticker, "NRG");
  });

  it("fails soft on a banger fetch error — swing-native rows still populate the book", async () => {
    mockOpenSwingRows = [swingRow("NN", 32)];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = true;

    const ctx = await mod.loadSwingPlayBriefContext({ playId: "SWING:TEST", ticker: "TEST" });
    const book = ctx!.openBook;
    assert.ok(book, "a banger-fetch error must not null out the whole book");
    assert.equal(book!.length, 1);
    assert.equal(book![0]!.ticker, "NN");
  });
});

describe("loadSwingPlayBriefContext: independent sources fan out concurrently, not serially", () => {
  let mod: typeof import("./play-brief-context");

  before(async () => {
    mod = await import("./play-brief-context");
  });

  it("does not sum the meridian and ecosystem delays — they must race, not queue", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;
    meridianDelayMs = SOURCE_DELAY_MS;
    ecosystemDelayMs = SOURCE_DELAY_MS;

    const start = Date.now();
    const ctx = await mod.loadSwingPlayBriefContext({ playId: "SWING:TEST", ticker: "TEST" });
    const elapsedMs = Date.now() - start;

    meridianDelayMs = 0;
    ecosystemDelayMs = 0;

    assert.ok(ctx, "context must still resolve");
    // Sequential (the bug): meridian's own delay, THEN ecosystem's delay inside a later
    // Promise.all — elapsed is close to their SUM (2x SOURCE_DELAY_MS).
    // Concurrent (the fix): both race from the start — elapsed is close to their MAX
    // (1x SOURCE_DELAY_MS), regardless of meridianPeer's harmless dependent chain off meridian
    // (meridianPeer resolves to null near-instantly here since this fixture's meridian result has
    // no `.items` for it to key off of).
    const sequentialFloorMs = SOURCE_DELAY_MS * 2 - 40; // generous slack below the sequential sum
    assert.ok(
      elapsedMs < sequentialFloorMs,
      `expected concurrent fan-out (~${SOURCE_DELAY_MS}ms) but took ${elapsedMs}ms — looks like ` +
        `meridian/meridianPeer are still being awaited BEFORE the rest of the sources start, ` +
        `serializing their delays instead of racing them`,
    );
  });
});
