import test from "node:test";
import assert from "node:assert/strict";
import { before, describe, mock } from "node:test";
import type { HorizonPlay } from "@/lib/horizon-plays";
import { pickLanePlayForBrief, parseSwingPlayId, resolveBriefIvRank } from "./play-brief-resolve-pure";
import { attachThesisExplanation, dossiersByTicker } from "./serving-lane";
import { buildSwingDossier, type SwingDossierInput } from "./dossier";
import type { SwingReads } from "../swing-signals";
import type { SwingPositionRow } from "@/lib/db";

function laneRow(overrides: Partial<HorizonPlay> & { ticker: string }): HorizonPlay {
  return {
    ticker: overrides.ticker,
    direction: overrides.direction ?? "LONG",
    horizon: "SWING",
    score: overrides.score ?? 70,
    status: overrides.status ?? "WATCH",
    contract: overrides.contract ?? {
      ticker: overrides.ticker,
      strike: 100,
      right: "C",
      expiry: "2026-09-20",
      dte: 13,
      mid: 5,
      bid: 4.9,
      ask: 5.1,
      delta: 0.5,
      openInterest: 1000,
    },
    scoreFloor: 60,
    reason: overrides.reason ?? "test",
    liveStatus: overrides.liveStatus,
    livePnlPct: overrides.livePnlPct,
    ...overrides,
  };
}

test("parseSwingPlayId: extracts ticker and position id", () => {
  assert.deepEqual(parseSwingPlayId("SWING:NRG"), { ticker: "NRG", positionId: null });
  assert.deepEqual(parseSwingPlayId("SWING:AAPL:36"), { ticker: "AAPL", positionId: 36 });
});

test("resolveBriefIvRank: dossier read wins over pinned feature_vector", () => {
  assert.equal(resolveBriefIvRank({ dossierIvRank: 72, featureVector: { iv_rank: 40 } }), 72);
});

test("resolveBriefIvRank: falls back to commit-pinned iv_rank", () => {
  assert.equal(resolveBriefIvRank({ dossierIvRank: null, featureVector: { iv_rank: 43 } }), 43);
});

test("resolveBriefIvRank: null when neither source present", () => {
  assert.equal(resolveBriefIvRank({ dossierIvRank: null, featureVector: null }), null);
});

test("pickLanePlayForBrief: prefers live OPEN row over WATCH when status hint is HOLD", () => {
  const rows = [
    laneRow({
      ticker: "NRG",
      score: 62,
      contract: { ticker: "NRG", strike: 115, right: "C", expiry: "x", dte: 14, mid: 3, bid: null, ask: null, delta: 0.4, openInterest: 0 },
    }),
    laneRow({
      ticker: "NRG",
      score: 27,
      liveStatus: "HOLD",
      livePnlPct: 98,
      contract: { ticker: "NRG", strike: 110, right: "C", expiry: "x", dte: 13, mid: 9, bid: null, ask: null, delta: 0.5, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "NRG", { status: "HOLD", strike: 110, right: "C" });
  assert.equal(picked?.contract.strike, 110);
  assert.equal(picked?.liveStatus, "HOLD");
});

test("pickLanePlayForBrief: prefers live OPEN row over WATCH when status hint absent", () => {
  const rows = [
    laneRow({
      ticker: "NRG",
      score: 62,
      contract: { ticker: "NRG", strike: 115, right: "C", expiry: "x", dte: 14, mid: 3, bid: null, ask: null, delta: 0.4, openInterest: 0 },
    }),
    laneRow({
      ticker: "NRG",
      score: 27,
      liveStatus: "HOLD",
      livePnlPct: 98,
      contract: { ticker: "NRG", strike: 110, right: "C", expiry: "x", dte: 13, mid: 9, bid: null, ask: null, delta: 0.5, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "NRG", {});
  assert.equal(picked?.contract.strike, 110);
  assert.equal(picked?.liveStatus, "HOLD");
});

test("pickLanePlayForBrief: contract strike disambiguates same ticker", () => {
  const rows = [
    laneRow({
      ticker: "META",
      contract: { ticker: "META", strike: 570, right: "C", expiry: "x", dte: 9, mid: 10, bid: null, ask: null, delta: 0.45, openInterest: 0 },
    }),
    laneRow({
      ticker: "META",
      score: 50,
      contract: { ticker: "META", strike: 580, right: "C", expiry: "x", dte: 14, mid: 8, bid: null, ask: null, delta: 0.4, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "META", { strike: 580, right: "C" });
  assert.equal(picked?.contract.strike, 580);
});

// ── loadOpenTerminalPlay: Ask Largo must restore factors/regime the same way the main board does ──
//
// THE BUG (swing-system CTO audit, 2026-09-06, finding #3/#8/#9/#17/#20): serving-lane.ts's
// `getSwingServingLane` already restores a committed row's factors/regime via
// `attachThesisExplanation` (its own header comment begins "THE BUG.") — but that enrichment only
// ever reached the main `/horizons` board. play-brief-resolve.ts's `loadOpenTerminalPlay` (the Ask
// Largo resolver) called `livePlayFromSwingPosition` directly with no equivalent step, so every
// live swing position's `computeSwingThesisHealth` regime pillar fell to its generic "unread"
// default — confirmed live: all 4 currently-committed positions rendered the byte-identical
// "46% · Degraded" thesis-health reading regardless of real P&L.

function accum(direction: "bull" | "bear", days: number) {
  return {
    direction, strength: 80, days,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100, magnet_side: direction === "bull" ? "call" as const : "put" as const, aligned: true,
  };
}
const bullReads: SwingReads = {
  accumulation: accum("bull", 4), flowWindowDays: 5, returnPct10d: 8, spyReturnPct10d: 1,
  priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true,
};
function dossierInput(ticker: string): SwingDossierInput {
  return {
    ticker, intendedDte: 14, asOf: "2026-09-02T20:00:00.000Z", reads: bullReads,
    structure: { priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true },
    relStrength: { nameReturnPct: 8, spyReturnPct: 1 },
    flow: { accumAlignedDays: 4, accumTotalDays: 5 },
    volatility: { contractQuality01: 0.7, thetaBurden01: 0.3 },
    regime01: 0.6, dataQuality01: 0.9,
  };
}

function openRow(ticker: string, id: number): SwingPositionRow {
  return {
    id,
    commit_key: `k-${ticker}`,
    root_position_id: null,
    parent_position_id: null,
    roll_seq: 0,
    session_date: "2026-09-02",
    ticker,
    direction: "long",
    sub_lane: "STANDARD",
    archetype: "BREAKOUT",
    top_flow_strike: null,
    contract_strike: 110,
    contract_expiry: "2026-09-18",
    contract_type: "call",
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
    feature_vector: { evidence_score: 27.2 },
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

let mockOpenRows: SwingPositionRow[] = [];
let mockDiscovered: {
  dossiers: ReturnType<typeof buildSwingDossier>[];
  plays: never[];
  readsByTicker?: Map<string, SwingReads>;
} | null = null;
let mockLaneRows: HorizonPlay[] = [];

mock.module("../db", {
  namedExports: {
    fetchOpenSwingPositions: async () => mockOpenRows,
    fetchLatestSwingSnapshotEvents: async () => new Map(),
    fetchSwingPositionsRange: async () => [],
    fetchSwingPositionChain: async () => [],
  },
});

// vector-pick-leaders-db.ts guards itself with `import "server-only"` (Next.js RSC-only marker),
// which throws when loaded outside a server component — mock it purely to dodge that guard.
mock.module("../vector/vector-pick-leaders-db", {
  namedExports: { fetchVectorPickLeaderRows: async () => [] },
});

mock.module("./serving-lane", {
  namedExports: {
    // Real implementations — these are exactly what this test is proving gets WIRED IN.
    attachThesisExplanation,
    dossiersByTicker,
    // Stubs — unused by loadOpenTerminalPlay, but the module must export something for them.
    getSwingServingLane: async () => ({
      sections: { WATCH: mockLaneRows },
      scanAsOf: "2026-09-06T18:00:00.000Z",
      scanSessionDay: "2026-09-06",
    }),
    discoverSwingFromPersisted: async () => mockDiscovered,
    readSwingServingSnapshot: async () => null,
  },
});

describe("loadOpenTerminalPlay: restores factors/regime for a committed row (Largo thesis-health fix)", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("a committed row with a matching dossier gets factors + regime attached", async () => {
    mockOpenRows = [openRow("NRG", 34)];
    mockDiscovered = { dossiers: [buildSwingDossier(dossierInput("NRG"))], plays: [] };

    const play = await mod.loadOpenTerminalPlay("NRG", { positionId: 34 });
    assert.ok(play, "the committed play must resolve");
    assert.ok(
      (play!.thesisHealth?.pillars?.length ?? 0) > 0,
      "thesis health must compute for a working position",
    );
    const regimePillar = play!.thesisHealth?.pillars?.find((p) => p.id === "market");
    assert.ok(regimePillar, "regime/market pillar must be present");
    assert.notEqual(
      regimePillar!.currentLabel,
      "unread",
      "with a matching dossier attached, the regime pillar must not read the generic 'unread' default",
    );
  });

  test("no matching dossier → the row is left honest (no invented regime)", async () => {
    mockOpenRows = [openRow("ZZZ", 99)];
    mockDiscovered = { dossiers: [], plays: [] };

    const play = await mod.loadOpenTerminalPlay("ZZZ", { positionId: 99 });
    assert.ok(play, "the committed play must still resolve");
    const regimePillar = play!.thesisHealth?.pillars?.find((p) => p.id === "market");
    assert.equal(
      regimePillar?.currentLabel,
      "unread",
      "no dossier means no regime read — the honest default must stand, never an invented one",
    );
  });
});

describe("resolveSwingPlayForBrief: WATCH lane restores factors/regime (parity with open path)", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("a WATCH lane row with a matching dossier gets factors + regime attached", async () => {
    mockOpenRows = [];
    mockLaneRows = [
      laneRow({
        ticker: "NVDA",
        status: "WATCH",
        factors: [],
        regime: null,
      }),
    ];
    mockDiscovered = {
      dossiers: [buildSwingDossier(dossierInput("NVDA"))],
      plays: [],
      readsByTicker: new Map([["NVDA", bullReads]]),
    };

    const resolved = await mod.resolveSwingPlayForBrief({ playId: "SWING:NVDA", ticker: "NVDA" });
    assert.ok(resolved, "the WATCH lane play must resolve");
    assert.ok((resolved!.play.factors?.length ?? 0) > 0, "factors must be restored from dossier");
    assert.ok(resolved!.play.regime != null, "regime must be restored from dossier for WATCH rows");
  });
});
