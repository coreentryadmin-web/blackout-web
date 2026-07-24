import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTierZeroScreens,
  rankTierZeroSeeds,
  deriveSwingCandidates,
  runSwingDiscoveryScan,
  type SwingCandidateSeed,
  type SwingDiscoveryDeps,
  type TierZeroSeed,
} from "./discovery.ts";
import { assembleSwingDossierInput } from "./swing-ingest.ts";
import type { SwingAccumAccessors } from "./accumulation-store.ts";
import type { SwingAccumRow } from "../db.ts";
import type { FlowAccumulationSignal } from "../../features/nighthawk/lib/flow-accumulation.ts";
import type { BreakoutMover } from "../../features/nighthawk/lib/candidates.ts";
import type { MinimalFlowRow } from "../zerodte/flow-accumulation-context.ts";

const ASC = Array.from({ length: 60 }, (_, i) => 100 + i);
const FLAT_SPY = Array.from({ length: 60 }, () => 400);

function bullSignal(ticker: string): FlowAccumulationSignal {
  return {
    ticker,
    direction: "bull",
    strength: 82,
    netSignedPremium: 6_000_000,
    magnet: { ticker, strike: 150, expiry: "2026-08-21", side: "call", days: 4, hits: 12, weightedPremium: 5e6, signedPremium: 5e6, sweepRatio: 0.6, openingRatio: 0.8, score: 90 },
    top: [],
  };
}

// ── PURE layer ──────────────────────────────────────────────────────────────────

test("mergeTierZeroScreens: unions paths, dedups, drops excluded, stable order", () => {
  const merged = mergeTierZeroScreens(["NVDA", "AMD", "SPY" /* excluded */], ["NVDA", "ASTS"]);
  const byT = new Map(merged.map((m) => [m.ticker, m.paths]));
  assert.deepEqual(byT.get("NVDA"), ["FLOW", "STRUCTURE"], "a name on both screens is corroborated");
  assert.deepEqual(byT.get("AMD"), ["FLOW"]);
  assert.deepEqual(byT.get("ASTS"), ["STRUCTURE"]);
  assert.equal(byT.has("SPY"), false, "excluded instruments are dropped");
  assert.deepEqual(merged.map((m) => m.ticker), ["AMD", "ASTS", "NVDA"], "sorted by ticker (deterministic)");
});

test("rankTierZeroSeeds: corroborated first, then flow strength, then $-volume", () => {
  const seeds: TierZeroSeed[] = [
    { ticker: "AMD", paths: ["FLOW"] },
    { ticker: "NVDA", paths: ["FLOW", "STRUCTURE"] },
    { ticker: "TSLA", paths: ["FLOW"] },
  ];
  const acc = new Map<string, FlowAccumulationSignal>([
    ["AMD", { ...bullSignal("AMD"), strength: 40 }],
    ["TSLA", { ...bullSignal("TSLA"), strength: 70 }],
    ["NVDA", bullSignal("NVDA")],
  ]);
  const ranked = rankTierZeroSeeds(seeds, acc, new Map());
  assert.deepEqual(ranked.map((s) => s.ticker), ["NVDA", "TSLA", "AMD"]);
});

test("deriveSwingCandidates is deterministic on fixed inputs and sorts by score desc", () => {
  const mk = (ticker: string, accumulation: FlowAccumulationSignal | null, mover: BreakoutMover | null): SwingCandidateSeed => ({
    ticker,
    paths: accumulation ? ["FLOW"] : ["STRUCTURE"],
    input: assembleSwingDossierInput({
      ticker,
      asOf: "2026-07-24T21:00:00.000Z",
      intendedDte: 14,
      accumulation,
      flowWindowDays: 5,
      nameCloses: ASC,
      spyCloses: FLAT_SPY,
      mover,
    }),
  });
  const seeds = [
    mk("NVDA", bullSignal("NVDA"), null),
    mk("ASTS", null, { ticker: "ASTS", gain: 0.12, volume: 8e6, close_strength: 0.9, dollar: 8e8 }),
  ];
  const a = deriveSwingCandidates(seeds);
  const b = deriveSwingCandidates(seeds);
  assert.deepEqual(a, b, "deterministic on fixed inputs");
  // sorted by score desc
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].score.score >= a[i].score.score);
});

test("FM#1: a flow-less structure-only candidate STILL produces a dossier", () => {
  const seed: SwingCandidateSeed = {
    ticker: "ASTS",
    paths: ["STRUCTURE"],
    input: assembleSwingDossierInput({
      ticker: "ASTS",
      asOf: "2026-07-24T21:00:00.000Z",
      intendedDte: 14,
      accumulation: null, // NO flow
      flowWindowDays: 5,
      nameCloses: ASC,
      spyCloses: FLAT_SPY,
      mover: { ticker: "ASTS", gain: 0.12, volume: 8e6, close_strength: 0.9, dollar: 8e8 },
    }),
  };
  const dossiers = deriveSwingCandidates([seed]);
  assert.equal(dossiers.length, 1, "structure-only name is not dropped");
  assert.equal(dossiers[0].ticker, "ASTS");
  assert.equal(dossiers[0].direction, null, "no flow → no signed direction");
  assert.ok(dossiers[0].score.presentCount > 0, "still scores on the pillars it CAN ground (structure/rel-strength)");
});

// ── IO shell (fully injected deps) ────────────────────────────────────────────────

function makeFakeAccum() {
  const rows = new Map<string, SwingAccumRow>();
  const now = () => new Date("2026-07-24T21:00:00Z").toISOString();
  const accessors: SwingAccumAccessors = {
    async upsertSwingAccum(a) {
      const key = `${a.ticker.toUpperCase()}|${a.direction}`;
      const cur = rows.get(key);
      if (!cur) rows.set(key, { ticker: a.ticker.toUpperCase(), direction: a.direction, observation_count: 1, distinct_session_days: 1, last_session_day: a.session_day, phases_seen: [a.phase], promoted_position_id: null, first_seen_at: now(), last_seen_at: now() });
      else {
        cur.observation_count += 1;
        if (cur.last_session_day !== a.session_day) cur.distinct_session_days += 1;
        cur.last_session_day = a.session_day;
        cur.last_seen_at = now();
      }
    },
    async fetchAccumulating(minSessionDays = 1, limit = 500) {
      return [...rows.values()].filter((r) => r.promoted_position_id == null && r.distinct_session_days >= minSessionDays).slice(0, limit);
    },
    async markAccumPromoted() {},
    async fadeStaleAccum() { return 0; },
  };
  return { accessors, rows };
}

// A bull NVDA flow tape (ask-side call premium across the window → bull accumulation).
function nvdaFlowRows(): MinimalFlowRow[] {
  const day = (d: string) => new Date(`${d}T15:00:00Z`).toISOString();
  return [
    { ticker: "NVDA", premium: 2_000_000, option_type: "call", strike: 150, expiry: "2026-08-21", ask_pct: 90, alerted_at: day("2026-07-22") },
    { ticker: "NVDA", premium: 2_000_000, option_type: "call", strike: 150, expiry: "2026-08-21", ask_pct: 90, alerted_at: day("2026-07-23") },
  ];
}

const groupedBars = [
  { T: "ASTS", o: 10, h: 12, l: 9.8, c: 11.9, v: 5_000_000 }, // breakout mover (structure-only)
  { T: "SPXL", o: 10, h: 12, l: 9.8, c: 11.9, v: 5_000_000 }, // leveraged ETP → excluded
  { T: "MSFT", o: 400, h: 402, l: 399, c: 400.5, v: 500_000 }, // no breakout (fails gain/vol)
];

function makeDeps(sessionDay: string, accessors: SwingAccumAccessors): SwingDiscoveryDeps {
  return {
    fetchFlowWindow: async () => nvdaFlowRows(),
    fetchGroupedDaily: async () => groupedBars,
    fetchSpyCloses: async () => FLAT_SPY,
    enrichCandidate: async (seed, ctx) =>
      assembleSwingDossierInput({
        ticker: seed.ticker,
        asOf: ctx.asOf,
        intendedDte: ctx.intendedDte,
        accumulation: ctx.accumulation,
        flowWindowDays: 5,
        nameCloses: ASC,
        spyCloses: ctx.spyCloses,
        mover: ctx.mover,
      }),
    accum: accessors,
    nowMs: Date.parse(`${sessionDay}T21:00:00Z`),
    sessionDay,
    phase: "POST_CLOSE",
  };
}

test("runSwingDiscoveryScan: two-tier, both paths surface dossiers, commitEligibleCount is 0", async () => {
  const { accessors } = makeFakeAccum();
  const res = await runSwingDiscoveryScan(makeDeps("2026-07-23", accessors));

  assert.equal(res.tier0FlowCount, 1, "NVDA directional flow");
  assert.equal(res.tier0StructureCount, 1, "ASTS breakout (SPXL excluded, MSFT filtered)");
  assert.equal(res.mergedCount, 2);
  const tickers = res.dossiers.map((d) => d.ticker).sort();
  assert.deepEqual(tickers, ["ASTS", "NVDA"], "both the flow name AND the flow-less structure name yield dossiers (FM#1)");
  assert.equal(res.commitEligibleCount, 0, "WATCH-only rail: nothing commits in PR-11");
  assert.deepEqual(res.playSet, { ZERO_DTE: [], SWING: [], LEAPS: [] }, "no chains injected → empty play set");

  // First scan (1 distinct session day) → nothing has persisted yet.
  assert.equal(res.watchCount, 0, "a first-sighting candidate is below the persistence bar");
});

test("runSwingDiscoveryScan: WATCH rail clears only after cross-session persistence", async () => {
  const { accessors } = makeFakeAccum();
  await runSwingDiscoveryScan(makeDeps("2026-07-23", accessors)); // session 1
  const res2 = await runSwingDiscoveryScan(makeDeps("2026-07-24", accessors)); // session 2 (new distinct day)

  const watchTickers = res2.watchCandidates.map((c) => c.ticker);
  assert.deepEqual(watchTickers, ["NVDA"], "NVDA persisted across 2 sessions → WATCH; structure-only ASTS has no direction to persist");
  assert.equal(res2.watchCandidates[0].direction, "LONG");
  assert.equal(res2.watchCandidates[0].distinctSessionDays, 2);
  assert.equal(res2.commitEligibleCount, 0);
});
