import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { computeSpxConfluence, matchingHelixSweepFlows, reclassifyConfluenceScore } from "./spx-signals";
import type { SpxSignalFactor } from "./spx-signals";

// PROOF THIS PR DOES NOT CHANGE LIVE SIGNALS
// ───────────────────────────────────────────────────────────────────────────
// The spx-shadow-signal-framework PR adds a new file (spx-signals-shadow.ts),
// a new DB table, and one new fire-and-forget call site in spx-play-engine.ts
// — but ZERO lines in THIS file (spx-signals.ts, the pure confluence engine
// that gates real-money 0DTE BUY_CALL/BUY_PUT recommendations). `git diff
// main -- src/lib/spx-signals.ts` for that PR is empty.
//
// This test is the belt-and-suspenders proof that matters more than the diff:
// it feeds computeSpxConfluence() a fixture desk exercising ~20 of the ~21
// possible factors (VWAP, gamma regime, GEX support/resistance/anchor, max
// pain, 0DTE flow, dark pool, tide, NOPE, IV rank, TICK/TRIN/ADD, mega-caps,
// live tape, EMA20, net premium, VIX curve, HELIX sweeps, news risk, strike
// stack) and asserts the ENTIRE returned object — score, grade, action,
// confidence, factors array (labels + weights + details, in order), and
// levels — is byte-for-byte identical to a value captured from this exact
// code path. Any future change to spx-signals.ts (from this PR or any other)
// that shifts so much as one weight, one factor label, or the grade/action
// thresholds fails this test immediately.
//
// Session-window scoring (etCk / nowEtMins in computeSpxConfluence) reads the
// wall clock directly, so `now` is frozen via node:test's MockTimers to a
// fixed ET timestamp (14:00 ET / 18:00 UTC on 2026-07-04, a Saturday for the
// mocked date but the function does not gate on weekday) that falls outside
// all three named session windows (morning ORB 9:50-11:30, lunch chop
// 11:30-13:00, power hour 15:00-15:30) so the "Session window" factor does
// not fire and does not need to be part of the golden fixture below.

function richDesk(): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-07-04T18:00:00.000Z",
    source: "polygon",
    price: 7420,
    spx_change_pct: 0.6,
    vix: 13,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7350,
    hod: 7430,
    vwap: 7400,
    pdh: 7410,
    pdl: 7340,
    prior_close: 7380,
    gap_pct: null,
    gap_source: null,
    ema20: 7400,
    ema50: 7380,
    ema200: 7200,
    sma50: 7370,
    sma200: 7180,
    tick: 250,
    trin: 0.8,
    add: 600,
    gex_net: 1_000_000,
    gex_king: 7415,
    max_pain: 7430,
    gamma_flip: 7380,
    above_gamma_flip: true,
    gamma_regime: "mean_revert",
    gex_walls: [
      { strike: 7410, net_gex: 500_000, kind: "support", distance_pts: 10 },
      { strike: 7460, net_gex: -500_000, kind: "resistance", distance_pts: 40 },
    ],
    flow_0dte_call_premium: 300_000,
    flow_0dte_put_premium: 0,
    flow_0dte_net: 300_000,
    tide_bias: "bullish",
    tide_call_premium: 500_000,
    tide_put_premium: 100_000,
    tide_net: 400_000,
    nope: 0.8,
    nope_net_delta: null,
    uw_iv_rank: 75,
    regime: "bullish",
    levels: [],
    dark_pool: {
      prints: [],
      total_premium: 200_000,
      call_premium: 150_000,
      put_premium: 50_000,
      bias: "bullish",
      pcr: 0.33,
      detail: "",
    },
    spx_flows: [
      {
        ticker: "SPX",
        premium: 1_200_000,
        option_type: "C",
        strike: 7425,
        expiry: "2026-07-04",
        ask_pct: 75,
        direction: "bullish",
        alerted_at: "2026-07-04T17:50:00.000Z",
        alert_rule: null,
        trade_count: 10,
        has_sweep: true,
      },
      {
        ticker: "SPX",
        premium: 100_000,
        option_type: "P",
        strike: 7350,
        expiry: "2026-07-04",
        ask_pct: 75,
        direction: "bearish",
        alerted_at: "2026-07-04T17:50:00.000Z",
        alert_rule: null,
        trade_count: 2,
        has_sweep: true,
      },
    ],
    unified_tape: [
      { kind: "flow", side: "call", time: "2026-07-04T17:55:00.000Z", label: "SPX C", premium: 260_000, detail: "", ask_pct: 75 },
      { kind: "flow", side: "put", time: "2026-07-04T17:54:00.000Z", label: "SPX P", premium: 50_000, detail: "", ask_pct: 75 },
    ],
    strike_stacks: [
      {
        ticker: "SPX",
        strike: 7425,
        option_type: "CALL",
        expiry: "2026-07-04",
        alert_count: 5,
        total_premium: 900_000,
        premiums: [200_000, 200_000, 200_000, 150_000, 150_000],
        trade_count: 5,
        repeated_hits: true,
        same_strike_accumulation: true,
      },
    ],
    net_prem_ticks: [
      { time: "2026-07-04T17:00:00.000Z", net: 100_000 },
      { time: "2026-07-04T17:30:00.000Z", net: 700_000 },
    ],
    vix_term: { vix9d: 14, vix3m: 16, structure: "contango", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    sector_heat: [],
    leader_stocks: [{ name: "Apple", ticker: "AAPL", change_pct: 1.0 }],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [
      { title: "Markets rally on dovish rate cut hopes", published: "2026-07-04T17:00:00.000Z", tickers: [] },
      {
        title: "Stocks close at record high after strong earnings beat estimates",
        published: "2026-07-04T17:10:00.000Z",
        tickers: [],
      },
    ],
    greek_exposure: null,
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    market_breadth: null,
    mag7_greek_flow: null,
    macro_indicators: [],
    market_open: true,
    polled_at: "2026-07-04T18:00:00.000Z",
  };
}

const GOLDEN = {
  action: "BUY_CALL",
  bias: "bullish",
  rawScore: 96,
  score: 100,
  grade: "A+",
  conflicts: 1,
  weighted_conflicts: 2,
  agreeing: 20,
  direction: "long",
  headline: "",
  thesis: "",
  factors: [
    { label: "GEX support", weight: 18, detail: "At 0DTE support node 7410 (+10 pts)" },
    {
      label: "HELIX sweeps",
      weight: 15,
      detail: "0DTE bullish sweeps dominant — $1.2M vs $0.1M bearish (30min)",
    },
    { label: "0DTE flow", weight: 14, detail: "Call premium leading 0DTE tape" },
    { label: "VWAP", weight: 12, detail: "Above VWAP 7400.00 — buyers in control" },
    { label: "Live tape", weight: 12, detail: "Recent SPX flow bought calls / sold puts — $0.3M vs $0.1M" },
    { label: "γ regime", weight: 10, detail: "Above γ flip 7380 — mean-revert favors dips bought" },
    { label: "Market tide", weight: 10, detail: "bullish broad flow" },
    { label: "TICK", weight: 8, detail: "NYSE TICK +250" },
    { label: "NOPE", weight: 7, detail: "NOPE +0.80" },
    { label: "King node · GEX anchor", weight: 6, detail: "Above king/anchor 7415" },
    { label: "TRIN", weight: 6, detail: "TRIN 0.80 — broad buying" },
    { label: "Mega-caps", weight: 6, detail: "Leadership avg +1.00%" },
    { label: "Net prem", weight: 6, detail: "SPY net prem accelerating" },
    { label: "Max pain", weight: 5, detail: "Price below max pain 7430" },
    { label: "ADD", weight: 5, detail: "Advance/decline +600" },
    { label: "EMA 20", weight: 5, detail: "Above intraday EMA 20" },
    { label: "IV rank", weight: -4, detail: "High IV rank 75 — fade risk on longs" },
    {
      label: "VIX curve",
      weight: 4,
      detail: "VIX contango: 9d 14.0 < 3m 16.0 — calm near-term structure",
    },
    { label: "Dark pool", weight: 3, detail: "Institutional bias bullish" },
    { label: "News risk", weight: 3, detail: "2 positive headlines (rate cut/deal/beat)" },
    { label: "Strike stack", weight: 3, detail: "CALL $7425 — 5 repeated prints (long)" },
  ],
  levels: {
    entry: 7420,
    stop: 7407,
    target: 7432,
    invalidation: "Below 7407 (GEX support wall − 3pt)",
  },
  as_of: "2026-07-04T18:00:00.000Z",
};

test("computeSpxConfluence: byte-for-byte unchanged output for a rich fixture desk (shadow-framework PR proof)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const result = computeSpxConfluence(richDesk());
  assert.ok(result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), GOLDEN);
});

test("computeSpxConfluence: calling it twice in a row (as the shadow wiring's fire-and-forget call now does downstream) returns the identical object shape both times", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  const first = computeSpxConfluence(desk);
  const second = computeSpxConfluence(desk);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test("TICK/TRIN/ADD factors disclose when desk.internals_estimated flags a breadth-derived proxy (regression for the truth-mandate gap, live repro 2026-11-01)", (t) => {
  // Live evidence: GET /api/market/spx/desk returned tick:176/trin:0.5/add:800 alongside
  // internals_estimated:{tick:true,trin:true,add:true} (estimateTickFromBreadth/
  // estimateTrinFromBreadth/estimateAddFromBreadth substituted for a missing real Polygon
  // I:TICK/I:TRIN/I:ADD print), and the paired GET /api/market/spx/play scored all three with
  // detail text ("NYSE TICK +176", "TRIN 0.50 — broad buying", "Advance/decline +800") carrying
  // ZERO disclosure of the substitution — contributing +15 of +29 (52%) of the published score.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  desk.tick = 176;
  desk.trin = 0.5;
  desk.add = 800;
  desk.internals_estimated = { tick: true, trin: true, add: true };
  const result = computeSpxConfluence(desk);
  assert.ok(result);

  const tickFactor = result.factors.find((f) => f.label === "TICK");
  assert.ok(tickFactor, "TICK factor must fire on tick=176");
  assert.match(
    tickFactor!.detail,
    /estimated, not live/,
    "an internals_estimated.tick:true desk must disclose the breadth-proxy substitution, not present it as a real NYSE TICK print"
  );

  const trinFactor = result.factors.find((f) => f.label === "TRIN");
  assert.ok(trinFactor, "TRIN factor must fire on trin=0.5 (< 0.85 threshold)");
  assert.match(trinFactor!.detail, /estimated, not live/);

  const addFactor = result.factors.find((f) => f.label === "ADD");
  assert.ok(addFactor, "ADD factor must fire on add=800 (> 500 threshold)");
  assert.match(addFactor!.detail, /estimated, not live/);
});

test("TICK/TRIN/ADD factors do NOT disclose when desk.internals_estimated is absent/false (real exchange prints stay undecorated)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  // richDesk() never sets internals_estimated — i.e. a real desk reporting genuine live prints.
  const result = computeSpxConfluence(richDesk());
  assert.ok(result);
  const tickFactor = result.factors.find((f) => f.label === "TICK");
  const trinFactor = result.factors.find((f) => f.label === "TRIN");
  const addFactor = result.factors.find((f) => f.label === "ADD");
  assert.ok(tickFactor && trinFactor && addFactor);
  assert.doesNotMatch(tickFactor!.detail, /estimated/);
  assert.doesNotMatch(trinFactor!.detail, /estimated/);
  assert.doesNotMatch(addFactor!.detail, /estimated/);
});

test("HELIX sweeps factor: aggressively SOLD calls read BEARISH, not bullish (regression for the option-type-only bug)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  // $1.5M of 0DTE SPX calls, 80% sold at the bid (ask_pct: 20) — the pre-fix code bucketed this
  // purely by option_type and scored it as the strongest possible BULLISH sweep read (+15). The
  // aggressor-aware rule already shipped for the tape factor (spxTapeSkew/spxFlowSkew) says a sold
  // call is bearish, so this must now score -15, not +15.
  desk.spx_flows = [
    {
      ticker: "SPX",
      premium: 1_500_000,
      option_type: "CALL",
      strike: 7425,
      expiry: "2026-07-04",
      ask_pct: 20,
      direction: "bullish",
      alerted_at: "2026-07-04T17:50:00.000Z",
      alert_rule: null,
      trade_count: 10,
      has_sweep: true,
    },
  ];
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const sweepFactor = result.factors.find((f) => f.label === "HELIX sweeps");
  assert.ok(sweepFactor, "HELIX sweeps factor must fire on $1.5M of qualifying sweep premium");
  assert.equal(sweepFactor!.weight, -15, "sold calls must score as a BEARISH sweep, not bullish");
  assert.match(sweepFactor!.detail, /bearish sweeps dominant/);
});

test("HELIX sweeps factor: a future-dated flow alert is rejected, not counted as fresh sweep premium", (t) => {
  // Same future-print bug shape already fixed in Helix's contractStackHitsFromFlows/
  // selectHelixDiscordDigest et al.: an alerted_at ahead of `now` made `nowMs - alertedAt`
  // negative, which trivially satisfied `<= thirtyMinMs` and would count a clock-skewed/
  // mis-stamped UW flow alert toward this factor's bull/bear premium skew.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  desk.spx_flows = [
    {
      ticker: "SPX",
      premium: 1_500_000,
      option_type: "CALL",
      strike: 7425,
      expiry: "2026-07-04",
      ask_pct: 75,
      direction: "bullish",
      alerted_at: "2026-07-04T18:05:00.000Z", // 5 min AHEAD of the mocked `now`
      alert_rule: null,
      trade_count: 10,
      has_sweep: true,
    },
  ];
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const sweepFactor = result.factors.find((f) => f.label === "HELIX sweeps");
  assert.equal(sweepFactor, undefined, "a future-dated print must not count toward the sweep factor");
});

test("matchingHelixSweepFlows: excludes a future-dated flow directly — the shared filter spx-signal-observe/route.ts now also calls", () => {
  // This is the extracted, shared implementation behind the test above — exercised directly so a
  // future change to spx-signal-observe/route.ts (which imports this same function) is covered
  // without needing its own DB/auth-mocked route test.
  const now = Date.parse("2026-07-04T18:00:00.000Z");
  const fresh = {
    ticker: "SPX", premium: 500_000, option_type: "CALL", strike: 7425, expiry: "2026-07-04",
    direction: "bullish", alerted_at: "2026-07-04T17:50:00.000Z", alert_rule: null,
    trade_count: 1, has_sweep: true,
  };
  const future = { ...fresh, alerted_at: "2026-07-04T18:05:00.000Z" };
  const matching = matchingHelixSweepFlows([fresh, future], "2026-07-04", now, 30 * 60_000);
  assert.equal(matching.length, 1);
  assert.equal(matching[0], fresh);
});

// FIX (Ask Largo standing mandate, 2026-10-17): scoreNewsRisk's keyword scan had no negation/
// de-escalation awareness — a headline reporting an event being AVERTED or RESOLVED scored
// identically to the event actually happening.
test("News risk factor: a reversal verb right after the bear keyword suppresses the bearish hit", (t) => {
  // Without negation handling, each headline below double-counts: a bear hit (geopolit/war) AND
  // a bull hit (ceasefire) land net -2 ("2 high-risk headlines"). With it, the de-escalation verb
  // right next to each bear keyword suppresses it, leaving 2 clean bull hits -> net +2 bullish.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  desk.news_headlines = [
    { title: "Geopolitical tensions ease after ceasefire reached", published: "2026-07-04T17:00:00.000Z", tickers: [] },
    { title: "War fears ease as ceasefire holds", published: "2026-07-04T17:05:00.000Z", tickers: [] },
  ];
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const newsFactor = result.factors.find((f) => f.label === "News risk");
  assert.ok(newsFactor, "the un-negated 'ceasefire' bull hits must still fire");
  assert.equal(newsFactor!.weight, 3, `expected a net-bullish read once both bear hits are suppressed, got ${newsFactor?.weight}`);
  assert.doesNotMatch(newsFactor!.detail, /high-risk/i, "de-escalating headlines must not count as bearish");
});

test("News risk factor: a bullish keyword followed by a collapse verb does not score bullish", (t) => {
  // Without suppression, 2 such headlines read net +2 bullish ("2 positive headlines") off the
  // bare "stimulus"/"deal" words alone — the collapse is the opposite of bullish news.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  desk.news_headlines = [
    { title: "Stimulus deal collapses in Congress", published: "2026-07-04T17:00:00.000Z", tickers: [] },
    { title: "Relief deal collapses after talks fail", published: "2026-07-04T17:05:00.000Z", tickers: [] },
  ];
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const newsFactor = result.factors.find((f) => f.label === "News risk");
  assert.equal(newsFactor, undefined, "collapsed deals must not score as positive headlines");
});

test("News risk factor: a reversal verb tied to one clause does not suppress a genuinely bearish keyword in a different clause of the same headline", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  // "dashed" belongs to the rate-cut clause, not the Fed clause — it must cancel the bull hit
  // ("rate cut") without also cancelling the separate, real bearish "Fed turns hawkish" clause.
  desk.news_headlines = [
    { title: "Rate cut hopes dashed as Fed turns hawkish", published: "2026-07-04T17:00:00.000Z", tickers: [] },
  ];
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const newsFactor = result.factors.find((f) => f.label === "News risk");
  assert.ok(newsFactor, "the un-negated 'fed' bear hit must still fire");
  // -4 (bearHits=1, bullHits=0) only if "dashed" cancelled the rate-cut hit without ALSO
  // cancelling the Fed hit; an un-isolated window would double-cancel to -2 instead (or leave both
  // live at -2 the other way), so the exact magnitude is the discriminating assertion here.
  assert.equal(newsFactor!.weight, -4, `expected -4 (bear hit alone), got ${newsFactor?.weight}`);
  assert.match(newsFactor!.detail, /1 high-risk headline/i);
});

test("News risk factor: an averted-crash headline does not score bearish", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const desk = richDesk();
  desk.news_headlines = [
    { title: "Market crash averted as central banks step in", published: "2026-07-04T17:00:00.000Z", tickers: [] },
  ];
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const newsFactor = result.factors.find((f) => f.label === "News risk");
  assert.equal(newsFactor, undefined, "an averted crash must not score as a bearish headline");
});

// BUG FIX (2026-09-22): reclassifyConfluenceScore — spx-play-engine.ts's Night Hawk "morning
// prior" bonus used to mutate `confluence.score`/`confluence.factors` in place without ever
// re-deriving `grade`/`direction`/`agreeing`/`conflicts`, so a boundary-crossing bonus (bounded
// ±3 by getNhConfluenceBonus's own contract) left grade/direction stale relative to the mutated
// score — evaluatePlayGates and evaluateMtfHybrid both read confluence.grade/direction directly.
// This is the minimal desk fixture spx-play-conflicts.test.ts already uses for
// computeWeightedConflicts (which this function calls internally).
const reclassifyDesk = () =>
  ({
    price: 7400,
    market_open: true,
    tide_bias: "neutral",
    gamma_regime: "mean_revert",
    above_gamma_flip: true,
    gex_walls: [],
    news_headlines: [],
    vix: 16,
  }) as unknown as SpxDeskPayload;

test("reclassifyConfluenceScore: a bonus that crosses the A-grade threshold (58) upgrades grade, not just score", () => {
  const factors: SpxSignalFactor[] = [
    { label: "VWAP", weight: 20, detail: "above" },
    { label: "GEX support", weight: 20, detail: "at wall" },
    { label: "Live tape", weight: 17, detail: "bullish" },
  ];
  // Pre-bonus score 57 (abs 57, conflicts 0) grades "B" (needs >=58 for A).
  const preBonus = reclassifyConfluenceScore(reclassifyDesk(), 57, factors);
  assert.equal(preBonus.grade, "B");

  // Same factors + the Night Hawk prior factor pushed on top, score bumped +3 -> 60: must
  // reclassify to "A", not stay frozen at "B" the way the pre-fix code left it.
  const withBonus = [...factors, { label: "Night Hawk prior", weight: 3, detail: "NH edition bullish" }];
  const postBonus = reclassifyConfluenceScore(reclassifyDesk(), 60, withBonus);
  assert.equal(postBonus.grade, "A", "a +3 bonus crossing the 58 A-grade threshold must upgrade grade");
  assert.equal(postBonus.direction, "long");
  assert.equal(postBonus.agreeing, 4, "must count the newly-pushed Night Hawk prior factor too");
});

test("reclassifyConfluenceScore: a bonus that lifts abs score past 10 flips direction from null to non-null", () => {
  // Pre-bonus abs score 8 is below the |10| WAIT/HOLD boundary -> direction null.
  const factors: SpxSignalFactor[] = [{ label: "VWAP", weight: 8, detail: "above" }];
  const preBonus = reclassifyConfluenceScore(reclassifyDesk(), 8, factors);
  assert.equal(preBonus.direction, null);

  // +3 bonus -> 11, crosses into the HOLD band (abs >= 10) -> direction must become "long".
  const withBonus = [...factors, { label: "Night Hawk prior", weight: 3, detail: "NH edition bullish" }];
  const postBonus = reclassifyConfluenceScore(reclassifyDesk(), 11, withBonus);
  assert.equal(postBonus.direction, "long", "direction must not stay frozen at null once score crosses the HOLD threshold");
  assert.equal(postBonus.bias, "bullish");
});

// BUG FIX (2026-11-01): reclassifyConfluenceScore's return type omitted `levels`, so the Night
// Hawk prior mutation site in spx-play-engine.ts reassigned score/rawScore/bias/action/grade/
// direction/agreeing/conflicts/weighted_conflicts but never touched `confluence.levels`
// (entry/stop/target/invalidation) — those stayed frozen at whatever computeSpxConfluence built
// from the PRE-bonus bias/action. A bonus that flips action across a boundary (bounded ±3 by
// getNhConfluenceBonus's own contract — e.g. WAIT -> HOLD/bullish at the |10| boundary, the exact
// same boundary the "flips direction" test above exercises) therefore reclassifies direction
// correctly while still serving a stale/empty target built for the OLD (no-trade) action.
test("reclassifyConfluenceScore: a bonus that flips action also recomputes levels.target, not the stale pre-bonus value", () => {
  const desk = reclassifyDesk(); // price 7400, vix 16 -> playDynamicTargetPts(16) = 12
  // Pre-bonus: abs score 8 is below the |10| WAIT/HOLD boundary -> action WAIT -> no trade target.
  const factors: SpxSignalFactor[] = [{ label: "VWAP", weight: 8, detail: "above" }];
  const preBonus = reclassifyConfluenceScore(desk, 8, factors);
  assert.equal(preBonus.action, "WAIT");
  assert.equal(preBonus.levels.target, null, "WAIT action must not carry a trade target");

  // +3 bonus -> 11, crosses into the HOLD/bullish band -> buildLevels must be re-run against the
  // NEW action/bias, producing a real target (entry + dynamic target pts), not the stale
  // WAIT-era null the pre-fix code left behind.
  const withBonus = [...factors, { label: "Night Hawk prior", weight: 3, detail: "NH edition bullish" }];
  const postBonus = reclassifyConfluenceScore(desk, 11, withBonus);
  assert.equal(postBonus.action, "HOLD");
  assert.equal(postBonus.bias, "bullish");
  assert.equal(postBonus.levels.entry, 7400);
  assert.equal(
    postBonus.levels.target,
    7400 + 12,
    "levels.target must be recomputed from the post-bonus action/bias, not left stale at null"
  );
});

// BUG FIX (2026-10-18): reclassifyConfluenceScore's return type used to omit `rawScore`, so the
// Night Hawk prior mutation site in spx-play-engine.ts (the only caller) reassigned every OTHER
// derived field (score/bias/action/grade/direction/agreeing/conflicts/weighted_conflicts) but left
// `confluence.rawScore` frozen at the PRE-bonus value computeSpxConfluence produced — evaluated on
// the stale |score| and factors.length from before the "Night Hawk prior" factor was ever pushed.
// That stale number reaches members as "confidence" (spx-signal-log.ts) and outcome snapshots used
// for calibration (spx-play-outcomes.ts). This directly reproduces the mutation path end-to-end
// (build factors -> push the NH prior factor -> reclassify with the bumped score) and asserts
// rawScore reflects the POST-bonus score/factors.length, not the pre-bonus value.
test("reclassifyConfluenceScore: rawScore reflects the POST-bonus score/factors.length, not the frozen pre-bonus value", () => {
  const preFactors: SpxSignalFactor[] = [
    { label: "VWAP", weight: 20, detail: "above" },
    { label: "GEX support", weight: 20, detail: "at wall" },
    { label: "Live tape", weight: 17, detail: "bullish" },
  ];
  const preScore = 57; // abs 57, 3 factors
  const preRawScore = Math.round(Math.abs(preScore) * 1.15 + preFactors.length * 3); // 57*1.15 + 9 = 74.55 -> 75

  // Simulate the exact spx-play-engine.ts mutation path: push the Night Hawk prior factor onto
  // the SAME factors array, then reclassify with the bumped score.
  const nhBonus = 3;
  const postFactors = [...preFactors, { label: "Night Hawk prior", weight: nhBonus, detail: "NH edition bullish" }];
  const postScore = preScore + nhBonus; // 60
  const postRawScore = Math.round(Math.abs(postScore) * 1.15 + postFactors.length * 3); // 60*1.15 + 12 = 81

  // Sanity: the post-bonus rawScore must actually differ from the pre-bonus one, or this test
  // could pass vacuously even with the bug present (frozen-stale value == fresh value by accident).
  assert.notEqual(postRawScore, preRawScore, "fixture must exercise a case where rawScore actually changes across the bonus");

  const reclass = reclassifyConfluenceScore(reclassifyDesk(), postScore, postFactors);
  assert.equal(
    reclass.rawScore,
    postRawScore,
    `rawScore (${reclass.rawScore}) must be recomputed from the post-bonus score/factors.length (expected ${postRawScore}), not left at the pre-bonus value (${preRawScore})`
  );
  assert.notEqual(reclass.rawScore, preRawScore, "rawScore must not equal the stale pre-bonus value");
});

// REGRESSION (Ask Largo standing mandate, 2026-10-18): computeSpxConfluence's score/factors
// invariant — top-level `score` must equal the sum of every pushed `factors[].weight`, clamped to
// [-100, 100] — had drifted apart once before (the 2026-09-22 fix that introduced
// reclassifyConfluenceScore specifically to keep a post-hoc score mutation synced with its factor
// list), but no test asserted the invariant directly; the existing golden-fixture snapshot test
// above only encodes it implicitly, for one single (already-clamped) data point. `rawScore` is a
// DIFFERENT, intentionally separate confidence metric (clamp(round(|score|*1.15 +
// factors.length*3), 0, 96)) and must never be confused with this invariant — a bug that made
// `score` drift from `sum(factors[].weight)` would NOT show up as a `rawScore` mismatch.
test("computeSpxConfluence: score always equals clamp(sum(factors[].weight), -100, 100) — clamped case (golden fixture)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  const result = computeSpxConfluence(richDesk());
  assert.ok(result);
  const rawSum = result.factors.reduce((s, f) => s + f.weight, 0);
  const expected = Math.max(-100, Math.min(100, rawSum));
  assert.equal(result.score, expected, `score (${result.score}) must equal clamp(sum(weights)=${rawSum}, -100, 100)=${expected}`);
  // The golden fixture is deliberately in the CLAMPED regime (raw sum 154 > 100) — assert that
  // explicitly so this test can't silently stop exercising the clamp path if the fixture changes.
  assert.ok(rawSum > 100, "this fixture must exercise the clamp path (raw sum > 100) — if it no longer does, add an explicit clamped-case fixture instead of only testing the unclamped case below");
});

test("computeSpxConfluence: score always equals clamp(sum(factors[].weight), -100, 100) — unclamped case (sparse fixture)", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-07-04T18:00:00.000Z") });
  // A sparse desk that fires only a few small-weight factors, so the raw sum stays well inside
  // [-100, 100] and the clamp never engages — proves the invariant holds in the ORDINARY regime
  // too, not just the saturated one the golden fixture happens to hit.
  const desk = richDesk();
  desk.gamma_flip = null; // drop γ regime (+10)
  desk.flow_0dte_net = null; // drop 0DTE flow (+14)
  desk.tide_bias = "neutral"; // drop Market tide (+10)
  desk.spx_flows = []; // drop HELIX sweeps (+15)
  desk.unified_tape = []; // drop Live tape (+12)
  desk.net_prem_ticks = []; // drop Net prem (+6)
  desk.strike_stacks = []; // drop Strike stack (+3)
  desk.news_headlines = []; // drop News risk (+3)
  desk.leader_stocks = []; // drop Mega-caps (+6)
  const result = computeSpxConfluence(desk);
  assert.ok(result);
  const rawSum = result.factors.reduce((s, f) => s + f.weight, 0);
  assert.ok(Math.abs(rawSum) < 100, `this fixture must stay inside the unclamped range, got raw sum ${rawSum}`);
  assert.equal(result.score, rawSum, `unclamped: score (${result.score}) must equal the raw factor-weight sum (${rawSum}) exactly, with no clamp distortion`);
});
