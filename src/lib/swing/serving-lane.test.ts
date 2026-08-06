import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSwingServingLane,
  discoverSwingFromPersisted,
  persistSwingServingSnapshot,
  type SwingDiscoveryLike,
} from "./serving-lane.ts";
import { buildSwingDossier, type SwingDossierInput } from "./dossier.ts";
import type { SwingReads } from "../swing-signals.ts";
import type { ZeroDteFlowAccumulation } from "../zerodte/flow-accumulation-context.ts";
import type { SwingServingReads } from "./serving-ingest.ts";
import type { HorizonPlay } from "../horizon-plays.ts";
import type { ChainContract } from "../horizon-fanout.ts";
import { swingThesisKey, type SwingWatchCandidate } from "./accumulation-store.ts";

function accum(direction: "bull" | "bear", days: number): ZeroDteFlowAccumulation {
  return {
    direction, strength: 80, days,
    net_signed_premium: direction === "bull" ? 5e6 : -5e6,
    magnet_strike: 100, magnet_side: direction === "bull" ? "call" : "put", aligned: true,
  };
}
const bull: SwingReads = {
  accumulation: accum("bull", 4), flowWindowDays: 5, returnPct10d: 8, spyReturnPct10d: 1,
  priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true,
};
function dossier(ticker: string): SwingDossierInput {
  return {
    ticker, intendedDte: 14, asOf: "2026-07-24T14:00:00.000Z", reads: bull,
    structure: { priceAboveEma20: true, ema20AboveEma50: true, ema50Rising: true },
    relStrength: { nameReturnPct: 8, spyReturnPct: 1 },
    flow: { accumAlignedDays: 4, accumTotalDays: 5 },
    volatility: { contractQuality01: 0.7, thetaBurden01: 0.3 },
    regime01: 0.6, dataQuality01: 0.9,
  };
}
const contract: ChainContract = {
  ticker: "AAA", right: "C", expiry: "2026-08-07", dte: 14, strike: 100,
  delta: 0.6, openInterest: 3000, bid: 1.2, ask: 1.3, mid: 1.25,
};
function play(over: Partial<HorizonPlay>): HorizonPlay {
  return { ticker: "AAA", direction: "LONG", horizon: "SWING", score: 80, status: "COMMIT", contract, scoreFloor: 60, reason: "r", ...over };
}

test("no discover injected → empty structured lane (member-safe default)", async () => {
  const lane = await getSwingServingLane();
  assert.equal(lane.committedCount, 0);
  assert.equal(lane.sections.COMMIT_NOW.length, 0);
  assert.equal(lane.scoreFloorGraduated, false);
});

test("discover returns null / empty plays → empty lane, no throw", async () => {
  assert.equal((await getSwingServingLane({ discover: async () => null })).watchCount, 0);
  assert.equal(
    (await getSwingServingLane({ discover: async () => ({ dossiers: [], plays: [] }) })).watchCount,
    0,
  );
});

test("discover throwing degrades to an empty lane — never throws the route", async () => {
  const lane = await getSwingServingLane({
    discover: async () => {
      throw new Error("DB down");
    },
  });
  assert.equal(lane.committedCount, 0);
  for (const s of Object.values(lane.sections)) assert.equal(s.length, 0);
});

test("assembles a real sectioned lane: WATCH + RESEARCH populate; setupState stamped from reads", async () => {
  const discover = async (): Promise<SwingDiscoveryLike> => ({
    dossiers: [buildSwingDossier(dossier("NVDA")), buildSwingDossier(dossier("WAT"))].map((d) => d),
    plays: [
      play({ ticker: "NVDA", status: "COMMIT", bucketGraduated: true }),
      play({ ticker: "WAT", status: "WATCH" }),
      play({ ticker: "RES", status: "WATCH" }), // no dossier match → RESEARCH
    ],
  });
  const readsByTicker = new Map<string, SwingServingReads>([
    // NVDA: LONG at the trigger, inside the window + graduated → COMMIT_NOW.
    ["NVDA", { setup: { price: 100.5, triggerPx: 100, invalidationPx: 90, atr: 3 }, entry: { price: 100.5, triggerPx: 100, atr: 3, entryZoneFar: 98 }, contract }],
    // WAT: LONG below the trigger → FORMING → WATCH.
    ["WAT", { setup: { price: 95, triggerPx: 100, invalidationPx: 90, atr: 3 } }],
  ]);

  const lane = await getSwingServingLane({ discover, readsByTicker });

  assert.equal(lane.sections.COMMIT_NOW.map((p) => p.ticker).join(","), "NVDA");
  assert.deepEqual(lane.sections.WATCH.map((p) => p.ticker), ["WAT"]);
  assert.deepEqual(lane.sections.RESEARCH.map((p) => p.ticker), ["RES"]);
  // Live-position sections empty without fetchOpenPositions.
  assert.equal(lane.sections.MANAGING.length + lane.sections.SCALING_OUT.length + lane.sections.EXITING.length, 0);
  // The stamped observable rode onto the play so the section router could place it.
  assert.equal(lane.sections.COMMIT_NOW[0]!.setupState, "TRIGGERED");
  assert.equal(lane.sections.COMMIT_NOW[0]!.entryStatus, "AT_TRIGGER");
  assert.equal(lane.sections.COMMIT_NOW[0]!.serving, "COMMIT_NOW"); // stamped by the section router
});

test("ungraduated AT_TRIGGER still reaches COMMIT_NOW — graduation is evidence-only (2026-08-06)", async () => {
  const discover = async (): Promise<SwingDiscoveryLike> => ({
    dossiers: [buildSwingDossier(dossier("NVDA"))],
    plays: [play({ ticker: "NVDA", status: "COMMIT", bucketGraduated: false })],
  });
  const readsByTicker = new Map<string, SwingServingReads>([
    ["NVDA", { setup: { price: 100.5, triggerPx: 100, invalidationPx: 90, atr: 3 }, entry: { price: 100.5, triggerPx: 100, atr: 3, entryZoneFar: 98 }, contract }],
  ]);
  const lane = await getSwingServingLane({ discover, readsByTicker });
  assert.equal(lane.sections.COMMIT_NOW.map((p) => p.ticker).join(","), "NVDA");
  assert.equal(lane.sections.WAITING_FOR_ENTRY.length, 0);
});

test("fetchOpenPositions populates MANAGING / SCALING_OUT / EXITING live sections", async () => {
  const openRows = [
    {
      id: 1,
      commit_key: "k1",
      root_position_id: null,
      parent_position_id: null,
      roll_seq: 0,
      session_date: "2026-07-24",
      ticker: "LIVE",
      direction: "long" as const,
      sub_lane: "STANDARD",
      archetype: "BREAKOUT",
      top_flow_strike: null,
      contract_strike: 100,
      contract_expiry: "2026-08-14",
      contract_type: "call",
      contract_occ: null,
      contract_delta: 0.6,
      entry_underlying_px: 100,
      thesis_invalidation_px: 90,
      target_underlying_px: 120,
      entry_premium: 5,
      last_mark: 5.5,
      peak_premium: 5.5,
      trough_premium: 5,
      underlying_mfe: 105,
      underlying_mae: 100,
      realized_pnl_pct: null,
      entry_context: {},
      gate_calibration_json: {},
      feature_vector: { evidence_score: 80 },
      plan_json: null,
      scale_out_grade: null,
      grade_json: null,
      grade_methodology: null,
      legacy_grade: null,
      status: "OPEN",
      first_seen_at: "2026-07-24T14:00:00.000Z",
      committed_at: "2026-07-24T14:00:00.000Z",
      closed_at: null,
      graded_at: null,
      updated_at: "2026-07-24T14:00:00.000Z",
    },
    {
      id: 2,
      commit_key: "k2",
      root_position_id: null,
      parent_position_id: null,
      roll_seq: 0,
      session_date: "2026-07-24",
      ticker: "TRIM",
      direction: "long" as const,
      sub_lane: "STANDARD",
      archetype: "BREAKOUT",
      top_flow_strike: null,
      contract_strike: 100,
      contract_expiry: "2026-08-14",
      contract_type: "call",
      contract_occ: null,
      contract_delta: 0.6,
      entry_underlying_px: 100,
      thesis_invalidation_px: 90,
      target_underlying_px: 120,
      entry_premium: 5,
      last_mark: 10,
      peak_premium: 10,
      trough_premium: 5,
      underlying_mfe: 110,
      underlying_mae: 100,
      realized_pnl_pct: null,
      entry_context: {},
      gate_calibration_json: {},
      feature_vector: { evidence_score: 80 },
      plan_json: null,
      scale_out_grade: null,
      grade_json: null,
      grade_methodology: null,
      legacy_grade: null,
      status: "TRIM",
      first_seen_at: "2026-07-24T14:00:00.000Z",
      committed_at: "2026-07-24T14:00:00.000Z",
      closed_at: null,
      graded_at: null,
      updated_at: "2026-07-24T14:00:00.000Z",
    },
  ];
  const lane = await getSwingServingLane({
    discover: async () => ({ dossiers: [], plays: [] }),
    fetchOpenPositions: async () => openRows,
    spotsByTicker: { LIVE: 105, TRIM: 110 },
  });
  assert.deepEqual(lane.sections.MANAGING.map((p) => p.ticker), ["LIVE"]);
  assert.deepEqual(lane.sections.SCALING_OUT.map((p) => p.ticker), ["TRIM"]);
  assert.equal(lane.sections.EXITING.length, 0);
});

test("planLevels + spots drive setup maturity beyond RESEARCH on the serve path", async () => {
  const d = buildSwingDossier({
    ...dossier("NVDA"),
    planLevels: {
      entryUnderlyingPx: 100,
      thesisInvalidationPx: 90,
      targetUnderlyingPx: 110,
      atr: 3,
    },
  });
  const lane = await getSwingServingLane({
    discover: async () => ({
      dossiers: [d],
      plays: [play({ ticker: "NVDA", status: "COMMIT", bucketGraduated: true })],
      readsByTicker: new Map([
        [
          "NVDA",
          {
            setup: { price: 100.5, triggerPx: 100, invalidationPx: 90, atr: 3 },
            entry: { price: 100.5, triggerPx: 100, atr: 3 },
            contract,
          },
        ],
      ]),
    }),
  });
  assert.equal(lane.sections.COMMIT_NOW[0]?.setupState, "TRIGGERED");
  assert.equal(lane.sections.RESEARCH.length, 0);
});

// ── FIX 1: the cron→route persistence seam (persist scored output; member route reads it, gated) ──────────

function watchCand(over: Partial<SwingWatchCandidate>): SwingWatchCandidate {
  return {
    ticker: "NVDA", direction: "LONG", archetype: "BREAKOUT", observationCount: 3, distinctSessionDays: 2,
    phasesSeen: ["POST_CLOSE"], signalKinds: ["STRUCTURE"], lastSessionDay: "2026-07-24",
    firstSeenAt: "2026-07-22T20:00:00.000Z", lastSeenAt: "2026-07-24T20:00:00.000Z", ...over,
  };
}

test("persist → discoverSwingFromPersisted round-trips and GATES to persistence-cleared names", async () => {
  const d = buildSwingDossier(dossier("NVDA"));
  const arch = d.archetype.archetype; // thesis key must match watch + play (+ dossier fallback)
  await persistSwingServingSnapshot({
    asOf: "2026-07-24T20:00:00.000Z",
    sessionDay: "2026-07-24",
    dossiers: [d],
    plays: [
      play({ ticker: "NVDA", direction: "LONG", status: "WATCH", archetype: arch }),
      play({ ticker: "FRSH", direction: "LONG", status: "WATCH", archetype: "BREAKOUT" }),
    ],
    watch: [watchCand({ ticker: "NVDA", direction: "LONG", archetype: arch })],
  });

  const result = await discoverSwingFromPersisted();
  assert.ok(result, "the persisted scan is read back");
  assert.deepEqual(result!.plays.map((p) => p.ticker), ["NVDA"], "only the persistence-cleared name surfaces");

  // End-to-end: the exact horizons-route wiring returns the real candidate on the board (not the empty lane).
  const lane = await getSwingServingLane({ discover: discoverSwingFromPersisted });
  const rendered = Object.values(lane.sections).flat().map((p) => p.ticker);
  assert.ok(rendered.includes("NVDA"), "the persisted WATCH candidate renders on the member board");
  assert.ok(!rendered.includes("FRSH"), "a single-sighting name never reaches the member board (persistence gate)");
});

test("persisted flag anchors stamp first-flag underlying — enrichPlay does not overwrite with scan spot", async () => {
  const d = buildSwingDossier(dossier("NVDA"));
  const arch = d.archetype.archetype;
  await persistSwingServingSnapshot({
    asOf: "2026-07-24T20:00:00.000Z",
    sessionDay: "2026-07-24",
    dossiers: [d],
    plays: [play({ ticker: "NVDA", direction: "LONG", status: "WATCH", archetype: arch })],
    watch: [watchCand({ ticker: "NVDA", direction: "LONG", archetype: arch })],
    flagAnchorsByThesisKey: { [swingThesisKey("NVDA", "LONG", arch)]: 180 },
    spotsByTicker: { NVDA: 200 },
  });

  const lane = await getSwingServingLane({
    discover: discoverSwingFromPersisted,
    readsByTicker: new Map([
      ["NVDA", { setup: { price: 200, triggerPx: 195, invalidationPx: 170, atr: 3 } }],
    ]),
  });
  const nvda = Object.values(lane.sections).flat().find((p) => p.ticker === "NVDA");
  assert.equal(nvda?.flagUnderlyingPx, 180, "anchor wins over live scan spot");
});

test("persisted scan with no cleared names → member-safe empty lane (empty is fine when there's no data)", async () => {
  await persistSwingServingSnapshot({
    asOf: "2026-07-24T20:00:00.000Z", sessionDay: "2026-07-24",
    dossiers: [], plays: [play({ ticker: "AAA", status: "WATCH" })], watch: [], // play present but nothing cleared
  });
  const lane = await getSwingServingLane({ discover: discoverSwingFromPersisted });
  assert.equal(lane.committedCount + lane.watchCount, 0);
  for (const s of Object.values(lane.sections)) assert.equal(s.length, 0);
});
