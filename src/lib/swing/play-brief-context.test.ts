import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { SwingPositionRow } from "@/lib/db";
import type { BangerPositionRow } from "@/lib/banger/positions-db";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

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

// REGRESSION (Ask Largo standing mandate, 2026-10-08): `fetchSwingPositionById`/
// `fetchSwingPositionChain` below default to `null`/`[]` so every pre-existing fixture in this
// file (none of which exercise roll history) keeps composing the same brief it always did. The
// new describe block near the bottom overrides these (and `mockResolvedPlay`) to reproduce the
// banger/swing id-collision bug in `loadRollHistory`/`resolveRootPositionId`.
let mockSwingPositionByIdRow: SwingPositionRow | null = null;
let mockSwingPositionChainRows: SwingPositionRow[] = [];
const DEFAULT_RESOLVED_PLAY: TerminalPlay = {
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
};
let mockResolvedPlay: TerminalPlay = DEFAULT_RESOLVED_PLAY;

// PERFORMANCE REGRESSION (standing latency mandate, 2026-09-22): meridian/meridianPeer and
// ecosystem used to be `await`ed in strict sequence (meridian, THEN meridianPeer, THEN the
// Promise.all carrying ecosystem/vector/etc), so their artificial delays below summed. Fixed,
// they race concurrently and only the meridian->meridianPeer CHAIN (still real: meridianPeer
// reads meridian's own result) contributes its own delay on top of a single meridian wait.
const SOURCE_DELAY_MS = 150;
let meridianDelayMs = 0;
let ecosystemDelayMs = 0;
let ecosystemShouldThrow = false;
let vectorShouldThrow = false;
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
    fetchSwingPositionById: async () => mockSwingPositionByIdRow,
    fetchSwingPositionChain: async () => mockSwingPositionChainRows,
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
      if (ecosystemShouldThrow) throw new Error("ecosystem fetch failed");
      if (ecosystemDelayMs > 0) await delay(ecosystemDelayMs);
      return null;
    },
  },
});

mock.module("../bie/vector-full-state", {
  namedExports: {
    fetchVectorFullState: async () => {
      if (vectorShouldThrow) throw new Error("vector fetch failed");
      return null;
    },
  },
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
      play: mockResolvedPlay,
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

// REGRESSION (Ask Largo standing mandate, 2026-09-28, live repro: GET /api/market/swing/play-brief
// for AMZN showed "2 sources unavailable this cycle (ecosystem context, Vector state)" with ZERO
// matching CloudWatch log line for either failure — the .catch() handlers swallowed the thrown
// error entirely, so an ops session reading logs could see the member-facing SYMPTOM but never the
// CAUSE (timeout vs a real provider error vs which upstream). Same bug shape swing-discovery.ts's
// Tier-0 origin fetch already had to fix (its own comment: "invisible in CloudWatch... only by
// reading a field nobody was tailing"). Fix: log the real caught error via console.warn before
// setting the *FetchFailed flag, same pattern tier0-origin-fetch.ts already uses.
describe("loadSwingPlayBriefContext: a genuine ecosystem/vector fetch failure is logged, not swallowed", () => {
  let mod: typeof import("./play-brief-context");

  before(async () => {
    mod = await import("./play-brief-context");
  });

  it("logs the ecosystem context fetch error via console.warn (not silently swallowed)", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;
    ecosystemShouldThrow = true;
    vectorShouldThrow = false;

    const warnCalls: unknown[][] = [];
    const restore = mock.method(console, "warn", (...args: unknown[]) => {
      warnCalls.push(args);
    });
    try {
      const ctx = await mod.loadSwingPlayBriefContext({ playId: "SWING:TEST", ticker: "TEST" });
      assert.ok(ctx, "context must still resolve despite the fetch failure");
      assert.equal(ctx!.ecosystemFetchFailed, true);
      const match = warnCalls.find((args) =>
        String(args[0]).includes("ecosystem context fetch failed"),
      );
      assert.ok(match, `expected a console.warn naming the ecosystem failure, got: ${JSON.stringify(warnCalls)}`);
      assert.ok(String(match![0]).includes("TEST"), "must name the ticker");
      assert.ok(match![1] instanceof Error, "must pass the real caught error through, not swallow it");
    } finally {
      ecosystemShouldThrow = false;
      restore.mock.restore();
    }
  });

  it("logs the Vector full-state fetch error via console.warn (not silently swallowed)", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;
    ecosystemShouldThrow = false;
    vectorShouldThrow = true;

    const warnCalls: unknown[][] = [];
    const restore = mock.method(console, "warn", (...args: unknown[]) => {
      warnCalls.push(args);
    });
    try {
      const ctx = await mod.loadSwingPlayBriefContext({ playId: "SWING:TEST", ticker: "TEST" });
      assert.ok(ctx, "context must still resolve despite the fetch failure");
      assert.equal(ctx!.vectorFetchFailed, true);
      const match = warnCalls.find((args) =>
        String(args[0]).includes("Vector full-state fetch failed"),
      );
      assert.ok(match, `expected a console.warn naming the Vector failure, got: ${JSON.stringify(warnCalls)}`);
      assert.ok(String(match![0]).includes("TEST"), "must name the ticker");
      assert.ok(match![1] instanceof Error, "must pass the real caught error through, not swallow it");
    } finally {
      vectorShouldThrow = false;
      restore.mock.restore();
    }
  });
});

// BUG FOUND (Ask Largo standing mandate, 2026-10-08, live-audit cycle): `loadRollHistory`/
// `resolveRootPositionId` (play-brief-context.ts) resolve a reviewed play's ledger row with a
// bare `fetchSwingPositionById(positionId)` — a flat `swing_positions` lookup by numeric id, with
// no check that the row it finds actually belongs to the ticker under review. For a BANGER-origin
// SWING-lane play, that `positionId` is really a `banger_positions.id` (banger-lane-merge.ts
// stamps `positionId: row.id` so the row survives into the same `${horizon}:${ticker}:${id}` shape
// `terminalPlayFromHorizon` uses for every lane) — `banger_positions` and `swing_positions` are
// separate id sequences that CAN collide on a shared numeric id, exactly the risk
// `loadOpenBook()`'s own regression above already proves this file takes seriously for the
// book-context merge. `loadRollHistory` had no equivalent guard: a collision would surface an
// UNRELATED position's real strike/expiry/P&L as if it were the reviewed play's own prior roll
// leg — a direct Largo product-contract IDENTITY violation, not a cosmetic bug. Fixed by requiring
// the fetched row's own `ticker` to match the reviewed play's ticker before trusting it.
describe("loadSwingPlayBriefContext: roll history is ticker-identity-checked (banger/swing id collision)", () => {
  let mod: typeof import("./play-brief-context");

  before(async () => {
    mod = await import("./play-brief-context");
  });

  it("does NOT cite an unrelated ticker's roll chain when a banger-origin positionId collides with an unrelated swing_positions row", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;

    // ADSK here is BANGER-origin — its "positionId" (1485) is really banger_positions.id, baked
    // into play.id the same way banger-lane-merge.ts/adapters.ts do in production.
    mockResolvedPlay = {
      ...DEFAULT_RESOLVED_PLAY,
      id: "SWING:ADSK:1485",
      ticker: "ADSK",
      contract: "242.5C · 8DTE",
    };
    // The swing_positions table happens to ALSO have a row with numeric id 1485 — for a
    // completely unrelated ticker (ZETA). This is the collision: fetchSwingPositionById(1485)
    // returns THIS row, which has nothing to do with the ADSK play under review.
    mockSwingPositionByIdRow = { ...swingRow("ZETA", 1485), root_position_id: 1400 };
    // A real 2-leg roll chain for ZETA — if the identity check is missing, this chain gets cited
    // as if it belonged to the ADSK play being reviewed.
    mockSwingPositionChainRows = [swingRow("ZETA", 1400), swingRow("ZETA", 1485)];

    try {
      const ctx = await mod.loadSwingPlayBriefContext({
        playId: "SWING:ADSK:1485",
        ticker: "ADSK",
        positionId: 1485,
      });
      assert.ok(ctx, "context must still resolve");
      assert.equal(
        ctx!.rollHistory,
        null,
        "a ticker-mismatched row must never be cited as this play's roll history — " +
          "got a real ZETA chain attached to an ADSK brief",
      );
    } finally {
      mockResolvedPlay = DEFAULT_RESOLVED_PLAY;
      mockSwingPositionByIdRow = null;
      mockSwingPositionChainRows = [];
    }
  });

  it("still cites the real roll history when the ticker genuinely matches", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;

    mockResolvedPlay = {
      ...DEFAULT_RESOLVED_PLAY,
      id: "SWING:INTC:50",
      ticker: "INTC",
      contract: "35C · 10DTE",
    };
    mockSwingPositionByIdRow = { ...swingRow("INTC", 50), root_position_id: 49 };
    mockSwingPositionChainRows = [swingRow("INTC", 49), swingRow("INTC", 50)];

    try {
      const ctx = await mod.loadSwingPlayBriefContext({
        playId: "SWING:INTC:50",
        ticker: "INTC",
        positionId: 50,
      });
      assert.ok(ctx, "context must still resolve");
      assert.ok(ctx!.rollHistory, "a genuinely matching ticker's roll chain must still be cited");
      assert.equal(ctx!.rollHistory!.rollCount, 1);
    } finally {
      mockResolvedPlay = DEFAULT_RESOLVED_PLAY;
      mockSwingPositionByIdRow = null;
      mockSwingPositionChainRows = [];
    }
  });
});

// BUG FIX (2026-10-09, Ask Largo standing mandate — live CTVA repro, positionId 1483): see
// `reconcileLivePnlPctWithDisplayMark`'s own doc comment (play-brief-resolve-pure.ts) for the full
// live repro. `ctx.play.pnlPct` is what EVERY section downstream reads for "current P&L" framing
// (not just the Position section's own locally-reconciled display line) — this proves the loader
// itself hands out the reconciled number, not the raw one, so every section composed from `ctx.play`
// agrees with the "Mark:" line a member can see and hand-check.
describe("loadSwingPlayBriefContext: pnlPct is reconciled with the displayed (rounded-to-cent) mark", () => {
  let mod: typeof import("./play-brief-context");

  before(async () => {
    mod = await import("./play-brief-context");
  });

  it("replaces the raw mark/entry-1 pnlPct with the cent-rounded-mark recompute (live CTVA shape)", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;

    // Live values: entry $0.23, raw mid $0.175 (displays as "Mark: $0.18"), raw livePnlPct -23.9
    // (= 0.175/0.23-1 * 100, unrounded). The reconciled figure a member can hand-check against the
    // displayed $0.18 mark is (0.18/0.23-1)*100 = -21.7391...%.
    mockResolvedPlay = {
      ...DEFAULT_RESOLVED_PLAY,
      id: "SWING:CTVA:1483",
      ticker: "CTVA",
      status: "OPEN",
      entry: 0.23,
      mark: 0.175,
      pnlPct: -23.9,
      peak: 95.7,
      trough: -34.8,
    };

    try {
      const ctx = await mod.loadSwingPlayBriefContext({
        playId: "SWING:CTVA:1483",
        ticker: "CTVA",
        positionId: 1483,
      });
      assert.ok(ctx, "context must still resolve");
      assert.ok(ctx!.play.pnlPct != null, "pnlPct must not be dropped");
      assert.ok(
        Math.abs(ctx!.play.pnlPct! - -21.7391) < 0.01,
        `expected the cent-rounded-mark recompute (~-21.74), got ${ctx!.play.pnlPct}`,
      );
      assert.notEqual(
        Math.round(ctx!.play.pnlPct! * 10),
        -239,
        "must not still be the raw, unreconciled -23.9 the live repro served",
      );
    } finally {
      mockResolvedPlay = DEFAULT_RESOLVED_PLAY;
    }
  });

  it("leaves pnlPct untouched when it is not a plain mark/entry-1 read (WS-10 executable-lane guard)", async () => {
    mockOpenSwingRows = [];
    mockBangerRows = [];
    bangerEngineEnabled = true;
    bangerFetchShouldThrow = false;

    // mark/entry-1 implies +50%, but pnlPct carries a genuinely different basis (e.g. exec.pnl_pct)
    // far outside ordinary rounding noise — must be left exactly as given, same guard as
    // play-brief.ts's own `markRoundTripsPnl`.
    mockResolvedPlay = {
      ...DEFAULT_RESOLVED_PLAY,
      id: "SWING:XYZ:9001",
      ticker: "XYZ",
      status: "OPEN",
      entry: 1.0,
      mark: 1.5,
      pnlPct: 12.3,
    };

    try {
      const ctx = await mod.loadSwingPlayBriefContext({
        playId: "SWING:XYZ:9001",
        ticker: "XYZ",
        positionId: 9001,
      });
      assert.ok(ctx, "context must still resolve");
      assert.equal(ctx!.play.pnlPct, 12.3, "a non-mark/entry pnlPct basis must not be rewritten");
    } finally {
      mockResolvedPlay = DEFAULT_RESOLVED_PLAY;
    }
  });
});
