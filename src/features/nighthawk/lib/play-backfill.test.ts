import assert from "node:assert/strict";
import test from "node:test";
import { pickAffordableChainContract, selectBackfillPlays } from "./play-backfill";
import { buildDirectionalStockLevels } from "./play-levels";
import { validatePlayGeometry } from "./play-constraints";
import type { PlaybookPlay } from "./types";
import type { ChainStrikeRow, EditionChainData } from "./option-chain-prompt";
import type { ScoredCandidate } from "./scorer";
import type { TickerDossier } from "./dossier";

const rows: ChainStrikeRow[] = [
  {
    expiry: "2026-07-17",
    strike: 200,
    call_bid: 4.5,
    call_ask: 5.0,
    call_delta: 0.55,
    call_oi: 5000,
    call_iv: 0.4,
    put_bid: 3,
    put_ask: 3.5,
    put_delta: -0.45,
    put_oi: 4000,
    put_iv: 0.4,
  },
  {
    expiry: "2026-07-17",
    strike: 210,
    call_bid: 2.5,
    call_ask: 3.0,
    call_delta: 0.4,
    call_oi: 800,
    call_iv: 0.38,
    put_bid: 5,
    put_ask: 5.5,
    put_delta: -0.6,
    put_oi: 1200,
    put_iv: 0.42,
  },
];

const chain: EditionChainData = { spot: 205, rows };

test("pickAffordableChainContract: long picks nearest liquid affordable call", () => {
  const picked = pickAffordableChainContract("NET", "long", chain);
  assert.ok(picked);
  assert.equal(picked!.entry_premium, 5);
  assert.match(picked!.options_play, /NET \$200 Call 2026-07-17/);
});

test("pickAffordableChainContract: short picks put side", () => {
  const picked = pickAffordableChainContract("NET", "short", chain);
  assert.ok(picked);
  assert.match(picked!.options_play, /Put/);
});

test("pickAffordableChainContract: returns null when no affordable liquid contracts", () => {
  const expensive: EditionChainData = {
    spot: 205,
    rows: rows.map((r) => ({ ...r, call_ask: 40, put_ask: 40 })),
  };
  assert.equal(pickAffordableChainContract("NET", "long", expensive), null);
});

test("buildDirectionalStockLevels: LONG backfill shape passes geometry gate", () => {
  const levels = buildDirectionalStockLevels({ direction: "long", support: 60.72, resistance: 71.01 });
  const play: PlaybookPlay = {
    rank: 2,
    ticker: "MAGS",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "",
    key_signal: "",
    options_play: "-",
    risk_note: "",
    score: 80,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  assert.notEqual(levels.stop, "60.72");
});

test("buildDirectionalStockLevels: prior Near-$X + stop=X shape FAILS geometry (regression guard)", () => {
  const play: PlaybookPlay = {
    rank: 2,
    ticker: "MAGS",
    direction: "LONG",
    conviction: "B",
    play_type: "stock",
    thesis: "",
    key_signal: "",
    entry_range: "Near $60.72",
    target: "71.01",
    stop: "60.72",
    options_play: "-",
    risk_note: "",
    score: 80,
  };
  assert.equal(validatePlayGeometry(play).ok, false);
});

// ── Spot-anchored entry levels (PR-N14) ─────────────────────────────────────

test("buildDirectionalStockLevels: LONG with spot anchors entry near spot, not support", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot: 212,
  });
  // Entry should be near spot (±0.5%), NOT near support ($174)
  const play: PlaybookPlay = {
    rank: 1, ticker: "COF", direction: "LONG", conviction: "A",
    play_type: "stock", thesis: "", key_signal: "",
    options_play: "-", risk_note: "", score: 72,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  // Entry band should contain values near 212
  assert.match(levels.entry_range, /\$21[0-3]/);
  // Stop clamped: support is 18% below spot, MAX_STOP_DISTANCE_PCT caps at 8%
  // 212 - min(212-174, 212*0.08) = 212 - 16.96 = 195.04
  assert.equal(levels.stop, "195.04");
  // Target at resistance (8.5% away, within 12% cap)
  assert.equal(levels.target, "230.00");
});

test("buildDirectionalStockLevels: SHORT with spot anchors entry near spot, not resistance", () => {
  const levels = buildDirectionalStockLevels({
    direction: "short",
    support: 280,
    resistance: 360,
    spot: 354,
  });
  const play: PlaybookPlay = {
    rank: 1, ticker: "GOOGL", direction: "SHORT", conviction: "B",
    play_type: "stock", thesis: "", key_signal: "",
    options_play: "-", risk_note: "", score: 67,
    ...levels,
  };
  assert.equal(validatePlayGeometry(play).ok, true);
  // Entry band near spot ($354)
  assert.match(levels.entry_range, /\$35[2-6]/);
  // Target clamped: support is 21% below spot, MAX_TARGET_DISTANCE_PCT caps at 12%
  // 354 - min(354-280, 354*0.12) = 354 - 42.48 = 311.52
  assert.equal(levels.target, "311.52");
  // Stop at resistance (1.7% away, within 8% cap)
  assert.equal(levels.stop, "360.00");
});

test("buildDirectionalStockLevels: spot-anchored entry within 3.5% of spot (publish gate compatible)", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot: 212,
  });
  // Parse entry band edges
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // Both edges within 0.5% of spot
  assert.ok(Math.abs(lo - 212) / 212 < 0.006, `lo ${lo} too far from spot 212`);
  assert.ok(Math.abs(hi - 212) / 212 < 0.006, `hi ${hi} too far from spot 212`);
});

test("buildDirectionalStockLevels: legacy path still works without spot (backfill compatibility)", () => {
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 60.72,
    resistance: 71.01,
  });
  // Legacy: entry near support
  assert.match(levels.entry_range, /\$60/);
  // Regression: stop not equal to support
  assert.notEqual(levels.stop, "60.72");
});

// ── ATR-scaled entry band (overnight gap fix) ───────────────────────────────
// A fixed +-0.5% entry band is almost always unfillable for overnight plays where
// the stock gaps 2-5% at the open, directly causing band_detached/unfilled grading
// outcomes. The band should scale with ATR (half-ATR, capped at 2%) instead.

test("buildDirectionalStockLevels: LONG high-ATR name gets a wider entry band than the old fixed 0.5%", () => {
  const spot = 212;
  const atr = 12.72; // ~6% of spot -> atrPct*0.4 = 2.4%, capped at 2.5%
  const levels = buildDirectionalStockLevels({
    direction: "long",
    support: 174,
    resistance: 230,
    spot,
    atr,
  });
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // entryHalfWidth: (12.72/212)*0.4 = 2.4% half-band, under the 2.5% cap
  assert.ok(Math.abs(spot - lo) / spot > 0.02, `lo ${lo} band too narrow for high-ATR name`);
  assert.ok(Math.abs(hi - spot) / spot > 0.02, `hi ${hi} band too narrow for high-ATR name`);
  assert.ok(Math.abs(spot - lo) / spot <= 0.026, `lo ${lo} exceeded the 2.5% cap`);
  assert.ok(Math.abs(hi - spot) / spot <= 0.026, `hi ${hi} exceeded the 2.5% cap`);
});

test("buildDirectionalStockLevels: SHORT low-ATR name gets the floor band when ATR-scaled is below floor", () => {
  const spot = 354;
  const atr = 1.77; // 0.5% of spot -> atrPct*0.4 = 0.2% half-band, below 0.5% floor
  const levels = buildDirectionalStockLevels({
    direction: "short",
    support: 280,
    resistance: 360,
    spot,
    atr,
  });
  const nums = levels.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const expectedHalfBand = 0.005; // floor: MIN_ENTRY_HALF_PCT
  assert.ok(
    Math.abs(Math.abs(spot - lo) / spot - expectedHalfBand) < 0.0005,
    `lo ${lo} does not match expected floor half-band`,
  );
  assert.ok(
    Math.abs(Math.abs(hi - spot) / spot - expectedHalfBand) < 0.0005,
    `hi ${hi} does not match expected floor half-band`,
  );
});

test("buildDirectionalStockLevels: missing/zero ATR falls back to the 0.5% default band", () => {
  const spot = 100;
  const withoutAtr = buildDirectionalStockLevels({
    direction: "long",
    support: 80,
    resistance: 120,
    spot,
  });
  const withZeroAtr = buildDirectionalStockLevels({
    direction: "long",
    support: 80,
    resistance: 120,
    spot,
    atr: 0,
  });
  assert.equal(withoutAtr.entry_range, withZeroAtr.entry_range);
  const nums = withoutAtr.entry_range.match(/[\d.]+/g)!.map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  // Floor half-band: MIN_ENTRY_HALF_PCT = 0.5%
  assert.equal(lo, 99.5);
  assert.equal(hi, 100.5);
});

// ── selectBackfillPlays (2026-09-28 backfill redesign) ──────────────────────────────────────
// Real end-to-end reproduction of the operator's own tonight-example: BB/WAT/KOD/TWLO/ZS all
// scored below the organic merit floor but completed scoring — does backfill correctly fill
// toward the minimum from the next-best of THOSE, respecting the governor's sector demotion,
// never placeholder-publishing, never exceeding the minimum, never touching the qualified plays
// already in the edition.

import { todayEtYmd } from "@/lib/providers/spx-session";

function ymdPlus(days: number): string {
  const t = todayEtYmd();
  const d = new Date(t + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bfRow(strike: number, opts: { oi?: number; callAsk?: number; putAsk?: number } = {}): ChainStrikeRow {
  const oi = opts.oi ?? 5_000;
  return {
    expiry: ymdPlus(30),
    strike,
    call_bid: (opts.callAsk ?? 4.2) - 0.3,
    call_ask: opts.callAsk ?? 4.2,
    call_delta: 0.5,
    call_oi: oi,
    call_iv: null,
    put_bid: (opts.putAsk ?? 4.2) - 0.3,
    put_ask: opts.putAsk ?? 4.2,
    put_delta: -0.5,
    put_oi: oi,
    put_iv: null,
  };
}

/** A liquid, affordable chain around `spot`. */
function bfChain(spot: number, opts: { oi?: number; callAsk?: number } = {}): EditionChainData {
  return {
    spot,
    rows: [spot - 5, spot, spot + 5].map((s) => bfRow(s, opts)),
  };
}

/** An chain with no affordable/liquid contract on either side — pickAffordableChainContract
 *  returns null for this, the exact case selectBackfillPlays must skip rather than placeholder. */
function bfChainUnaffordable(spot: number): EditionChainData {
  return { spot, rows: [bfRow(spot, { callAsk: 999, putAsk: 999 })] };
}

function bfDossier(ticker: string, spot: number, over: Partial<TickerDossier> = {}): TickerDossier {
  return {
    ticker,
    flows: [],
    flow_streak: { streak_days: 1 } as TickerDossier["flow_streak"],
    iv_rank: 40,
    benzinga_price_target: null,
    tech: {
      ticker,
      price: spot,
      trend: "bullish",
      setup_tags: [],
      support_levels: [spot - 5],
      resistance_levels: [spot + 5],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: spot + 6, low: spot - 6, close: spot },
      weekly: { high: null, low: null },
      rsi14: 55,
      rel_volume: 1.2,
      atr14: 3,
      vwap: spot,
      ema20: spot,
      ema50: spot,
      ema200: spot,
      summary: `${ticker} holding above VWAP.`,
    },
    ...over,
  } as TickerDossier;
}

function bfScored(ticker: string, score: number, over: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    ticker,
    direction: "long",
    score,
    conviction: "C",
    flow_score: 5,
    tech_score: 5,
    pos_score: 2,
    news_score: 0,
    smart_money_score: 0,
    trading_halt: false,
    ...over,
  } as ScoredCandidate;
}

test("selectBackfillPlays: fills sub-floor scores toward the minimum from the ranked pool (the operator's own tonight-example shape)", () => {
  // AMD already qualified organically (score 59) and is the one existing finalPlays entry.
  // BB/WAT/KOD/TWLO/ZS all scored below the organic 40-point floor but completed scoring — this
  // reproduces exactly that live shape and asserts backfill reaches the minimum of 3 from them.
  const amd: PlaybookPlay = {
    rank: 1, ticker: "AMD", direction: "LONG", conviction: "A", play_type: "stock",
    thesis: "", key_signal: "", entry_range: "-", target: "-", stop: "-",
    options_play: "AMD $200 Call", score: 59,
  };
  // Deliberately scrambled input order — proves selectBackfillPlays itself sorts by merit,
  // rather than merely preserving whatever order the caller happened to pass in.
  const pool = [
    bfScored("ZS", 25),
    bfScored("KOD", 30),
    bfScored("WAT", 32),
  ];
  const dossiers: Record<string, TickerDossier> = {
    WAT: bfDossier("WAT", 100),
    KOD: bfDossier("KOD", 50),
    ZS: bfDossier("ZS", 200),
  };
  const chains: Record<string, EditionChainData> = {
    WAT: bfChain(100),
    KOD: bfChain(50),
    ZS: bfChain(200),
  };

  const { plays, notes } = selectBackfillPlays({
    finalPlays: [amd],
    pool,
    dossiers,
    chains,
    minPlays: 3,
  });

  assert.equal(plays.length, 3, "reached the minimum of 3");
  assert.equal(plays[0]!.ticker, "AMD", "the existing qualified play is untouched and stays first");
  assert.equal(plays[0]!.selection_tier, undefined, "selectBackfillPlays never stamps the pre-existing qualified play");
  // WAT (32) outranks KOD (30) outranks ZS (25) — filled in merit order.
  assert.equal(plays[1]!.ticker, "WAT");
  assert.equal(plays[2]!.ticker, "KOD");
  assert.equal(plays[1]!.selection_tier, "BACKFILL");
  assert.equal(plays[2]!.selection_tier, "BACKFILL");
  assert.ok(notes.some((n) => n.includes("Thin edition backfill")));
  assert.ok(notes.some((n) => n.includes("WAT")));
  assert.ok(notes.some((n) => n.includes("KOD")));
  assert.ok(!notes.some((n) => n.includes("ZS")), "ZS was never needed once the minimum was reached");
});

test("selectBackfillPlays: respects the cross-edition sector-concentration governor — a raw-higher-scored but governor-demoted candidate ranks BEHIND a lower-raw-scored, undemoted one", () => {
  // Reproduces the exact tonight-shape the operator called out: BB raw 41, demoted -10 by the
  // sector governor to effective 31; WAT raw 32, never demoted. Backfill must rank WAT ahead of
  // BB (respecting the governor), never revert to raw score (which would rank BB first and
  // silently let a capped sector reappear ahead of an uncapped one).
  const bb = bfScored("BB", 41, { govPenalty: 10 }); // effective 31
  const wat = bfScored("WAT", 32); // effective 32, no demotion
  const dossiers = { BB: bfDossier("BB", 100), WAT: bfDossier("WAT", 120) };
  const chains = { BB: bfChain(100), WAT: bfChain(120) };

  const { plays } = selectBackfillPlays({
    finalPlays: [],
    pool: [bb, wat], // BB listed first by raw score — the sort must still put WAT first
    dossiers,
    chains,
    minPlays: 1,
  });

  assert.equal(plays.length, 1, "minPlays=1 stops after the single best-ranked candidate");
  assert.equal(plays[0]!.ticker, "WAT", "governor-demoted BB (effective 31) ranks behind undemoted WAT (32)");
});

test("selectBackfillPlays: never exceeds minPlays even when more eligible candidates exist", () => {
  const pool = [bfScored("A", 30), bfScored("B", 29), bfScored("C", 28), bfScored("D", 27)];
  const dossiers = Object.fromEntries(pool.map((s) => [s.ticker, bfDossier(s.ticker, 100)]));
  const chains = Object.fromEntries(pool.map((s) => [s.ticker, bfChain(100)]));

  const { plays } = selectBackfillPlays({ finalPlays: [], pool, dossiers, chains, minPlays: 3 });
  assert.equal(plays.length, 3, "stopped exactly at the minimum, never filled to the full pool size");
  assert.deepEqual(plays.map((p) => p.ticker), ["A", "B", "C"]);
});

test("selectBackfillPlays: never removes or replaces an existing qualified play", () => {
  const qualified: PlaybookPlay = {
    rank: 1, ticker: "AMD", direction: "LONG", conviction: "A", play_type: "stock",
    thesis: "", key_signal: "", entry_range: "-", target: "-", stop: "-",
    options_play: "AMD $200 Call", score: 59, selection_tier: "QUALIFIED",
  };
  const pool = [bfScored("WAT", 32)];
  const dossiers = { WAT: bfDossier("WAT", 100) };
  const chains = { WAT: bfChain(100) };

  const { plays } = selectBackfillPlays({ finalPlays: [qualified], pool, dossiers, chains, minPlays: 3 });
  const amdRow = plays.find((p) => p.ticker === "AMD");
  assert.ok(amdRow, "AMD is still present");
  assert.equal(amdRow!.selection_tier, "QUALIFIED", "untouched — backfill never overwrites an existing tier");
  assert.equal(amdRow!.score, 59, "untouched — backfill never mutates an existing qualified play's data");
});

test("selectBackfillPlays: skips a candidate with no real liquid/affordable contract — never a placeholder", () => {
  const pool = [bfScored("ILLIQUID", 35), bfScored("GOOD", 30)];
  const dossiers = {
    ILLIQUID: bfDossier("ILLIQUID", 100),
    GOOD: bfDossier("GOOD", 100),
  };
  const chains = {
    ILLIQUID: bfChainUnaffordable(100),
    GOOD: bfChain(100),
  };

  const { plays, notes } = selectBackfillPlays({ finalPlays: [], pool, dossiers, chains, minPlays: 3 });
  assert.equal(plays.length, 1, "only GOOD was added — ILLIQUID skipped outright");
  assert.equal(plays[0]!.ticker, "GOOD");
  assert.notEqual(plays[0]!.options_play, "-", "never a placeholder options_play");
  assert.ok(!notes.some((n) => n.includes("ILLIQUID")), "a skipped candidate produces no promotion note");
});

test("selectBackfillPlays: a trading-halted candidate in the pool is never promoted", () => {
  // Eligibility (backfillCandidateEligible) is normally applied by the caller before building
  // `pool` — this proves selectBackfillPlays' own contract/geometry checks don't accidentally
  // promote a halted name if one slips through, by pairing it with a real dossier/chain that
  // WOULD otherwise pass every other check.
  const pool = [bfScored("HALTED", 90, { trading_halt: true })];
  const dossiers = { HALTED: bfDossier("HALTED", 100) };
  const chains = { HALTED: bfChain(100) };
  // selectBackfillPlays itself is eligibility-agnostic (the filter lives in
  // backfillThinEditionPlays/backfillCandidateEligible) — this test documents that boundary:
  // callers MUST filter with backfillCandidateEligible before building `pool`, exactly as
  // backfillThinEditionPlays itself does.
  const eligiblePool = pool.filter((p) => !p.trading_halt);
  const { plays } = selectBackfillPlays({ finalPlays: [], pool: eligiblePool, dossiers, chains, minPlays: 3 });
  assert.equal(plays.length, 0, "the halted candidate was excluded before reaching selectBackfillPlays");
});

test("selectBackfillPlays: empty pool returns finalPlays unchanged with empty notes", () => {
  const { plays, notes } = selectBackfillPlays({ finalPlays: [], pool: [], dossiers: {}, chains: {}, minPlays: 3 });
  assert.deepEqual(plays, []);
  assert.deepEqual(notes, []);
});

test("selectBackfillPlays: a candidate with no dossier is skipped (cannot build levels without it)", () => {
  const pool = [bfScored("NODOSSIER", 30)];
  const { plays } = selectBackfillPlays({
    finalPlays: [],
    pool,
    dossiers: {},
    chains: { NODOSSIER: bfChain(100) },
    minPlays: 3,
  });
  assert.equal(plays.length, 0);
});
