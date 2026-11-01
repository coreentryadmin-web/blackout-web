import test from "node:test";
import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { HorizonPlay } from "@/lib/horizon-plays";
import {
  pickLanePlayForBrief,
  pickOpenBangerPositionForBrief,
  parseSwingPlayId,
  resolveBriefIvRank,
  rightFromContractType,
} from "./play-brief-resolve-pure";
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

// BUG FIX (2026-09-22, Ask Largo standing mandate — Largo C3 absence, same shape as #5401's
// roll-history fix and this cycle's closed-plays.ts/live-plays.ts sibling fixes).
// `rightFromContractType` backs `rowContractMatches` in play-brief-resolve.ts, a function that
// exists specifically to fix ticker-collision identity bugs (file header: "NRG OPEN 110C vs WATCH
// 115C"). The old inline `contract_type === "put" ? "P" : "C"` ternary made a row whose real
// contract_type was never recorded FALSELY MATCH a hint asking for "C" — a correctness bug in
// WHICH position resolves, not just cosmetic narrative. (Tested here via the pure helper rather
// than `rowContractMatches` itself, since play-brief-resolve.ts pulls in the server-only-guarded
// DB/Vector import chain and cannot be imported from a plain node:test file.)
describe("rightFromContractType — absence must not resolve to either side", () => {
  it("null contract_type maps to null, not a fabricated 'C'", () => {
    assert.equal(rightFromContractType(null), null);
  });

  it("an unrecognized contract_type value also maps to null, same fail-closed rule", () => {
    assert.equal(rightFromContractType("unknown"), null);
  });

  it("a real 'call' maps to 'C' and a real 'put' maps to 'P'", () => {
    assert.equal(rightFromContractType("call"), "C");
    assert.equal(rightFromContractType("put"), "P");
  });
});

test("parseSwingPlayId: extracts ticker and position id", () => {
  assert.deepEqual(parseSwingPlayId("SWING:NRG"), { ticker: "NRG", positionId: null });
  assert.deepEqual(parseSwingPlayId("SWING:AAPL:36"), { ticker: "AAPL", positionId: 36 });
});

test("resolveSwingPlayForBrief: blank ticker hint falls back to playId ticker", () => {
  const parsed = parseSwingPlayId("SWING:NRG");
  assert.equal(parsed.ticker, "NRG");
  // Route passes "" when ?ticker= omitted — resolver must treat blank as absent.
  const effective = ("".trim() || parsed.ticker).toUpperCase();
  assert.equal(effective, "NRG");
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

// BUG FIX (2026-10-20, Ask Largo standing mandate — live-reproduced two-leg repro, found by the
// 5-engine/Largo fresh-angle audit). `contractMatches` (play-brief-resolve-pure.ts) used to
// short-circuit `if (strike == null) return true;` BEFORE ever checking `right`, so a caller
// supplying only `right` (no `strike`) matched EVERY same-ticker contract regardless of call/put —
// exactly the Largo tool's own documented call shape ("Optional positionId/strike/right/status
// disambiguate ... omit them for the single obvious match," any subset, including right alone).
test("pickLanePlayForBrief: right-only hint (no strike) picks the matching side, not the higher-scored one", () => {
  // Scores deliberately favor the WRONG (call) leg so the old buggy code's score-tiebreak
  // (byContract.sort((a,b)=>b.score-a.score)[0] over an unfiltered-by-right byContract) cannot
  // accidentally land on the right answer — only an actual right-filter can pick the put here.
  const rows = [
    laneRow({
      ticker: "XYZ",
      score: 90,
      contract: { ticker: "XYZ", strike: 100, right: "C", expiry: "x", dte: 14, mid: 5, bid: null, ask: null, delta: 0.5, openInterest: 0 },
    }),
    laneRow({
      ticker: "XYZ",
      score: 50,
      contract: { ticker: "XYZ", strike: 90, right: "P", expiry: "x", dte: 14, mid: 5, bid: null, ask: null, delta: -0.5, openInterest: 0 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "XYZ", { right: "P" });
  assert.equal(picked?.contract.right, "P", "a right=P request must never resolve to the call leg");
  assert.equal(picked?.contract.strike, 90);
});

// BANGER-ORIGIN IDENTITY FIX (Ask Largo standing mandate, 2026-09-21). Live-repro'd on ABTC
// 2026-09-21: two concurrent banger-origin swing positions (9.5C TRIM +200%, 10.5C OPEN +25%),
// each carrying its own real `positionId` (banger_positions.id — see banger-lane-merge.ts).
// `?playId=SWING:ABTC:1220` and `?playId=SWING:ABTC:1185` (and the equivalent `&positionId=`
// query-param forms) both resolved to the IDENTICAL 9.5C brief before this fix — the positionId
// hint was silently dropped by `pickLanePlayForBrief` (it only ever checked strike/right/status),
// so with neither given, resolution fell to the highest-live-P&L tiebreak regardless of which
// position was actually asked about.
test("pickLanePlayForBrief: exact positionId hint resolves the SPECIFIC banger-origin leg, not the highest-P&L one", () => {
  const rows = [
    laneRow({
      ticker: "ABTC",
      score: 62,
      positionId: 1185,
      liveStatus: "TRIM",
      livePnlPct: 200,
      contract: { ticker: "ABTC", strike: 9.5, right: "C", expiry: "2026-09-25", dte: 4, mid: 1.05, bid: null, ask: null, delta: null, openInterest: 0 },
    }),
    laneRow({
      ticker: "ABTC",
      score: 65,
      positionId: 1220,
      liveStatus: "OPEN",
      livePnlPct: 25,
      contract: { ticker: "ABTC", strike: 10.5, right: "C", expiry: "2026-09-25", dte: 4, mid: 0.5, bid: null, ask: null, delta: null, openInterest: 0 },
    }),
  ];
  // Without the fix, no strike/right/status hint means the sort-by-livePnlPct fallback always wins
  // — asking for 1220 (the LOWER P&L leg) must still return 1220, not silently swap to 1185.
  const pickedLowerPnl = pickLanePlayForBrief(rows, "ABTC", { positionId: 1220 });
  assert.equal(pickedLowerPnl?.positionId, 1220);
  assert.equal(pickedLowerPnl?.contract.strike, 10.5);

  const pickedHigherPnl = pickLanePlayForBrief(rows, "ABTC", { positionId: 1185 });
  assert.equal(pickedHigherPnl?.positionId, 1185);
  assert.equal(pickedHigherPnl?.contract.strike, 9.5);
});

// BUG FIX (2026-10-24, Ask Largo standing mandate, live repro PANW: `GET
// /api/market/swing/play-brief?playId=SWING:PANW:2103` returned a 200 whose own `playId` field
// read back "SWING:PANW:67" — a completely different, unrelated position). `#2103` is a real,
// open banger_positions row on PANW that `mergeBangerPositionsIntoSwingPlays` deliberately excludes
// from the board's `rows` (a native swing ledger position already manages this ticker), so `rows`
// here carries only the ONE unrelated native row. The old `forTicker.length === 1` shortcut
// returned that lone row unconditionally — even though the caller asked for a SPECIFIC positionId
// this row does not carry. Must now surface as absence (null) so the caller's broader fallback
// chain gets a chance to report "not found" honestly, instead of being told the request succeeded
// under a different play's id.
test("pickLanePlayForBrief: a positionId hint that does not match the ticker's one lane row must not silently substitute that row", () => {
  const rows = [
    laneRow({
      ticker: "PANW",
      positionId: 67,
      liveStatus: "HOLD",
      contract: { ticker: "PANW", strike: 370, right: "C", expiry: "2026-10-30", dte: 6, mid: 19.45, bid: null, ask: null, delta: 0.65, openInterest: 258 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "PANW", { positionId: 2103 });
  assert.equal(picked, null, "an unresolvable positionId must surface as absence, never the ticker's unrelated lone row");
});

test("pickLanePlayForBrief: the lone-row shortcut still fires normally when no positionId was requested", () => {
  const rows = [
    laneRow({
      ticker: "PANW",
      positionId: 67,
      liveStatus: "HOLD",
      contract: { ticker: "PANW", strike: 370, right: "C", expiry: "2026-10-30", dte: 6, mid: 19.45, bid: null, ask: null, delta: 0.65, openInterest: 258 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "PANW", {});
  assert.equal(picked?.positionId, 67, "a ticker-only lookup with no positionId hint must still resolve the sole candidate");
});

test("pickLanePlayForBrief: the lone-row shortcut still fires when the positionId hint actually matches", () => {
  const rows = [
    laneRow({
      ticker: "PANW",
      positionId: 67,
      liveStatus: "HOLD",
      contract: { ticker: "PANW", strike: 370, right: "C", expiry: "2026-10-30", dte: 6, mid: 19.45, bid: null, ask: null, delta: 0.65, openInterest: 258 },
    }),
  ];
  const picked = pickLanePlayForBrief(rows, "PANW", { positionId: 67 });
  assert.equal(picked?.positionId, 67, "a positionId hint that matches the sole candidate must still resolve it");
});

// ── pickOpenBangerPositionForBrief: banger-origin fallback for loadOpenTerminalPlay ──
//
// BUG FIX (2026-10-26, Ask Largo standing mandate, live repro PANW positionId=2103). PANW carries
// a native swing_positions COMMIT row (id 67) AND a separate, fully live banger_positions OPEN row
// (id 2103) — `getSwingServingLane` drops the banger row from its merge because the native row
// already covers the ticker, so `?playId=SWING:PANW&ticker=PANW&positionId=2103` 404'd even though
// the member is actually holding that exact position. `loadOpenTerminalPlay` now falls through to
// a direct `banger_positions` lookup (via this pure selector) whenever the native-table lookup
// finds nothing. Same fail-closed discipline as `pickLanePlayForBrief`'s own 2026-10-24 PANW fix
// just above: an explicit, unresolvable positionId must surface as absence, never an unrelated
// substitute.
type FakeBangerRow = { id: number; ticker: string };

test("pickOpenBangerPositionForBrief: resolves the exact positionId among several same-ticker rows", () => {
  const rows: FakeBangerRow[] = [
    { id: 2103, ticker: "PANW" },
    { id: 2200, ticker: "PANW" },
  ];
  const picked = pickOpenBangerPositionForBrief(rows, "PANW", 2103);
  assert.equal(picked?.id, 2103);
});

test("pickOpenBangerPositionForBrief: a positionId that does not match the ticker's one row must not silently substitute that row", () => {
  const rows: FakeBangerRow[] = [{ id: 2103, ticker: "PANW" }];
  const picked = pickOpenBangerPositionForBrief(rows, "PANW", 9999);
  assert.equal(picked, null, "an unresolvable positionId must surface as absence, never the ticker's unrelated lone row");
});

test("pickOpenBangerPositionForBrief: no positionId hint resolves the ticker's sole candidate (live PANW repro)", () => {
  const rows: FakeBangerRow[] = [{ id: 2103, ticker: "PANW" }];
  const picked = pickOpenBangerPositionForBrief(rows, "PANW", null);
  assert.equal(picked?.id, 2103);
});

test("pickOpenBangerPositionForBrief: no positionId hint with multiple same-ticker rows must not guess — surfaces absence", () => {
  const rows: FakeBangerRow[] = [
    { id: 2103, ticker: "PANW" },
    { id: 2200, ticker: "PANW" },
  ];
  const picked = pickOpenBangerPositionForBrief(rows, "PANW", null);
  assert.equal(picked, null, "an ambiguous ticker with no positionId hint must not guess which open banger row was meant");
});

test("pickOpenBangerPositionForBrief: no rows for the ticker at all returns null", () => {
  const rows: FakeBangerRow[] = [{ id: 2103, ticker: "NET" }];
  const picked = pickOpenBangerPositionForBrief(rows, "PANW", 2103);
  assert.equal(picked, null);
});

test("pickOpenBangerPositionForBrief: ticker match is case-insensitive", () => {
  const rows: FakeBangerRow[] = [{ id: 2103, ticker: "panw" }];
  const picked = pickOpenBangerPositionForBrief(rows, "PANW", 2103);
  assert.equal(picked?.id, 2103);
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
let mockClosedRows: SwingPositionRow[] = [];
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
    fetchSwingPositionsRange: async () => mockClosedRows,
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

  test("C4 IDENTITY: a committed row's real ledger contract_occ is preferred over a reconstructed guess (LARGO-PRODUCT-CONTRACT.md)", async () => {
    // commit.ts stamps contract_occ at insert via occFromChainContract, and roll-plan.ts
    // re-stamps it on a roll — it is the ledger's own authoritative record of exactly which
    // contract is held. play-brief-resolve.ts's horizonRowToDeckSource() used to discard it
    // unconditionally (occ: null) even though the row carrying it was already in scope at this
    // exact call site, silently falling back on terminalPlayFromHorizon's strike/expiry/right
    // RECONSTRUCTION (adapters.ts's own occFromChainContract fallback) instead of the ledger's
    // stored value. The two agree in the common case (this test uses a strike/expiry/right that
    // reconstructs to the SAME symbol) — the fix's value is preferring the authoritative source
    // when they could diverge (e.g. mid-roll), and unblocking the SSE live-marks overlay
    // (use-live-marks.ts's overlayLiveMarks gates its lookup on `p.occ`) from depending on that
    // reconstruction path at all for a position the ledger already identifies unambiguously.
    const row = openRow("NRG", 34);
    // Deliberately mismatched vs strike/expiry/right (110/2026-09-18/C, which reconstruction
    // would use) — proves the ledger's stored occ WINS over reconstruction, not merely that the
    // two happen to agree. A real divergence like this can occur transiently around a roll.
    row.contract_occ = "NRG261016C00115000";
    mockOpenRows = [row];
    mockDiscovered = { dossiers: [buildSwingDossier(dossierInput("NRG"))], plays: [] };

    const play = await mod.loadOpenTerminalPlay("NRG", { positionId: 34 });
    assert.ok(play, "the committed play must resolve");
    assert.equal(
      play!.occ,
      "O:NRG261016C00115000",
      "a committed row's stored contract_occ must win over a strike/expiry/right reconstruction, normalized O:-prefixed",
    );
  });

  // BUG FIX (2026-10-20, Ask Largo standing mandate — same defect class as pickLanePlayForBrief's
  // sibling fix above, found the same cycle). `rowContractMatches` had the identical short-circuit:
  // `if (strike == null) return true;` ran before `right` was ever checked, so a right-only hint
  // matched every open row for the ticker regardless of call/put.
  test("BUG FIX: right-only hint (no strike, no positionId) resolves the matching side, not just the first row", async () => {
    const callRow = { ...openRow("DUAL", 10), contract_strike: 100, contract_type: "call" };
    const putRow = { ...openRow("DUAL", 11), contract_strike: 95, contract_type: "put" };
    mockOpenRows = [callRow, putRow];
    mockDiscovered = { dossiers: [], plays: [] };

    const play = await mod.loadOpenTerminalPlay("DUAL", { right: "P" });
    assert.ok(play, "the committed play must resolve");
    assert.ok(
      play!.contract.includes("95"),
      `a right=P request must resolve the put leg (strike 95), not the call — got contract "${play!.contract}"`,
    );
  });

  // BUG FIX (2026-10-24, Ask Largo standing mandate, live repro PANW — same defect class as
  // pickLanePlayForBrief's sibling fix, found the same cycle). `fetchOpenSwingPositions()` only
  // ever carries `swing_positions` rows, so a request for a banger-origin sibling's REAL id (e.g.
  // the live PANW #2103 case: a genuinely open banger_positions row this ticker's native position
  // already won the board's single display slot against) can NEVER match here — `matches` holds
  // only the one unrelated native row. The old `matches.length === 1` fallback took that lone row
  // anyway, so `loadOpenTerminalPlay("PANW", { positionId: 2103 })` silently returned the NATIVE
  // #67 row's full data under the requested #2103 id. Must now return null so the caller's broader
  // fallback chain gets an honest chance to report "not found" instead of a false substitute.
  test("BUG FIX: a positionId hint that matches no open row must not fall back to the ticker's one other row", async () => {
    mockOpenRows = [openRow("PANW", 67)];
    mockDiscovered = { dossiers: [], plays: [] };

    const play = await mod.loadOpenTerminalPlay("PANW", { positionId: 2103 });
    assert.equal(play, null, "an unresolvable positionId must surface as absence, never the ticker's unrelated lone row");
  });

  test("the lone-row fallback still fires normally when no positionId was requested", async () => {
    mockOpenRows = [openRow("PANW", 67)];
    mockDiscovered = { dossiers: [], plays: [] };

    const play = await mod.loadOpenTerminalPlay("PANW", {});
    assert.ok(play, "a ticker-only lookup with no positionId hint must still resolve the sole open row");
  });

  // BUG FIX (2026-10-31, Ask Largo standing mandate, live repro MRNA). Same failure CLASS as the
  // PANW `positionId`-with-no-match tests above, caught by a different trigger: a caller that also
  // sends a `status` hint alongside a failed positionId/strike/right hint. Before this fix, the
  // status-only fallback block (play-brief-resolve.ts, a few lines below the PANW `matches.length
  // === 1` guard) took the ticker's one WORKING-status native row WITHOUT ever re-checking it
  // against the positionId/strike/right the caller had already, explicitly, asked for and failed to
  // match — exactly the shape `useSwingPlayBrief`'s `briefUrl()` sends for every open position
  // (playId + ticker + positionId + status + strike + right). Live repro: MRNA carried native row
  // #68 (195C, HOLD) plus two banger-origin positions (#2240 225C, #2167 217.5C) that never appear
  // in `fetchOpenSwingPositions()` at all; `?positionId=2240&status=HOLD&strike=225&right=C`
  // resolved to #68 (wrong) instead of #2240. Removing only `status` from the request correctly
  // returned null here too (banger lookup unavailable in this unit test, same as the PANW test
  // above) — isolating `status` as what re-introduced the wrong substitution.
  test("BUG FIX: a status hint must not override a positionId/strike/right hint that already failed to match (live MRNA repro)", async () => {
    // The ticker's ONE native row — status HOLD (a WORKING status), but a DIFFERENT contract
    // (195C) than the banger-origin position actually being asked about (225C, positionId 2240).
    mockOpenRows = [{ ...openRow("MRNA", 68), contract_strike: 195, contract_type: "call", status: "HOLD" }];
    mockDiscovered = { dossiers: [], plays: [] };

    const play = await mod.loadOpenTerminalPlay("MRNA", {
      positionId: 2240,
      strike: 225,
      right: "C",
      status: "HOLD",
    });
    assert.equal(
      play,
      null,
      "a failed positionId/strike/right hint plus a matching status must fall through to the banger " +
        "lookup (null here, since it's unmocked), never silently substitute the unrelated native row #68",
    );
  });

  // Preserves the status-fallback's LEGITIMATE purpose: a caller sending ONLY a status hint (no
  // positionId/strike/right at all) against a genuinely ambiguous native-only ticker must still get
  // disambiguated by status, exactly as before this fix — the fix narrows the gate, it does not
  // remove the block.
  test("a status-only hint (no positionId/strike/right) still disambiguates an otherwise-ambiguous native-only ticker", async () => {
    mockOpenRows = [
      // PENDING is a valid `fetchOpenSwingPositions` status (excluded only CLOSED/ROLLED) but is
      // NOT in the WORKING set — so this row must be filtered OUT by the status fallback, leaving
      // exactly one genuine WORKING candidate for the hint to resolve.
      { ...openRow("DUO", 301), contract_strike: 50, contract_type: "call", status: "PENDING" },
      { ...openRow("DUO", 302), contract_strike: 60, contract_type: "call", status: "HOLD" },
    ];
    mockDiscovered = { dossiers: [], plays: [] };

    const play = await mod.loadOpenTerminalPlay("DUO", { status: "HOLD" });
    assert.ok(play, "a status-only hint against an ambiguous native-only ticker must still resolve");
    assert.ok(
      play!.contract.includes("60"),
      `must resolve the HOLD-status (WORKING) row, strike 60 — not the non-WORKING PENDING row — got contract "${play!.contract}"`,
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

// A caller supplying `positionId` as a SEPARATE query param (the route's own documented shape —
// `?playId=SWING:NRG&ticker=NRG&positionId=34` — and Largo's tool-call convention, distinct from
// the frontend hook's playId-embedded `SWING:TICKER:ID` form) must resolve a CLOSED position just
// as reliably as one that embeds the id in playId. Live repro (2026-09-11, SWING:INTC): a caller
// asking for a specific closed/graded position by separate positionId got back an unrelated LIVE
// WATCH-lane row for the same ticker instead, because the two closed-play lookups in
// resolveSwingPlayForBrief guarded on `parsed.positionId` (parsed ONLY from the playId string) —
// always null for this call shape — rather than the fully-resolved `positionId` variable that
// already merges the separate query param.
describe("resolveSwingPlayForBrief: a separately-supplied positionId must resolve the CLOSED position, not an unrelated live WATCH row for the same ticker", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("positionId as a query param (playId has no embedded id) still finds the closed position over a same-ticker WATCH row", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      {
        ...openRow("INTC", 30),
        status: "CLOSED",
        graded_at: "2026-09-08T20:00:00.000Z",
        closed_at: "2026-09-08T20:00:00.000Z",
        realized_pnl_pct: 12.3,
      },
    ];
    // A DIFFERENT, currently-live WATCH candidate for the same ticker — exactly the shape that
    // silently won before this fix, because the closed-play guard never fired.
    mockLaneRows = [laneRow({ ticker: "INTC", status: "WATCH" })];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({
      playId: "SWING:INTC", // no embedded position id — parsed.positionId is null
      ticker: "INTC",
      positionId: 30, // supplied separately, as the route's own docstring example shows
    });

    assert.ok(resolved, "must resolve to something");
    assert.equal(
      resolved!.play.status,
      "CLOSED",
      `must resolve the CLOSED position (id 30), not the live WATCH row — got status "${resolved!.play.status}"`,
    );
  });
});

// BUG FIX (2026-10-20, Ask Largo standing mandate, adversarially verified, Workflow static sweep
// batch 17). A caller that supplies a specific positionId which fails to resolve through EVERY
// targeted lookup (open ledger, both positionId-based closed checks, the chain-root retry) used to
// fall through to the unconditional `loadClosedPlay(ticker, null)` fallback, which ignores
// positionId entirely and returns whichever graded row for the ticker is most recently closed — a
// completely different trade than the one asked about, with no absence/error signal at all.
describe("resolveSwingPlayForBrief: a positionId that fails to resolve anywhere must return absence, never an UNRELATED closed position for the same ticker", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("positionId outside every lookup's fetch window resolves to null, not the only other closed row for this ticker", async () => {
    mockOpenRows = [];
    // The requested positionId (501) is NOT present anywhere the fetch covers — simulating it
    // falling outside loadClosedPlay/resolveChainRootId's shared 90-day window. A DIFFERENT,
    // more-recently-closed position for the SAME ticker is the only row returned — exactly the
    // shape that silently won before this fix, because the final fallback never checked positionId.
    mockClosedRows = [
      {
        ...openRow("ABC", 777),
        status: "CLOSED",
        graded_at: "2026-10-18T20:00:00.000Z",
        closed_at: "2026-10-18T20:00:00.000Z",
        realized_pnl_pct: 41.2,
      },
    ];
    mockLaneRows = [];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({
      playId: "SWING:ABC",
      ticker: "ABC",
      positionId: 501, // not id 777, not root_position_id 777 — genuinely unresolvable here
    });

    assert.equal(
      resolved,
      null,
      "an unresolvable positionId must surface as honest absence, never silently substitute the " +
        "unrelated closed position (id 777) that happens to exist for this ticker",
    );
  });

  test("with NO positionId supplied at all, the ticker-wide closed fallback is unchanged (still resolves the most recent closed row)", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      {
        ...openRow("ABC", 777),
        status: "CLOSED",
        graded_at: "2026-10-18T20:00:00.000Z",
        closed_at: "2026-10-18T20:00:00.000Z",
        realized_pnl_pct: 41.2,
      },
    ];
    mockLaneRows = [];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({ playId: "SWING:ABC", ticker: "ABC" });

    assert.ok(resolved, "with no specific position asked about, the ticker-wide fallback must still fire");
    assert.equal(resolved!.play.status, "CLOSED");
  });
});

// BUG FOUND 2026-09-27 (Ask Largo standing mandate, live 5-engine monitor cycle). Unlike the
// INTC case above (positionId supplied separately), a caller with ONLY a ticker + an explicit
// `status=CLOSED` hint — no positionId at all — had NO guard: `pickLanePlayForBrief` never reads
// `hints.status`, so it happily matched the ticker against a live lane row and returned it,
// silently overriding the caller's explicit request for the CLOSED play. Live repro:
// `GET /api/market/swing/play-brief?playId=SWING:HUT&ticker=HUT&status=CLOSED` (no positionId)
// returned an ACTIVE TRIM position (a different contract entirely) instead of the CLOSED one;
// the identical request WITH positionId correctly resolved the closed play. Fixed by skipping the
// lane fallback outright whenever `status` explicitly says CLOSED — lane rows are never closed
// (confirmed: serving-lane.ts has no CLOSED status path), so this can only ever help, not regress.
describe("resolveSwingPlayForBrief: ticker-only + status=CLOSED (no positionId) must resolve the CLOSED position, not an unrelated live lane row for the same ticker", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("status=CLOSED with no positionId skips the live lane row and finds the closed position", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      {
        ...openRow("HUT", 41),
        status: "CLOSED",
        graded_at: "2026-09-24T20:00:00.000Z",
        closed_at: "2026-09-24T20:00:00.000Z",
        realized_pnl_pct: -35.4,
      },
    ];
    // A DIFFERENT, currently-live TRIM candidate for the same ticker — exactly the shape that
    // silently won before this fix, because pickLanePlayForBrief never checked `status` at all.
    mockLaneRows = [laneRow({ ticker: "HUT", status: "TRIM" })];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({
      playId: "SWING:HUT", // no embedded position id
      ticker: "HUT",
      status: "CLOSED", // explicit hint, no positionId supplied at all
    });

    assert.ok(resolved, "must resolve to something");
    assert.equal(
      resolved!.play.status,
      "CLOSED",
      `must resolve the CLOSED position, not the live TRIM row — got status "${resolved!.play.status}"`,
    );
  });

  test("no status hint at all still prefers the live lane row (unchanged behavior)", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      { ...openRow("HUT", 41), status: "CLOSED", graded_at: "2026-09-24T20:00:00.000Z", closed_at: "2026-09-24T20:00:00.000Z" },
    ];
    mockLaneRows = [laneRow({ ticker: "HUT", status: "TRIM" })];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({ playId: "SWING:HUT", ticker: "HUT" });
    assert.ok(resolved, "must resolve to something");
    assert.notEqual(
      resolved!.play.status,
      "CLOSED",
      "with no status hint, the live lane row is still the reasonable default — this fix must not change that",
    );
  });
});

// BUG FOUND 2026-09-11 (Ask Largo standing mandate — roll-narrative trace, follow-up to #4794's
// OCC-identity fix). root_position_id is STICKY to the very first leg (roll.ts), never to an
// immediate parent, so a chain rolled TWICE — root(id=1)→rolled child(id=2, root_position_id=1)→
// currently-open grandchild(id=3, root_position_id=1) — cannot be found via id=2: no open row has
// id=2 or root_position_id=2, and the graded row that IS id=2 is ROLLED (not CLOSED), which
// closedDeckSourceFromRow correctly refuses. Before the fix this silently fell through to an
// unrelated ticker-only fallback instead of the live continuation.
describe("resolveSwingPlayForBrief: a chain rolled TWICE still resolves via an INTERMEDIATE leg's id", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("positionId pointing at the first (already-rolled-again) child resolves to the currently-OPEN grandchild leg", async () => {
    const root = { ...openRow("NRG", 1), status: "ROLLED", graded_at: "2026-09-05T20:00:00.000Z", root_position_id: null, roll_seq: 0 };
    const child = { ...openRow("NRG", 2), status: "ROLLED", graded_at: "2026-09-08T20:00:00.000Z", root_position_id: 1, roll_seq: 1, contract_strike: 115 };
    const grandchild = { ...openRow("NRG", 3), status: "OPEN", graded_at: null, root_position_id: 1, roll_seq: 2, contract_strike: 120 };
    // An UNRELATED second open NRG position (a totally different chain) — without this, a single
    // open row for the ticker would trivially "win" via loadOpenTerminalPlay's own `matches.length
    // === 1` fallback regardless of id matching, masking whether the chain-root resolution is
    // actually doing any work. With two open candidates, only correct id/root/chain-root matching
    // can pick the right one.
    const unrelated = { ...openRow("NRG", 99), status: "OPEN", graded_at: null, root_position_id: null, roll_seq: 0, contract_strike: 200 };

    mockOpenRows = [grandchild, unrelated];
    mockClosedRows = [root, child, grandchild, unrelated];
    mockLaneRows = []; // no unrelated WATCH candidate should be needed or picked
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({
      playId: "SWING:NRG",
      ticker: "NRG",
      positionId: 2, // the INTERMEDIATE leg's id — not the root (1), not the live leg (3)
    });

    assert.ok(resolved, "must resolve to something");
    // TerminalPlay.contract is a formatted label string (types.ts), e.g. "120C · 14DTE" — not an
    // object; the strike is embedded in it, which is enough to prove which leg actually resolved.
    assert.ok(
      resolved!.play.contract.includes("120"),
      `must resolve the currently-OPEN grandchild leg (strike 120), not fall through to an unrelated fallback — got contract "${resolved!.play.contract}"`,
    );
    assert.equal(resolved!.play.status, "OPEN", "the resolved play must be the live OPEN leg, not a terminal one");
  });
});

// BUG FOUND 2026-10-07 (Ask Largo standing mandate, live 5-engine monitor cycle, live repro SG
// 9C/9.5C — two concurrent banger-origin positions). `pickLanePlayForBrief` (proven above) DOES
// resolve the real, distinct `HorizonPlay` for a given positionId/strike hint, carrying its own
// correct `positionId` field (banger_positions.id, per banger-lane-merge.ts). But
// `resolveSwingPlayForBrief`'s lane-play branch then builds the final `TerminalPlay` via
// `horizonRowToDeckSource(enriched)` — called with ONLY the HorizonPlay, never a second
// `positionId` argument — and `horizonRowToDeckSource`'s own body does `positionId: positionId ??
// null`, reading ONLY the (omitted) parameter, never `p.positionId`. So the resolved play's `id`
// (`${horizon}:${ticker}${positionId ? ":"+positionId : ""}`) NEVER carries a positionId suffix
// for ANY lane-resolved play — confirmed live: `GET .../play-brief?playId=SWING:SG&ticker=SG`
// returned `"playId": "SWING:SG"` with no embedded id, for either of SG's two real concurrent
// positions.
//
// Blast radius: `bookContextSection` (play-brief-intel.ts) does
// `const { positionId } = parseSwingPlayId(play.id)` and passes `excludePositionId: positionId`
// to `checkPortfolioOverlap` ONLY when non-null — with positionId always null here, it silently
// falls back to `excludeSelfMatch: true`'s FIRST-ticker+direction-match-in-array heuristic
// (portfolio.ts), which is DB-query-order-dependent, not identity-based. Live-confirmed on SG:
// reviewing the 9C position (entry $0.33) AND reviewing the 9.5C position (entry $0.23)
// BOTH rendered "Book context" citing the SAME banger id (#1396) as "a separate position" —
// impossible unless one of the two reviews is citing ITSELF. The sibling "Other concurrent
// position(s)" section (built via `laneRows`, not `checkPortfolioOverlap`) independently and
// correctly named the TRUE other leg in both directions, proving the Book-context section alone
// was wrong. Fix: pass the HorizonPlay's own `positionId` through to `horizonRowToDeckSource` at
// this call site, exactly as `loadOpenTerminalPlay` already does a few lines up in this same file.
describe("resolveSwingPlayForBrief: a lane-resolved play (banger-origin or swing-native) keeps its own positionId", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("two concurrent same-ticker same-direction lane rows each resolve to a play.id carrying THEIR OWN positionId, not a dropped/null one", async () => {
    mockOpenRows = [];
    mockClosedRows = [];
    mockLaneRows = [
      laneRow({
        ticker: "SG",
        status: "TRIM",
        liveStatus: "TRIM",
        livePnlPct: -24.2,
        positionId: 1396,
        contract: { ticker: "SG", strike: 9, right: "C", expiry: "2026-10-09", dte: 2, mid: 0.25, bid: null, ask: null, delta: null, openInterest: 0 },
      }),
      laneRow({
        ticker: "SG",
        status: "TRIM",
        liveStatus: "TRIM",
        livePnlPct: -56.5,
        positionId: 1450,
        contract: { ticker: "SG", strike: 9.5, right: "C", expiry: "2026-10-09", dte: 2, mid: 0.1, bid: null, ask: null, delta: null, openInterest: 0 },
      }),
    ];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolvedLower = await mod.resolveSwingPlayForBrief({
      playId: "SWING:SG",
      ticker: "SG",
      positionId: 1396,
    });
    assert.ok(resolvedLower, "must resolve to something");
    assert.equal(
      resolvedLower!.play.id,
      "SWING:SG:1396",
      `resolved play.id must embed the SPECIFIC leg's own positionId (1396) — got "${resolvedLower!.play.id}" ` +
        `(a dropped/null positionId here is exactly what makes bookContextSection's self-exclusion fall back ` +
        `to the broken order-dependent heuristic — see the bug note above)`,
    );

    const resolvedHigher = await mod.resolveSwingPlayForBrief({
      playId: "SWING:SG",
      ticker: "SG",
      positionId: 1450,
    });
    assert.ok(resolvedHigher, "must resolve to something");
    assert.equal(
      resolvedHigher!.play.id,
      "SWING:SG:1450",
      `resolved play.id must embed the OTHER leg's own positionId (1450) — got "${resolvedHigher!.play.id}"`,
    );
  });
});

// REMOVED (2026-10-16, Ask Largo standing mandate — Bug 1 of the standing "Ask Largo x Night
// Hawk Swings" ownership mandate, live GOOG/KMPR repro): `reconcileLivePnlPctWithDisplayMark`
// (added 2026-10-09 for a live CTVA repro) and its describe block that used to sit here are both
// removed — the function recomputed `pnlPct` from a cent-rounded `mark`, which could itself
// disagree with the canonical `pnlPct` by up to 10 percentage points (live KMPR repro,
// positionId 1634). See `play-brief-context.ts`'s `loadSwingPlayBriefContext` and
// `play-brief.ts`'s `pnlForDisplay` for the full write-up of the fix (show the canonical value
// directly, no recompute) and `play-brief-context.test.ts`'s
// "pnlPct is the canonical livePnlPct, never a cent-rounded-mark recompute" block for the
// regression coverage that replaced this one.

// BUG FOUND 2026-10-26 (Ask Largo standing mandate, live repro MSTR). Same failure CLASS as the
// 2026-10-20 "ticker-wide closedFallback" fix above, caught by a different trigger: that fix
// guards against an unresolvable POSITION id silently substituting an unrelated closed trade; it
// never considered a caller that names a specific LIVE-LANE STATE (`status=WATCH`, the route's own
// documented hint, sent with NO positionId because a WATCH/lane-only candidate has none to embed —
// the exact shape `useSwingPlayBrief`'s `briefUrl()` builds for every WATCH-bucket play, and the
// exact shape Largo's own `get_swing_play_brief` tool sends when it carries a `status` hint). Live
// repro: `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR&status=WATCH` returned a
// `STOPPED — MSTR 160C 4DTE` CLOSED brief (-62.31%) while MSTR was a live, currently-listed WATCH
// candidate on the same session's board — because the live lane lookup legitimately found nothing
// for that instant (confirmed via two `/horizons` reads minutes apart) and, with positionId always
// null for a lane-only candidate, the unconditional ticker-wide fallback below fired anyway.
describe("resolveSwingPlayForBrief: an explicit live-lane status (WATCH/etc.) with no positionId must return absence, never an UNRELATED closed trade for the same ticker", () => {
  let mod: typeof import("./play-brief-resolve");

  before(async () => {
    mod = await import("./play-brief-resolve");
  });

  test("status=WATCH with no positionId and no current lane match returns null, not the ticker's unrelated closed trade", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      {
        ...openRow("MSTR", 45),
        status: "CLOSED",
        graded_at: "2026-10-20T20:00:00.000Z",
        closed_at: "2026-10-20T20:00:00.000Z",
        realized_pnl_pct: -62.31,
      },
    ];
    // The live lane legitimately carries NO row for this ticker right now (it rotated out between
    // scans) — exactly the shape that silently fell through to the closed trade before this fix.
    mockLaneRows = [];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({
      playId: "SWING:MSTR", // no embedded position id — a WATCH-lane candidate never has one
      ticker: "MSTR",
      status: "WATCH", // explicit live-lane hint, exactly what the UI/Largo send for a WATCH play
    });

    assert.equal(
      resolved,
      null,
      "an explicit live-lane status with no current lane match must surface as honest absence, " +
        "never silently substitute the ticker's unrelated closed trade",
    );
  });

  test("no status hint at all still falls back to the ticker's closed trade (unchanged ambiguous-query behavior)", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      {
        ...openRow("MSTR", 45),
        status: "CLOSED",
        graded_at: "2026-10-20T20:00:00.000Z",
        closed_at: "2026-10-20T20:00:00.000Z",
        realized_pnl_pct: -62.31,
      },
    ];
    mockLaneRows = [];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({ playId: "SWING:MSTR", ticker: "MSTR" });

    assert.ok(resolved, "with no status hint at all, the ticker-wide fallback must still fire");
    assert.equal(resolved!.play.status, "CLOSED");
  });

  test("a live lane match for the requested status still wins (unchanged — this fix only touches the no-match fallback)", async () => {
    mockOpenRows = [];
    mockClosedRows = [
      { ...openRow("MSTR", 45), status: "CLOSED", graded_at: "2026-10-20T20:00:00.000Z", closed_at: "2026-10-20T20:00:00.000Z" },
    ];
    mockLaneRows = [laneRow({ ticker: "MSTR", status: "WATCH" })];
    mockDiscovered = { dossiers: [], plays: [] };

    const resolved = await mod.resolveSwingPlayForBrief({ playId: "SWING:MSTR", ticker: "MSTR", status: "WATCH" });

    assert.ok(resolved, "must resolve to something");
    assert.notEqual(resolved!.play.status, "CLOSED", "a real live lane match must still win over the closed trade");
  });
});
