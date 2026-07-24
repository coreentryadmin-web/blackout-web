import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleSwingDossierInput,
  ingestSwingReads,
  pctReturnOverSessions,
  emaStackFromCloses,
  accumulationReadFromSignal,
  regimeFromSpyTrend,
  type SwingIngestDeps,
} from "./swing-ingest.ts";
import { buildSwingDossier } from "./dossier.ts";
import type { FlowAccumulationSignal } from "../../features/nighthawk/lib/flow-accumulation.ts";
import type { BreakoutMover } from "../../features/nighthawk/lib/candidates.ts";

const ASC = Array.from({ length: 60 }, (_, i) => 100 + i); // steady uptrend, last close 159
const DESC = Array.from({ length: 60 }, (_, i) => 160 - i); // steady downtrend, last close 101
const FLAT_SPY = Array.from({ length: 60 }, () => 400);

function bullSignal(): FlowAccumulationSignal {
  return {
    ticker: "NVDA",
    direction: "bull",
    strength: 82,
    netSignedPremium: 6_000_000,
    magnet: {
      ticker: "NVDA",
      strike: 150,
      expiry: "2026-08-21",
      side: "call",
      days: 4,
      hits: 12,
      weightedPremium: 5_000_000,
      signedPremium: 5_000_000,
      sweepRatio: 0.6,
      openingRatio: 0.8,
      score: 90,
    },
    top: [],
  };
}

test("pctReturnOverSessions: correct return, null when too short / bad reference", () => {
  assert.equal(pctReturnOverSessions([100, 110], 1), 10);
  assert.equal(pctReturnOverSessions([100], 1), null); // too short
  assert.equal(pctReturnOverSessions([0, 110], 1), null); // non-positive reference
  const r = pctReturnOverSessions(ASC, 10);
  assert.ok(r != null && r > 0, "an uptrend has a positive 10-session return");
});

test("emaStackFromCloses: full stack on enough bars, absent (empty) when too few", () => {
  const up = emaStackFromCloses(ASC);
  assert.equal(up.priceAboveEma20, true);
  assert.equal(up.ema20AboveEma50, true);
  assert.equal(up.ema50Rising, true);

  const down = emaStackFromCloses(DESC);
  assert.equal(down.priceAboveEma20, false);
  assert.equal(down.ema20AboveEma50, false);
  assert.equal(down.ema50Rising, false);

  // Too few bars → every flag ABSENT (undefined), never a fabricated stance.
  const thin = emaStackFromCloses([100, 101, 102]);
  assert.equal(thin.priceAboveEma20, undefined);
  assert.equal(thin.ema20AboveEma50, undefined);
  assert.equal(thin.ema50Rising, undefined);
});

test("accumulationReadFromSignal projects the signal onto the SwingReads accumulation shape", () => {
  const read = accumulationReadFromSignal(bullSignal());
  assert.equal(read.direction, "bull");
  assert.equal(read.days, 4); // from the magnet
  assert.equal(read.magnet_strike, 150);
  assert.equal(read.magnet_side, "call");
  assert.equal(read.aligned, null); // swing direction IS the accumulation direction; aligned is a 0DTE concept
});

test("assembleSwingDossierInput: bull flow + uptrend → directional dossier input with signed pillars", () => {
  const input = assembleSwingDossierInput({
    ticker: "nvda",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: FLAT_SPY,
    mover: null,
  });
  assert.equal(input.ticker, "NVDA");
  assert.equal(input.intendedDte, 14);
  assert.ok(input.reads.accumulation != null);
  assert.equal(input.reads.accumulation!.direction, "bull");
  // Signed rel-strength: name uptrend vs flat SPY → positive name return passed through.
  assert.ok((input.relStrength!.nameReturnPct ?? 0) > 0);
  // Structure stack aligned bullish for a LONG.
  assert.equal(input.structure!.priceAboveEma20, true);
  assert.equal(input.flow!.accumTotalDays, 5);
  assert.ok((input.flow!.aggression01 ?? 0) > 0);
});

test("FM#1: flow-less (structure-only) candidate STILL assembles a dossier input (null accumulation)", () => {
  const mover: BreakoutMover = { ticker: "ASTS", gain: 0.12, volume: 8_000_000, close_strength: 0.9, dollar: 8e8 };
  const input = assembleSwingDossierInput({
    ticker: "ASTS",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: null, // NO flow — pure structure path
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: FLAT_SPY,
    mover,
  });
  assert.equal(input.reads.accumulation, null, "flow-less path carries a null accumulation read, not a fabricated one");
  // Structure evidence from the breakout screen still grounds the archetype extras.
  assert.ok((input.archetypeExtras!.breakoutQuality01 ?? 0) > 0);
  assert.ok((input.archetypeExtras!.volumeExpansion01 ?? 0) > 0);
  // The EMA stack still grounds the STRUCTURE pillar even with no flow.
  assert.equal(input.structure!.priceAboveEma20, true);
});

test("assembleSwingDossierInput is deterministic on fixed inputs", () => {
  const args = {
    ticker: "NVDA",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: FLAT_SPY,
    mover: null,
  } as const;
  assert.deepEqual(assembleSwingDossierInput({ ...args }), assembleSwingDossierInput({ ...args }));
});

test("ingestSwingReads: fetches name closes then assembles; null when no history", async () => {
  const deps: SwingIngestDeps = {
    async fetchDailyCloses(ticker) {
      return ticker.toUpperCase() === "NVDA" ? ASC : [];
    },
  };
  const ok = await ingestSwingReads(deps, {
    ticker: "NVDA",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    spyCloses: FLAT_SPY,
  });
  assert.ok(ok != null);
  assert.equal(ok!.ticker, "NVDA");

  const none = await ingestSwingReads(deps, {
    ticker: "ZZZZ",
    asOf: "2026-07-24T21:00:00.000Z",
    accumulation: null,
    flowWindowDays: 5,
    spyCloses: FLAT_SPY,
  });
  assert.equal(none, null, "a name with no daily history is dropped, not carried as a hollow dossier");
});

// ── Pillar/archetype GROUNDING (the 7-pillar engine, not a 3-pillar screen) ──────────

test("regimeFromSpyTrend: SPY risk-on is a LONG tailwind and a SHORT headwind (direction-aligned)", () => {
  assert.equal(regimeFromSpyTrend(ASC, "LONG"), 1, "SPY uptrend → risk-on → max regime for a LONG");
  assert.equal(regimeFromSpyTrend(ASC, "SHORT"), 0, "the same risk-on tape is a headwind for a SHORT");
  assert.equal(regimeFromSpyTrend(DESC, "SHORT"), 1, "SPY downtrend → risk-off → max regime for a SHORT");
  assert.equal(regimeFromSpyTrend(ASC, null), 1, "no direction → the raw risk-on read");
  // Too little SPY history → honest absence (null), never a fabricated 0/1.
  assert.equal(regimeFromSpyTrend([100, 101, 102], "LONG"), null);
});

test("assembleSwingDossierInput: catalyst + IV-rank ground the CATALYST / VOLATILITY / REGIME pillars + event extras", () => {
  const input = assembleSwingDossierInput({
    ticker: "MRNA",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: ASC, // risk-on tape
    mover: null,
    catalyst: { freshCatalystAgeDays: 0, earnings: { nextEarnings: null, lastEarnings: null } },
    ivRank: 20, // low IV → high contract quality
  });
  assert.ok((input.volatility?.contractQuality01 ?? 0) > 0.7, "low IV rank → high VOLATILITY contract quality");
  assert.ok((input.catalyst?.catalystStrength01 ?? 0) > 0.9, "a same-day catalyst grounds the CATALYST pillar");
  assert.equal(input.regime01, 1, "risk-on SPY → max REGIME for a LONG");
  assert.ok((input.archetypeExtras?.catalystInWindow01 ?? 0) > 0.9, "the EVENT_DRIVEN fit input is grounded");

  // Absent-context path (no catalyst/ivRank args): those pillars stay null (honest), REGIME still grounds.
  const bare = assembleSwingDossierInput({
    ticker: "MRNA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, nameCloses: ASC, spyCloses: FLAT_SPY, mover: null,
  });
  assert.equal(bare.volatility, undefined, "no IV rank → VOLATILITY cluster absent (never faked)");
  assert.equal(bare.catalyst, undefined, "no catalyst context → CATALYST cluster absent");
  assert.equal(bare.archetypeExtras?.catalystInWindow01, null);
});

test("EVENT_DRIVEN is now PRODUCIBLE: a fresh-catalyst name classifies EVENT_DRIVEN on the grounded extra (was dead code)", () => {
  const input = assembleSwingDossierInput({
    ticker: "MRNA",
    asOf: "2026-07-24T21:00:00.000Z",
    intendedDte: 14,
    accumulation: bullSignal(),
    flowWindowDays: 5,
    nameCloses: ASC,
    spyCloses: ASC,
    mover: null,
    catalyst: { freshCatalystAgeDays: 0, earnings: { nextEarnings: null, lastEarnings: null } },
    ivRank: 30,
  });
  const d = buildSwingDossier(input);
  assert.equal(d.archetype.archetype, "EVENT_DRIVEN", "a dominant fresh catalyst wins (priority #1) — the archetype the fast-track was built for");
  assert.ok(d.pillarSignals.CATALYST != null && d.pillarSignals.VOLATILITY != null && d.pillarSignals.REGIME != null);
  assert.ok(d.score.presentCount >= 6, "6+ pillars grounded — no longer the renormalized 3-pillar momentum screen");
});

test("ingestSwingReads: wired catalyst/IV-rank fetchers thread through; fail-soft on a throwing provider", async () => {
  const deps: SwingIngestDeps = {
    async fetchDailyCloses() { return ASC; },
    async fetchCatalystNews() { return [{ channels: ["fda"], publishedAt: "2026-07-24T12:00:00.000Z" }]; },
    async fetchEarningsRows() { return [{ report_date: "2026-07-21", surprise_pct: 12 }]; },
    async fetchIvRank() { return 15; },
  };
  const input = await ingestSwingReads(deps, {
    ticker: "MRNA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, spyCloses: ASC,
  });
  assert.ok(input != null);
  assert.ok((input!.catalyst?.catalystStrength01 ?? 0) > 0, "wired Benzinga news grounds the CATALYST pillar");
  assert.ok((input!.volatility?.contractQuality01 ?? 0) > 0.8, "wired IV rank grounds the VOLATILITY pillar");
  assert.ok((input!.archetypeExtras?.earningsGapRecent01 ?? 0) > 0, "wired earnings feed grounds the post-earnings drift extras");

  // A THROWING provider degrades only that read — the candidate is never dropped and never throws.
  const flaky: SwingIngestDeps = {
    async fetchDailyCloses() { return ASC; },
    async fetchCatalystNews() { throw new Error("benzinga down"); },
    async fetchIvRank() { throw new Error("uw down"); },
  };
  const soft = await ingestSwingReads(flaky, {
    ticker: "MRNA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, spyCloses: ASC,
  });
  assert.ok(soft != null, "a provider outage never drops the candidate (fail-soft)");
  assert.equal(soft!.catalyst?.catalystStrength01 ?? null, null, "the failed catalyst read is just null, not a throw");
});

// ── SECTOR_ROTATION industry-group RS grounding (replaces the coarse SPY RS) ─────────────────────────

test("assembleSwingDossierInput: group closes ground sectorLeadership01 (industry-group RS); absent without them", () => {
  const withGroup = assembleSwingDossierInput({
    ticker: "NVDA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5,
    nameCloses: ASC, spyCloses: FLAT_SPY,
    groupBenchmark: { etf: "SMH", label: "Semiconductors", kind: "industry" },
    groupCloses: FLAT_SPY, // the name (uptrend) leads a flat industry group → positive industry-group RS
    mover: null,
  });
  assert.ok((withGroup.archetypeExtras?.sectorLeadership01 ?? 0) > 0, "name leading its group grounds the sector-rotation signal");

  const withoutGroup = assembleSwingDossierInput({
    ticker: "NVDA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, nameCloses: ASC, spyCloses: FLAT_SPY, mover: null,
  });
  assert.equal(withoutGroup.archetypeExtras?.sectorLeadership01, null, "no group closes ⇒ sector-rotation signal absent (no SPY-RS fallback)");
});

test("ingestSwingReads: classifier resolves the INDUSTRY benchmark (SIC); its closes ground sectorLeadership01", async () => {
  const calls: string[] = [];
  const deps: SwingIngestDeps = {
    async fetchDailyCloses(ticker) {
      calls.push(ticker.toUpperCase());
      if (ticker.toUpperCase() === "NVDA") return ASC; // name uptrend
      if (ticker.toUpperCase() === "SMH") return FLAT_SPY; // flat semiconductors group → name leads
      return [];
    },
    async fetchTickerClassification(ticker) {
      return ticker.toUpperCase() === "NVDA"
        ? { sicCode: "3674", sicDescription: "SEMICONDUCTORS", tickerType: "CS" }
        : null;
    },
  };
  const input = await ingestSwingReads(deps, {
    ticker: "NVDA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, spyCloses: FLAT_SPY,
  });
  assert.ok(input != null);
  assert.ok(calls.includes("SMH"), "the SIC-resolved semiconductors benchmark (SMH) closes were fetched — not SPY");
  assert.ok((input!.archetypeExtras?.sectorLeadership01 ?? 0) > 0, "the industry-group RS grounded the sector-rotation signal");
});

test("ingestSwingReads: classifier failure falls back to the static sector-map benchmark (fail-soft)", async () => {
  const calls: string[] = [];
  const deps: SwingIngestDeps = {
    async fetchDailyCloses(ticker) {
      calls.push(ticker.toUpperCase());
      return ticker.toUpperCase() === "NVDA" ? ASC : FLAT_SPY;
    },
    async fetchTickerClassification() {
      throw new Error("polygon reference down");
    },
  };
  const input = await ingestSwingReads(deps, {
    ticker: "NVDA", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, spyCloses: FLAT_SPY,
  });
  assert.ok(input != null, "a classifier outage never drops the candidate");
  assert.ok(calls.includes("XLK"), "fell back to the static sector-map sector benchmark (Tech → XLK)");
  assert.ok((input!.archetypeExtras?.sectorLeadership01 ?? 0) > 0, "sector-ETF RS still grounds the signal without the classifier");
});

test("ingestSwingReads: an unclassifiable name gets no benchmark → null sector-rotation signal, no extra fetch", async () => {
  const calls: string[] = [];
  const deps: SwingIngestDeps = {
    async fetchDailyCloses(ticker) {
      calls.push(ticker.toUpperCase());
      return ASC;
    },
    async fetchTickerClassification() {
      return null; // no SIC
    },
  };
  // "ZQZQ" is absent from the static sector-map (getSector → "Other") and has no SIC → no benchmark resolves.
  const input = await ingestSwingReads(deps, {
    ticker: "ZQZQ", asOf: "2026-07-24T21:00:00.000Z", intendedDte: 14,
    accumulation: bullSignal(), flowWindowDays: 5, spyCloses: FLAT_SPY,
  });
  assert.ok(input != null);
  assert.equal(input!.archetypeExtras?.sectorLeadership01 ?? null, null, "no benchmark ⇒ null sector-rotation signal");
  assert.deepEqual(calls, ["ZQZQ"], "no benchmark ⇒ no benchmark-closes fetch (only the name was fetched)");
});
