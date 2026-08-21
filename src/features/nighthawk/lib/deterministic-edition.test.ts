import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  buildDeterministicEditionPlays,
  buildRescuePlays,
  pickChainContract,
  buildDeterministicThesis,
  scoreContrarianHedge,
} from "./deterministic-edition";
import { validatePlayGeometry } from "./play-constraints";
import { parsePlayLevels } from "./play-levels";
import { parseOptionsContract } from "./option-chain-prompt";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import type { ChainStrikeRow, EditionChainData } from "./option-chain-prompt";
import type { ScoredCandidate } from "./scorer";
import type { TickerDossier } from "./dossier";

// ── Synthetic fixtures ────────────────────────────────────────────────────────────────────────
function row(
  strike: number,
  opts: { oi?: number; callAsk?: number; callBid?: number; putAsk?: number; putBid?: number; expiry?: string } = {}
): ChainStrikeRow {
  const oi = opts.oi ?? 5_000;
  return {
    // Relative, not a literal. This defaulted to "2026-12-18" — a fixed date that was ~4 months
    // out when written and becomes 0-DTE and then EXPIRED as the calendar advances. Contract
    // selection here filters on DTE computed against the REAL clock, so every test relying on this
    // default silently turns into a countdown: the date-bomb scan (scripts/audit/test-date-bomb-scan.mjs)
    // showed three of them failing at +120d and four more at +400d. `ymdPlus(120)` reproduces the
    // original intent — comfortably far-dated — at any run date.
    expiry: opts.expiry ?? ymdPlus(120),
    strike,
    call_bid: opts.callBid ?? null,
    call_ask: opts.callAsk ?? null,
    call_delta: null,
    call_oi: oi,
    call_iv: null,
    put_bid: opts.putBid ?? null,
    put_ask: opts.putAsk ?? null,
    put_delta: null,
    put_oi: oi,
    put_iv: null,
  };
}

/** A liquid, affordable chain around `spot` with call & put quotes on every strike. */
function chainAround(spot: number, opts: { oi?: number; expiry?: string } = {}): EditionChainData {
  const strikes = [spot - 10, spot - 5, spot, spot + 5, spot + 10];
  return {
    spot,
    rows: strikes.map((s) =>
      row(s, {
        oi: opts.oi,
        expiry: opts.expiry,
        // Cheap, well within the $35/share cap; mid ≈ 4.
        callAsk: 4.2,
        callBid: 3.8,
        putAsk: 4.2,
        putBid: 3.8,
      })
    ),
  };
}

function dossier(ticker: string, spot: number, over: Partial<TickerDossier> = {}): TickerDossier {
  return {
    ticker,
    flows: [],
    flow_streak: { streak_days: 3 } as TickerDossier["flow_streak"],
    iv_rank: 45,
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
      rel_volume: 1.6,
      atr14: 3,
      vwap: spot,
      ema20: spot,
      ema50: spot,
      ema200: spot,
      summary: `${ticker} holding above VWAP; bullish MA stack.`,
    },
    ...over,
  } as TickerDossier;
}

function scored(ticker: string, direction: "long" | "short", score: number): ScoredCandidate {
  return {
    ticker,
    score,
    direction,
    flow_score: 18,
    tech_score: 12,
    pos_score: 6,
    news_score: 2,
    smart_money_score: 3,
    conviction: score >= 55 ? "A" : score >= 40 ? "B" : "C",
    trading_halt: false,
  };
}

// Volume-first defaults for existing unit tests — global-strongest policy is tested explicitly.
beforeEach(() => {
  process.env.NH_LEGACY_GLOBAL_STRONGEST = "0";
  process.env.NH_LEGACY_DIVERSITY_HEDGE = "1";
  process.env.NH_LEGACY_FORCED_HEDGE = "1";
});

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────
test("emits N valid plays with correct geometry and direction from the score sign", () => {
  const ranked = [scored("AAA", "long", 68), scored("BBB", "short", 61), scored("CCC", "long", 44)];
  const chains = { AAA: chainAround(120), BBB: chainAround(80), CCC: chainAround(200) };
  const dossierMap = { AAA: dossier("AAA", 120), BBB: dossier("BBB", 80), CCC: dossier("CCC", 200) };

  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 3);

  for (const p of plays) {
    // Every published play passes the SAME geometry gate the Claude path enforces.
    assert.equal(validatePlayGeometry(p).ok, true, `${p.ticker} geometry`);
    // Premium respected.
    assert.ok(p.entry_premium != null && p.entry_premium <= MAX_OPTION_PREMIUM_PER_SHARE);
    assert.equal(p.premium_cap_ok, true);
    // Score pinned from the scored candidate, not fabricated.
    assert.ok(p.score != null && p.score > 0);
  }

  // Direction from score sign: long ⇒ LONG + CALL, short ⇒ SHORT + PUT.
  const aaa = plays.find((p) => p.ticker === "AAA")!;
  assert.equal(aaa.direction, "LONG");
  assert.equal(parseOptionsContract(aaa.options_play)?.side, "call");
  const bbb = plays.find((p) => p.ticker === "BBB")!;
  assert.equal(bbb.direction, "SHORT");
  assert.equal(parseOptionsContract(bbb.options_play)?.side, "put");
});

test("SHORT play has target below entry and stop above (correct short geometry)", () => {
  const ranked = [scored("SHT", "short", 60)];
  const chains = { SHT: chainAround(100) };
  const dossierMap = { SHT: dossier("SHT", 100) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  const p = plays[0]!;
  const { entry_range_low: lo, entry_range_high: hi, target, stop } = parsePlayLevels(p);
  const mid = ((lo ?? 0) + (hi ?? 0)) / 2;
  assert.ok(target! < mid, "short target below entry");
  assert.ok(stop! > mid, "short stop above entry");
});

test("premium cap: expensive strike still shows a contract with caveat (PR-N23)", () => {
  const expensive: EditionChainData = {
    spot: 500,
    rows: [row(500, { oi: 5_000, callAsk: 60, callBid: 58 })], // mid 59 > $35 cap
  };
  const ranked = [scored("EXP", "long", 65), scored("OK", "long", 60)];
  const chains = { EXP: expensive, OK: chainAround(120) };
  const dossierMap = { EXP: dossier("EXP", 500), OK: dossier("OK", 120) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2);
  const exp = plays.find((p) => p.ticker === "EXP")!;
  assert.ok(exp, "EXP should be included with caveated contract");
  assert.ok(exp.entry_premium != null, "caveated contract still shows premium");
  assert.match(exp.options_play, /premium above/);
  assert.ok(parseOptionsContract(exp.options_play) != null, "caveated contract is parseable");
  const ok = plays.find((p) => p.ticker === "OK")!;
  assert.ok(ok.entry_premium != null && ok.entry_premium <= MAX_OPTION_PREMIUM_PER_SHARE);
});

test("OI floor: illiquid strike still shows a contract with liquidity caveat (PR-N23)", () => {
  const illiquid: EditionChainData = {
    spot: 120,
    rows: [row(120, { oi: 100, callAsk: 4, callBid: 3.6 })], // OI 100 < 500 floor
  };
  const ranked = [scored("ILQ", "long", 66), scored("LIQ", "long", 55)];
  const chains = { ILQ: illiquid, LIQ: chainAround(90) };
  const dossierMap = { ILQ: dossier("ILQ", 120), LIQ: dossier("LIQ", 90) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2);
  const ilq = plays.find((p) => p.ticker === "ILQ")!;
  assert.ok(ilq, "ILQ should be included with caveated contract");
  assert.ok(ilq.entry_premium != null, "caveated contract still shows premium");
  assert.match(ilq.options_play, /thin liquidity/);
  assert.ok(parseOptionsContract(ilq.options_play) != null, "caveated contract is parseable");
});

test("no chain for a candidate builds stock-only play with no-data message (PR-N23)", () => {
  const ranked = [scored("NOCH", "long", 70), scored("HAS", "long", 50)];
  const chains = { HAS: chainAround(150) };
  const dossierMap = { NOCH: dossier("NOCH", 150), HAS: dossier("HAS", 150) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2);
  const noch = plays.find((p) => p.ticker === "NOCH")!;
  assert.ok(noch, "NOCH should be included as stock-only");
  assert.equal(noch.entry_premium, undefined, "stock-only play has no entry_premium");
  assert.match(noch.options_play, /no options data/);
  const has = plays.find((p) => p.ticker === "HAS")!;
  assert.ok(has.entry_premium != null, "HAS should have a contract");
});

test("respects the target count and re-ranks 1..N", () => {
  const ranked = ["A", "B", "C", "D", "E", "F"].map((t, i) => scored(t, "long", 65 - i));
  const chains = Object.fromEntries(ranked.map((s) => [s.ticker, chainAround(100 + Number(s.score))]));
  const dossierMap = Object.fromEntries(ranked.map((s) => [s.ticker, dossier(s.ticker, 100 + Number(s.score))]));
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 4 });
  assert.equal(plays.length, 4);
  assert.deepEqual(
    plays.map((p) => p.rank),
    [1, 2, 3, 4]
  );
});

test("ties deterministic: identical inputs yield byte-identical output across runs", () => {
  const build = () => {
    const ranked = [scored("AAA", "long", 68), scored("BBB", "short", 61)];
    const chains = { AAA: chainAround(120), BBB: chainAround(80) };
    const dossierMap = { AAA: dossier("AAA", 120), BBB: dossier("BBB", 80) };
    return buildDeterministicEditionPlays({ ranked, dossierMap, chains }).plays;
  };
  assert.deepEqual(build(), build());
});

test("pickChainContract picks the most ATM strike among eligible, deterministically", () => {
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(90, { oi: 5_000, callAsk: 12, callBid: 11 }),
      row(100, { oi: 5_000, callAsk: 4, callBid: 3.6 }), // ATM
      row(110, { oi: 5_000, callAsk: 1.2, callBid: 1.0 }),
    ],
  };
  const c = pickChainContract(chain, "long");
  assert.equal(c?.strike, 100);
  assert.equal(c?.side, "call");
  assert.equal(c?.caveat, undefined, "strict pick has no caveat");
});

test("pickChainContract returns best-effort contract with caveat when strict gates fail", () => {
  const chain: EditionChainData = { spot: 100, rows: [row(100, { oi: 50, callAsk: 999, callBid: 998 })] };
  const result = pickChainContract(chain, "long");
  assert.ok(result != null, "returns best-effort instead of null");
  assert.equal(result!.strike, 100);
  assert.equal(result!.caveat, "premium_high_low_liquidity");
});

test("pickChainContract returns null only when no rows have any quotes", () => {
  const chain: EditionChainData = { spot: 100, rows: [row(100, { oi: 50 })] };
  assert.equal(pickChainContract(chain, "long"), null);
});

test("pickChainContract accepts 2+ DTE contracts (MIN_DTE lowered from 5 to 2)", () => {
  // Both 3-day and 30-day clear the 2-day floor. Deterministic tie-break: closest strike to
  // spot then nearest expiry — so the 3-day contract wins (same strike, nearer expiry).
  const today = new Date();
  const shortExpiry = new Date(today.getTime() + 3 * 86400_000).toISOString().slice(0, 10);
  const longExpiry = new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(100, { oi: 5_000, callAsk: 4, callBid: 3.6, expiry: shortExpiry }),
      row(100, { oi: 5_000, callAsk: 5, callBid: 4.6, expiry: longExpiry }),
    ],
  };
  const c = pickChainContract(chain, "long");
  assert.ok(c != null);
  assert.equal(c!.expiry, shortExpiry, "3-day contract clears 2-day floor and wins tie-break");
});

test("pickChainContract rejects same-day expiry but accepts 3-day", () => {
  const today = new Date();
  // Same-day (0 DTE, rejected by "swing never trades same-day expiry")
  const sameDayExpiry = today.toISOString().slice(0, 10);
  // 3 days out clears the 2-day floor in any timezone
  const threeDayExpiry = new Date(today.getTime() + 3 * 86400_000).toISOString().slice(0, 10);
  const chain: EditionChainData = {
    spot: 100,
    rows: [
      row(100, { oi: 5_000, callAsk: 4, callBid: 3.6, expiry: sameDayExpiry }),
      row(100, { oi: 5_000, callAsk: 5, callBid: 4.6, expiry: threeDayExpiry }),
    ],
  };
  const c = pickChainContract(chain, "long");
  assert.ok(c != null);
  assert.equal(c!.expiry, threeDayExpiry, "3-day contract accepted; same-day rejected");
});

test("thesis is grounded in the score breakdown and cites the leading driver", () => {
  const s = scored("XYZ", "long", 66);
  const { thesis, key_signal } = buildDeterministicThesis(s, dossier("XYZ", 120));
  assert.match(thesis, /XYZ/);
  assert.match(key_signal, /score 66/);
  assert.match(key_signal, /flow/);
});

test("score floor: candidates below MIN_PUBLISH_SCORE (42) are excluded (PR-N28)", () => {
  const ranked = [
    scored("STRONG", "long", 60),
    scored("OKAY", "short", 45),
    scored("WEAK", "long", 38),
    scored("GARBAGE", "short", 10),
  ];
  const chains = {
    STRONG: chainAround(100), OKAY: chainAround(80),
    WEAK: chainAround(120), GARBAGE: chainAround(90),
  };
  const dossierMap = {
    STRONG: dossier("STRONG", 100), OKAY: dossier("OKAY", 80),
    WEAK: dossier("WEAK", 120), GARBAGE: dossier("GARBAGE", 90),
  };
  const { plays, funnel } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 2, "only STRONG and OKAY clear the 42 floor");
  assert.deepEqual(plays.map(p => p.ticker), ["STRONG", "OKAY"]);
  assert.equal(funnel.score_below_floor, 2, "WEAK + GARBAGE counted");
});

test("thesis explains flow/tech divergence when direction opposes trend (PR-N28)", () => {
  const s = scored("COIN", "long", 53);
  const d = dossier("COIN", 160, { tech: { ...dossier("COIN", 160).tech!, trend: "bearish" } } as any);
  const { thesis } = buildDeterministicThesis(s, d);
  assert.match(thesis, /Flow conviction overrides bearish technicals/);
});

test("LONG target is pushed above call strike + 2×premium when stock target < strike (PR-N29)", () => {
  // High-priced stock where ATR-based target lands below the ATM strike
  const highChain: EditionChainData = {
    spot: 1175,
    rows: [row(1260, { oi: 5_000, callAsk: 7.5, callBid: 7.0 })],
  };
  const ranked = [scored("HPS", "long", 65)];
  const chains = { HPS: highChain };
  const dossierMap = {
    HPS: dossier("HPS", 1175, {
      tech: {
        ...dossier("HPS", 1175).tech!,
        // Tight S/R so stock target < strike
        resistance_levels: [1249],
        support_levels: [1100],
        atr14: 50,
      },
    } as any),
  };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 1);
  const p = plays[0]!;
  const target = Number(String(p.target).replace(/[$,]/g, ""));
  // Target must clear the strike (option is ITM at "target"), but the push toward
  // strike + 2×premium (~1274.50) is now capped at 1.25× the original target distance
  // from the entry midpoint — see the R:R-inflation-cap fix (audit 2026-07-28) — so it
  // lands short of the full strike+2×premium figure in this tight-ATR fixture. That's
  // the intended tradeoff: bounded R:R inflation over an exact strike+2×premium match.
  assert.ok(target >= 1260, `target ${target} should be >= strike 1260`);
  assert.ok(target < 1274.5, `target ${target} should be capped below the uncapped strike+2×premium ~1274.50`);
});

test("SHORT target is pushed below put strike - 2×premium when stock target > strike (PR-N29)", () => {
  const highChain: EditionChainData = {
    spot: 1175,
    rows: [row(1100, { oi: 5_000, putAsk: 8.0, putBid: 7.5 })],
  };
  const ranked = [scored("HPS", "short", 65)];
  const chains = { HPS: highChain };
  const dossierMap = {
    HPS: dossier("HPS", 1175, {
      tech: {
        ...dossier("HPS", 1175).tech!,
        resistance_levels: [1200],
        support_levels: [1150],
        atr14: 20,
      },
    } as any),
  };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays.length, 1);
  const p = plays[0]!;
  const target = Number(String(p.target).replace(/[$,]/g, ""));
  // The push toward strike - 2×premium (~1084.50) is capped at 1.25× the original target
  // distance from the entry midpoint — see the R:R-inflation-cap fix (audit 2026-07-28) —
  // so in this tight-ATR fixture the capped push doesn't reach all the way to the strike.
  // It must still move the target DOWN from its original (pre-push) value, though.
  assert.ok(target < 1175, `target ${target} should still be pushed down from entry mid 1175`);
  assert.ok(target > 1084.5, `target ${target} should be capped above the uncapped strike-2×premium ~1084.50`);
});

test("R:R inflation cap: option-coherence push cannot exceed 1.25× the original target distance (P1 fix, audit 2026-07-28)", () => {
  // Same tight-ATR LONG setup as above, sized so the naive (uncapped) push would have
  // roughly doubled the reward distance from the entry midpoint. Assert the actual push
  // stays within the 1.25× cap instead of chasing strike + 2×premium unconditionally.
  const highChain: EditionChainData = {
    spot: 1175,
    rows: [row(1260, { oi: 5_000, callAsk: 7.5, callBid: 7.0 })],
  };
  const ranked = [scored("HPS", "long", 65)];
  const chains = { HPS: highChain };
  const dossierMap = {
    HPS: dossier("HPS", 1175, {
      tech: {
        ...dossier("HPS", 1175).tech!,
        resistance_levels: [1249],
        support_levels: [1100],
        atr14: 50,
      },
    } as any),
  };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  const p = plays[0]!;
  const target = Number(String(p.target).replace(/[$,]/g, ""));
  const entryNums = String(p.entry_range).match(/[\d.]+/g)!.map(Number);
  const entryMid = (entryNums[0]! + entryNums[entryNums.length - 1]!) / 2;
  const dist = target - entryMid;
  // Uncapped push would have targeted strike + 2×premium = 1274.50, ~93.75 above mid (1175).
  // Capped push must not exceed 1.25× the original (pre-option-push) target distance.
  assert.ok(dist <= 93.75 + 0.01, `pushed distance ${dist} exceeded the 1.25× cap`);
});

// ── PR-N31: diversity hedge floor ────────────────────────────────────────────────────
test("PR-N31: diversity swap fires for contrarian above DIVERSITY_HEDGE_FLOOR (35) but below MIN_PUBLISH_SCORE (42)", () => {
  // 5 long candidates scoring above 42, plus one short scoring 38 (above 35, below 42)
  const ranked = [
    scored("AA", "long", 70),
    scored("BB", "long", 65),
    scored("CC", "long", 60),
    scored("DD", "long", 55),
    scored("EE", "long", 50),
    scored("FF", "short", 38),
  ];
  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 5);
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.ok(shorts.length >= 1, `expected at least 1 SHORT hedge play, got ${shorts.length}`);
  assert.equal(shorts[0]!.ticker, "FF");
  assert.ok(
    shorts[0]!.gate_warnings?.some((w) => w.includes("Hedge/contrarian")),
    "hedge play should have a gate_warning indicating it's a contrarian hedge"
  );
});

test("PR-N31+N33: Phase 1 rejects natural short below DIVERSITY_HEDGE_FLOOR; Phase 2 forced contrarian may still fire", () => {
  // FF is a natural short with score 15 — below DIVERSITY_HEDGE_FLOOR (35), so Phase 1 skips it.
  // Phase 2 then tries forced contrarian re-scoring on the all-LONG pool. With default dossier
  // data and boosted tech scores, forced contrarian scores should land >= FORCED_CONTRARIAN_FLOOR (35).
  // The key assertion: the short that appears is a FORCED contrarian (Phase 2), not the natural FF.
  const ranked = [
    scored("AA", "long", 70),
    scored("BB", "long", 65),
    scored("CC", "long", 60),
    scored("DD", "long", 55),
    scored("EE", "long", 50),
    scored("FF", "short", 15),
  ];
  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }
  // FF is the only candidate left after AA-EE fill the 5 slots. It needs strong bearish
  // tech + positioning so forced-short re-score clears FORCED_CONTRARIAN_FLOOR (35).
  // scoreContrarianHedge re-scores from the DOSSIER, not the candidate's tech_score field.
  // Prior fixture scored 34 (te=24,po=2,vx=3,fl=5) — add bearish-ma + call-wall proximity.
  dossierMap["FF"] = dossier("FF", 100, {
    tech: {
      ticker: "FF", price: 100, trend: "bearish" as const,
      setup_tags: ["gap down", "breakdown", "bearish ma"], support_levels: [90], resistance_levels: [105],
      gap_zones: [], breakout_zones: [],
      prior_day: { high: 108, low: 95, close: 100 },
      weekly: { high: null, low: null },
      rsi14: 78, rel_volume: 3.0, atr14: 4,
      vwap: 103, ema20: 104, ema50: 105, ema200: 108,
      summary: "FF bearish reversal",
    },
    dark_pool: { total_premium: 6_000_000, bias: "bearish" },
    positioning: {
      net_gex: -800000,
      gex_king_strike: 95,
      gamma_flip: 98,
      gamma_regime: "negative",
      net_vex: -300000,
      max_pain: 95,
      negative_gamma: true,
      wall_summary: "call wall $105 (+5pts) · put wall $90 (-10pts)",
    } as any,
  });
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 5);
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.ok(shorts.length >= 1, "Phase 2 forced contrarian should produce a SHORT");
  assert.ok(
    shorts[0]!.gate_warnings?.some((w) => w.includes("Forced contrarian")),
    "should be a Phase 2 forced contrarian, not a Phase 1 natural swap (FF was below DIVERSITY_HEDGE_FLOOR)"
  );
  assert.ok((shorts[0]!.score ?? 0) >= 35, "forced hedge must clear the raised 35 floor");
});

// ── PR-N32: Forced contrarian re-score ──────────────────────────────────────────────────────────

test("PR-N32: scoreContrarianHedge re-scores a LONG candidate as SHORT with discounted flow", () => {
  const original = scored("AAPL", "long", 72);
  original.flow_score = 30;
  original.regime_multiplier = 1.1;
  const dos = dossier("AAPL", 150, {
    tech: {
      ticker: "AAPL",
      price: 150,
      trend: "bearish",
      setup_tags: ["gap down"],
      support_levels: [145],
      resistance_levels: [155],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: 155, low: 145, close: 150 },
      weekly: { high: null, low: null },
      rsi14: 72,
      rel_volume: 2.0,
      atr14: 3,
      vwap: 151,
      ema20: 151,
      ema50: 151,
      ema200: 151,
      summary: "test",
    },
  });
  const contrarian = scoreContrarianHedge(original, dos, "short");
  assert.equal(contrarian.direction, "short");
  assert.equal(contrarian.flow_score, Math.round(30 * 0.3), "flow discounted by 0.3");
  assert.ok(contrarian.score >= 0 && contrarian.score <= 100);
  assert.ok(contrarian.tech_score > 0, "bearish tech should score positively for a short");
});

test("PR-N32: forced contrarian swap fires when ALL candidates are LONG and dossier supports a short", () => {
  // 6 candidates ALL direction="long" — simulates a bull market where call flow dominates everything.
  // Give one candidate (FF) bearish technicals so it re-scores well as a forced short.
  const ranked = [
    scored("AA", "long", 72),
    scored("BB", "long", 68),
    scored("CC", "long", 63),
    scored("DD", "long", 58),
    scored("EE", "long", 52),
    scored("FF", "long", 48),
  ];
  // Give FF bearish technicals so forced-short re-score is viable
  for (const r of ranked) r.flow_score = 20;

  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }
  // Make FF have bearish technicals + overbought RSI for a plausible short re-score
  // Must clear FORCED_CONTRARIAN_FLOOR (35) after flow discount (flow_score 20 → 6).
  dossierMap["FF"] = dossier("FF", 100, {
    tech: {
      ticker: "FF",
      price: 100,
      trend: "bearish",
      setup_tags: ["gap down", "bearish ma", "breakdown"],
      support_levels: [95],
      resistance_levels: [105],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: 105, low: 95, close: 100 },
      weekly: { high: null, low: null },
      rsi14: 72,
      rel_volume: 3.0,
      atr14: 3,
      vwap: 103,
      ema20: 104,
      ema50: 105,
      ema200: 108,
      summary: "test",
    },
    dark_pool: { total_premium: 6_000_000, bias: "bearish" },
    positioning: {
      net_gex: -800000,
      gex_king_strike: 95,
      gamma_flip: 98,
      gamma_regime: "negative",
      net_vex: -300000,
      max_pain: 95,
      negative_gamma: true,
      wall_summary: "call wall $105 (+5pts) · put wall $90 (-10pts)",
    } as any,
  });

  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 5);
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.ok(shorts.length >= 1, `expected forced contrarian SHORT, got ${shorts.length} shorts`);
  assert.ok(
    shorts[0]!.gate_warnings?.some((w) => w.includes("Forced contrarian")),
    "forced contrarian should have a gate_warning"
  );
  // The short should be in position 5 (last slot)
  assert.equal(plays[4]!.direction, "SHORT", "contrarian hedge should be in the last slot");
});

test("NH_LEGACY_FORCED_HEDGE=0 disables Phase 2 forced-contrarian re-score (the flag used to be a no-op)", () => {
  // Regression guard: `forcedContrarianHedgeEnabled` was imported but never checked — Phase 2 only
  // gated on `!diversitySwapped`, so this env var had zero effect on the all-LONG monoculture case.
  process.env.NH_LEGACY_FORCED_HEDGE = "0";
  const ranked = [
    scored("AA", "long", 72),
    scored("BB", "long", 68),
    scored("CC", "long", 63),
    scored("DD", "long", 58),
    scored("EE", "long", 52),
    scored("FF", "long", 48),
  ];
  for (const r of ranked) r.flow_score = 20;

  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }
  dossierMap["FF"] = dossier("FF", 100, {
    tech: {
      ticker: "FF",
      price: 100,
      trend: "bearish",
      setup_tags: ["gap down", "bearish ma", "breakdown"],
      support_levels: [95],
      resistance_levels: [105],
      gap_zones: [],
      breakout_zones: [],
      prior_day: { high: 105, low: 95, close: 100 },
      weekly: { high: null, low: null },
      rsi14: 72,
      rel_volume: 3.0,
      atr14: 3,
      vwap: 103,
      ema20: 104,
      ema50: 105,
      ema200: 108,
      summary: "test",
    },
    dark_pool: { total_premium: 6_000_000, bias: "bearish" },
    positioning: {
      net_gex: -800000,
      gex_king_strike: 95,
      gamma_flip: 98,
      gamma_regime: "negative",
      net_vex: -300000,
      max_pain: 95,
      negative_gamma: true,
      wall_summary: "call wall $105 (+5pts) · put wall $90 (-10pts)",
    } as any,
  });

  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.equal(shorts.length, 0, "flag off → no forced-contrarian short, book stays all-LONG monoculture");
});

test("PR-N32: forced contrarian does NOT fire when natural opposite-direction candidate exists", () => {
  // FF is a natural short above DIVERSITY_HEDGE_FLOOR (35) — Phase 1 handles it, Phase 2 never runs.
  const ranked = [
    scored("AA", "long", 72),
    scored("BB", "long", 68),
    scored("CC", "long", 63),
    scored("DD", "long", 58),
    scored("EE", "long", 52),
    scored("FF", "short", 38),
  ];
  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }

  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 5);
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.ok(shorts.length >= 1);
  assert.equal(shorts[0]!.ticker, "FF", "natural short FF should be used, not a forced contrarian");
  assert.ok(
    shorts[0]!.gate_warnings?.some((w) => w.includes("Hedge/contrarian")),
    "should use Phase 1 hedge warning, not Phase 2 forced contrarian"
  );
  assert.ok(
    !shorts[0]!.gate_warnings?.some((w) => w.includes("Forced contrarian")),
    "should NOT have forced contrarian warning when natural opposite exists"
  );
});

test("PR-N33: forced contrarian fires with candidate above FORCED_CONTRARIAN_FLOOR (35)", () => {
  // All LONG, strong tech/positioning to produce a forced contrarian score above the 35 floor.
  // Before N33 any signal-free candidate was admitted; now it needs real contrarian evidence.
  const ranked = [
    scored("AA", "long", 72),
    scored("BB", "long", 68),
    scored("CC", "long", 63),
    scored("DD", "long", 58),
    scored("EE", "long", 52),
    scored("GG", "long", 45),
  ];
  for (const r of ranked) { r.flow_score = 8; }

  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }
  // GG needs bearish tech + positioning so forced-short re-score clears FORCED_CONTRARIAN_FLOOR (35).
  // scoreContrarianHedge re-scores from the DOSSIER, not the candidate's tech_score/pos_score.
  dossierMap["GG"] = dossier("GG", 100, {
    tech: {
      ticker: "GG", price: 100, trend: "bearish" as const,
      setup_tags: ["gap down", "breakdown", "death cross", "bearish ma"], support_levels: [88], resistance_levels: [105],
      gap_zones: [], breakout_zones: [],
      prior_day: { high: 110, low: 98, close: 100 },
      weekly: { high: null, low: null },
      rsi14: 78, rel_volume: 3.5, atr14: 5,
      vwap: 104, ema20: 105, ema50: 106, ema200: 110,
      summary: "GG bearish reversal — price below all EMAs, overbought RSI",
    },
    dark_pool: { total_premium: 8_000_000, bias: "bearish" },
    positioning: {
      net_gex: -900000,
      gex_king_strike: 95,
      gamma_flip: 98,
      gamma_regime: "negative",
      net_vex: -400000,
      max_pain: 95,
      negative_gamma: true,
      wall_summary: "call wall $105 (+5pts) · put wall $88 (-12pts)",
    } as TickerDossier["positioning"],
  });

  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  assert.equal(plays.length, 5);
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.ok(shorts.length >= 1, `N33: expected forced contrarian SHORT, got ${shorts.length}`);
  assert.ok(
    shorts[0]!.gate_warnings?.some((w) => w.includes("Forced contrarian")),
    "should carry forced contrarian gate_warning"
  );
  const hedgeScore = shorts[0]!.score ?? 0;
  assert.ok(hedgeScore >= 35, `hedge score ${hedgeScore} should be >= FORCED_CONTRARIAN_FLOOR (35)`);
});

// ── Diversity hedge fires at 3 plays (not just >= 4) ──────────────────────────
test("diversity hedge fires for a 3-play all-LONG edition (threshold lowered to >= 3)", () => {
  const ranked = [
    scored("AA", "long", 70),
    scored("BB", "long", 65),
    scored("CC", "long", 60),
    scored("FF", "short", 38),
  ];
  const chains: Record<string, any> = {};
  const dossierMap: Record<string, any> = {};
  for (const r of ranked) {
    const spot = 100;
    chains[r.ticker] = chainAround(spot);
    dossierMap[r.ticker] = dossier(r.ticker, spot);
  }
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 3 });
  assert.equal(plays.length, 3);
  const shorts = plays.filter((p) => p.direction === "SHORT");
  assert.ok(shorts.length >= 1, `3-play edition: expected at least 1 SHORT hedge, got ${shorts.length}`);
  assert.equal(shorts[0]!.ticker, "FF", "should swap last slot for the natural short candidate");
});

// ── pickChainContract maxDte window (intraday 0DTE vs overnight swing) ──────────────────────────
// Regression: the day-trade agent asks for a 0–1 DTE contract but the picker was hardcoded to the
// overnight-swing window (skip same-day expiry, require ≥5 calendar DTE), so a "0DTE day trade"
// always got a ~5-DTE contract that the day filter then dropped — the structural half of the empty
// intraday-0DTE-board bug. maxDte 0/1 must select a same-day/next-day contract; null keeps swing.
import { todayEtYmd } from "@/lib/providers/spx-session";

function ymdPlus(days: number): string {
  const t = todayEtYmd();
  const d = new Date(t + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function multiExpiryChain(): EditionChainData {
  return {
    spot: 100,
    rows: [
      row(100, { expiry: ymdPlus(0), callAsk: 4.2, callBid: 3.8 }),
      row(100, { expiry: ymdPlus(1), callAsk: 4.2, callBid: 3.8 }),
      row(100, { expiry: ymdPlus(7), callAsk: 4.2, callBid: 3.8 }),
    ],
  };
}

test("pickChainContract: maxDte=0 selects the SAME-DAY (0DTE) contract", () => {
  const c = pickChainContract(multiExpiryChain(), "long", 0);
  assert.ok(c, "should pick a contract");
  assert.equal(c!.expiry, ymdPlus(0), "0DTE window must select the same-day expiry");
});

test("pickChainContract: maxDte=null keeps the overnight-swing window (≥5 DTE, never same-day)", () => {
  const c = pickChainContract(multiExpiryChain(), "long", null);
  assert.ok(c, "should pick a contract");
  assert.equal(c!.expiry, ymdPlus(7), "swing must select the ≥5-DTE expiry, not the same-day one");
});

test("pickChainContract: maxDte=0 returns null when the chain has NO same-day expiry (honest)", () => {
  const noSameDay: EditionChainData = {
    spot: 100,
    rows: [row(100, { expiry: ymdPlus(4), callAsk: 4.2, callBid: 3.8 }), row(100, { expiry: ymdPlus(7), callAsk: 4.2, callBid: 3.8 })],
  };
  assert.equal(pickChainContract(noSameDay, "long", 0), null);
});

test("bangerTickers get the scale-out exit risk_note; non-banger plays do not", () => {
  const ranked = [scored("AAA", "long", 68), scored("BBB", "short", 61)];
  const chains = { AAA: chainAround(120), BBB: chainAround(80) };
  const dossierMap = { AAA: dossier("AAA", 120), BBB: dossier("BBB", 80) };

  const { plays } = buildDeterministicEditionPlays({
    ranked,
    dossierMap,
    chains,
    target: 5,
    bangerTickers: new Set(["AAA"]), // only AAA is a whole-market breakout
  });
  const aaa = plays.find((p) => p.ticker === "AAA");
  const bbb = plays.find((p) => p.ticker === "BBB");
  assert.ok(aaa, "AAA play built");
  assert.match(aaa.risk_note ?? "", /scale out|Banger exit/i, "banger play carries the scale-out guidance");
  assert.equal(aaa.exit_style, "scale_out", "banger play carries the queryable exit_style marker");
  assert.equal(bbb?.risk_note, undefined, "non-banger play has no scale-out note");
  assert.equal(bbb?.exit_style, undefined, "non-banger play has no exit_style marker (default grinder exit)");
});

test("factor_breakdown persists per-component scores from ScoredCandidate", () => {
  const ranked = [scored("AAA", "long", 68)];
  const chains = { AAA: chainAround(120) };
  const dossierMap = { AAA: dossier("AAA", 120) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 5 });
  const fb = plays[0]!.factor_breakdown;
  assert.ok(fb, "factor_breakdown must be present");
  assert.equal(fb.flow, 18, "flow_score persisted");
  assert.equal(fb.tech, 12, "tech_score persisted");
  assert.equal(fb.positioning, 6, "pos_score persisted");
  assert.equal(fb.news, 2, "news_score persisted");
  assert.equal(fb.smart_money, 3, "smart_money_score persisted");
});

test("no bangerTickers passed → no play gets a scale-out note (backwards compatible)", () => {
  const ranked = [scored("AAA", "long", 68)];
  const chains = { AAA: chainAround(120) };
  const dossierMap = { AAA: dossier("AAA", 120) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains });
  assert.equal(plays[0]?.risk_note, undefined);
});

// ── buildRescuePlays sector propagation ─────────────────────────────────────────
// Regression: buildRescuePlays omitted `sector` from the play object, breaking
// the cross-edition governor's per-sector cap.

test("buildRescuePlays propagates sector from ScoredCandidate", () => {
  const s = { ...scored("NVDA", "long", 68), sector: "Technology" } as ScoredCandidate;
  const plays = buildRescuePlays({
    ranked: [s],
    dossierMap: { NVDA: dossier("NVDA", 120) },
    chains: {},
  });
  assert.equal(plays.length, 1);
  assert.equal(plays[0]!.sector, "technology", "sector should be lowercased from ScoredCandidate");
  assert.equal(plays[0]!.gate_promoted, true, "rescue plays are always gate_promoted");
});

// ── scoreContrarianHedge confirming_signals recalculation ──────────────────────
// Regression: scoreContrarianHedge spread ...original which carried stale
// confirming_signals from the ORIGINAL direction. The fix recalculates from the
// new sub-scores and uses assignNighthawkTier instead of the deprecated
// convictionFromScore.

test("scoreContrarianHedge recalculates confirming_signals from new sub-scores", () => {
  const orig = {
    ...scored("NVDA", "long", 72),
    confirming_signals: 7,
    earnings_risk: false,
  } as ScoredCandidate;
  const d = dossier("NVDA", 120);
  const hedge = scoreContrarianHedge(orig, d, "short");
  assert.equal(hedge.direction, "short", "direction should be forced to short");
  assert.notEqual(hedge.score, orig.score, "score should differ from original");
  assert.equal(typeof hedge.confirming_signals, "number");
  // The contrarian direction should NOT inherit the original's confirming_signals=7.
  // With the test dossier's minimal data, most sub-scores will be low/zero in the
  // forced direction, so confirming_signals should be less than the original.
  assert.notEqual(hedge.confirming_signals, orig.confirming_signals,
    "confirming_signals must be recomputed, not inherited from original");
  assert.ok(hedge.conviction, "conviction should be set via assignNighthawkTier");
});

test("buildRescuePlays: missing sector on ScoredCandidate → sector undefined", () => {
  const s = scored("AAPL", "long", 60);
  const plays = buildRescuePlays({
    ranked: [s],
    dossierMap: { AAPL: dossier("AAPL", 150) },
    chains: {},
  });
  assert.equal(plays.length, 1);
  assert.equal(plays[0]!.sector, undefined, "no sector on scored → play.sector should be undefined");
});

test("global strongest: skips halted top ranks and picks best tradable name", () => {
  const ranked = [
    { ...scored("TOP1", "long", 80), trading_halt: true },
    { ...scored("TOP2", "long", 78), trading_halt: true },
    scored("DEEP", "long", 62),
  ];
  const chains = { DEEP: chainAround(100) };
  const dossierMap = { DEEP: dossier("DEEP", 100) };
  const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 1 });
  assert.equal(plays.length, 1);
  assert.equal(plays[0]!.ticker, "DEEP", "must scan full ranked pool, not stop at truncated slice");
});

test("diversity hedge skipped when NH_LEGACY_DIVERSITY_HEDGE=0", () => {
  const key = "NH_LEGACY_DIVERSITY_HEDGE";
  const prev = process.env[key];
  process.env[key] = "0";
  try {
    const ranked = [
      scored("AA", "long", 70),
      scored("BB", "long", 65),
      scored("CC", "long", 60),
      scored("FF", "short", 55),
    ];
    const chains: Record<string, ReturnType<typeof chainAround>> = {};
    const dossierMap: Record<string, ReturnType<typeof dossier>> = {};
    for (const r of ranked) {
      chains[r.ticker] = chainAround(100);
      dossierMap[r.ticker] = dossier(r.ticker, 100);
    }
    const { plays } = buildDeterministicEditionPlays({ ranked, dossierMap, chains, target: 3 });
    assert.equal(plays.length, 3);
    assert.ok(plays.every((p) => p.direction === "LONG"), "no hedge swap when diversity disabled");
    assert.equal(plays[0]!.ticker, "AA");
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});
