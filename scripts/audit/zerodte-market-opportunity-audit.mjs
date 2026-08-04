/**
 * 0DTE MARKET OPPORTUNITY AUDIT — "how tight are we vs what the tape offered?"
 *
 * Pulls REAL UW flow + Polygon grouped-daily for a session and runs the production
 * discovery funnels (FLOW deriveZeroDteSetups, BREAKOUT screen + chain-walk sample,
 * PIN universe regime check) WITHOUT committing. Reports where candidates die.
 *
 * Usage:
 *   node --import tsx scripts/audit/zerodte-market-opportunity-audit.mjs --date=2026-08-03
 *   node --import tsx scripts/audit/zerodte-market-opportunity-audit.mjs --date=2026-08-03 --json
 *
 * Secrets: UW_API_KEY, POLYGON_API_KEY (env only).
 */

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const SESSION = argv.date && argv.date !== "true" ? String(argv.date).slice(0, 10) : null;
const EMIT_JSON = Boolean(argv.json);

if (!SESSION || !/^\d{4}-\d{2}-\d{2}$/.test(SESSION)) {
  console.error("Usage: --date=YYYY-MM-DD");
  process.exit(1);
}

const SRC = new URL("../../src/", import.meta.url).pathname;

const {
  deriveZeroDteSetups,
  SETUP_MIN_GROSS,
  SETUP_MIN_DOMINANCE,
  SETUP_MIN_AGGR_SHARE,
} = await import(`${SRC}lib/zerodte/board.ts`);
const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { fetchDailyMarketSummary } = await import(`${SRC}lib/providers/polygon.ts`);
const { screenBreakoutMovers, screenBreakdownMovers } = await import(
  `${SRC}features/nighthawk/lib/candidates.ts`
);
const { rankMoversForChainFetch, BREAKOUT_MAX_CANDIDATES, BREAKOUT_SCREEN_POOL } = await import(
  `${SRC}lib/zerodte/breakout-discovery.ts`
);
const { resolveTickerChainRows } = await import(
  `${SRC}features/nighthawk/lib/option-chain-prompt.ts`
);
const { pickBreakoutContractWithFallback } = await import(`${SRC}lib/zerodte/breakout-source.ts`);
const { classifyRegime } = await import(`${SRC}lib/zerodte/regime.ts`);
const { buildMarketState } = await import(`${SRC}lib/zerodte/market-state-engine.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

/** ET session bounds as ISO for UW newer_than / older_than (Aug 3 2026 RTH). */
function sessionBoundsEt(ymd) {
  // 09:30–16:00 ET on session date
  const open = `${ymd}T09:30:00-04:00`;
  const close = `${ymd}T16:15:00-04:00`;
  return { open, close };
}

function calendarDte(sessionYmd, expiryYmd) {
  if (!expiryYmd) return null;
  const a = Date.parse(`${sessionYmd}T12:00:00Z`);
  const b = Date.parse(`${expiryYmd.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function flowToSetupInput(row, sessionYmd) {
  const f = row.flow ?? row;
  const expiry = (f.expiry ?? "").slice(0, 10);
  return {
    ticker: f.ticker,
    premium: f.premium,
    option_type: f.option_type,
    strike: f.strike,
    expiry,
    dte: f.dte ?? calendarDte(sessionYmd, expiry),
    alert_rule: f.alert_rule,
    ask_pct: f.ask_pct ?? f.ask_side_pct ?? null,
    underlying_price: f.underlying_price,
    fill_price: f.fill_price,
    open_interest: f.open_interest,
    alerted_at: f.alerted_at ?? f.created_at,
  };
}

async function auditFlow(session) {
  const { open, close } = sessionBoundsEt(session);
  const rejections = [];
  const rows = await fetchMarketFlowAlertRows({
    limit: 450,
    min_premium: 50_000,
    newer_than: open,
    older_than: close,
  });
  const inputs = rows.map((r) => flowToSetupInput(r, session)).filter((r) => r.ticker && r.premium > 0);
  const setups48 = deriveZeroDteSetups(inputs, {
    maxSetups: 48,
    todayYmd: session,
    rejections,
    nowMs: Date.parse(close),
  });
  const setups12 = deriveZeroDteSetups(inputs, { maxSetups: 12, todayYmd: session, nowMs: Date.parse(close) });

  const byGate = {};
  for (const r of rejections) {
    byGate[r.gate_failed] = (byGate[r.gate_failed] ?? 0) + 1;
  }

  const withDte01 = inputs.filter((r) => r.dte != null && r.dte >= 0 && r.dte <= 1).length;
  const withExpiry = inputs.filter((r) => r.expiry).length;

  return {
    raw_prints: inputs.length,
    unique_tickers: new Set(inputs.map((r) => r.ticker.toUpperCase())).size,
    prints_with_expiry: withExpiry,
    prints_dte_0_1: withDte01,
    candidates_cap48: setups48.length,
    candidates_cap12: setups12.length,
    top48: setups48.slice(0, 15).map((s) => ({
      ticker: s.ticker,
      direction: s.direction,
      score: s.score,
      gross: Math.round(s.gross_premium),
    })),
    rejections_by_gate: byGate,
    thresholds: {
      min_gross: SETUP_MIN_GROSS,
      min_dominance: SETUP_MIN_DOMINANCE,
      min_aggr_share: SETUP_MIN_AGGR_SHARE,
    },
  };
}

async function auditBreakout(session) {
  const summary = await fetchDailyMarketSummary(session);
  const bars = summary?.results ?? summary ?? [];
  if (!Array.isArray(bars) || bars.length === 0) {
    return { status: "no_breadth", movers_long: 0, movers_short: 0, chain_ok: 0, chain_miss: {} };
  }

  const longMovers = screenBreakoutMovers(bars, BREAKOUT_SCREEN_POOL);
  const shortMovers = screenBreakdownMovers(bars, BREAKOUT_SCREEN_POOL);
  const rankedLong = rankMoversForChainFetch(longMovers, Math.min(BREAKOUT_MAX_CANDIDATES * 4, 60), "long");
  const rankedShort = rankMoversForChainFetch(shortMovers, Math.min(BREAKOUT_MAX_CANDIDATES * 4, 60), "short");

  const stats = { attempted: 0, no_chain: 0, no_same_day_contract: 0, built: 0 };
  const built = [];

  async function walk(movers, direction) {
    for (const m of movers.slice(0, 40)) {
      stats.attempted += 1;
      try {
        const chain = await resolveTickerChainRows(m.ticker).catch(() => null);
        if (!chain || !(chain.spot > 0) || !chain.rows?.length) {
          stats.no_chain += 1;
          continue;
        }
        const rows = chain.rows.map((r) => ({
          expiry: r.expiry,
          strike: r.strike,
          call_bid: r.call_bid,
          call_ask: r.call_ask,
          call_oi: r.call_oi,
          put_bid: r.put_bid,
          put_ask: r.put_ask,
          put_oi: r.put_oi,
        }));
        const side = direction === "long" ? "call" : "put";
        const contract = pickBreakoutContractWithFallback(rows, chain.spot, session, side);
        if (!contract) {
          stats.no_same_day_contract += 1;
          continue;
        }
        stats.built += 1;
        built.push({ ticker: m.ticker, direction, gain: Math.round(m.gain * 10) / 10, dollar_m: Math.round(m.dollar / 1e6) });
        if (built.length >= 10) break;
      } catch {
        stats.no_chain += 1;
      }
    }
  }

  await walk(rankedLong, "long");
  await walk(rankedShort, "short");

  return {
    status: "ok",
    breadth_rows: bars.length,
    movers_long: longMovers.length,
    movers_short: shortMovers.length,
    chain_stats: stats,
    sample_built: built,
  };
}

async function auditPin(session) {
  return { skipped: true, reason: "PIN audit requires Next server graph — use prod CloudWatch rail mix" };
}

function priorSessionYmd(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function auditRegime(session) {
  const prior = priorSessionYmd(session);
  const bars = await fetchAggBars("SPY", session, session, 5).catch(() => []);
  const priorBars = await fetchAggBars("SPY", prior, prior, 5).catch(() => []);
  if (!bars.length) return { regime: null, market_state: null };

  const open = bars[0].o ?? bars[0].open;
  const last = bars[bars.length - 1].c ?? bars[bars.length - 1].close;
  const high = Math.max(...bars.map((b) => b.h ?? b.high ?? 0));
  const low = Math.min(...bars.map((b) => b.l ?? b.low ?? Infinity));
  const vwap =
    bars.reduce((s, b) => s + (b.vw ?? b.vwap ?? b.c ?? 0) * (b.v ?? b.volume ?? 0), 0) /
    Math.max(1, bars.reduce((s, b) => s + (b.v ?? b.volume ?? 0), 0));
  const prev = priorBars[priorBars.length - 1];
  const prevClose = prev?.c ?? prev?.close ?? open;
  const prevHigh = prev?.h ?? prev?.high ?? prevClose;
  const prevLow = prev?.l ?? prev?.low ?? prevClose;
  const atr = Math.max(high - low, 0.5);

  const regime = classifyRegime({
    open,
    last,
    high,
    low,
    prevClose,
    prevHigh,
    prevLow,
    vwap,
    atr,
    vix: 16,
    dateYmd: session,
  });
  const marketState = buildMarketState({ regime, sessionDate: session });
  return { regime: { structure: regime.structure, vol: regime.vol, label: regime.label }, market_state: marketState };
}

console.log(`\n${"═".repeat(88)}`);
console.log(`  0DTE MARKET OPPORTUNITY AUDIT — session ${SESSION}`);
console.log(`${"═".repeat(88)}\n`);

const [flow, breakout, pin, regimeBlock] = await Promise.all([
  auditFlow(SESSION),
  auditBreakout(SESSION),
  auditPin(SESSION),
  auditRegime(SESSION),
]);

const report = {
  session: SESSION,
  flow,
  breakout,
  pin,
  regime: regimeBlock,
  verdict: {
    flow_tight:
      flow.candidates_cap48 < 15
        ? "LIKELY_TIGHT — UW tape offered limited same-day FLOW qualifiers"
        : "OK",
    breakout_bottleneck:
      breakout.chain_stats?.no_same_day_contract > breakout.chain_stats?.built * 3
        ? "CHAIN_WALK — momentum names often lack listed 0DTE contracts"
        : "OK",
    pin_day: pin.clean_pins === 0 ? "NO_PIN_REGIME — expected on trend/chop days" : "PINS_AVAILABLE",
    recommended_actions: [],
  },
};

if (flow.candidates_cap48 < 12) {
  report.verdict.recommended_actions.push("FLOW: verify min_gross/dominance; market-state may boost FLOW weight on trend days");
}
if (breakout.chain_stats?.no_same_day_contract > 50) {
  report.verdict.recommended_actions.push("BREAKOUT: expand chain-walk budget or allow 1DTE when 0DTE absent (calibrated)");
}
if (regimeBlock.market_state?.rail_weights?.FLOW > 1) {
  report.verdict.recommended_actions.push(
    `MARKET_STATE: ${regimeBlock.regime?.structure} day → FLOW weight ${regimeBlock.market_state.rail_weights.FLOW}`
  );
}

if (EMIT_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("[FLOW] UW session prints:", flow.raw_prints, "· tickers:", flow.unique_tickers);
  console.log("       Candidates (cap 48):", flow.candidates_cap48, "· (legacy cap 12):", flow.candidates_cap12);
  console.log("       Rejections:", flow.rejections_by_gate);
  console.log("       Top:", flow.top48.map((t) => `${t.ticker}(${t.score})`).join(", ") || "—");
  console.log("\n[BREAKOUT] Breadth rows:", breakout.breadth_rows ?? 0);
  console.log("           Movers L/S:", breakout.movers_long, "/", breakout.movers_short);
  console.log("           Chain walk:", breakout.chain_stats);
  console.log("           Built sample:", breakout.sample_built?.map((b) => b.ticker).join(", ") || "—");
  console.log("\n[PIN]", pin.skipped ? pin.reason : `eval ${pin.universe_size} · pins ${pin.clean_pins}`);
  if (pin?.hits?.length) console.log("      Hits:", pin.hits.map((h) => h.ticker).join(", "));
  console.log("\n[REGIME]", regimeBlock.regime?.label ?? "unknown");
  if (regimeBlock.market_state) {
    console.log("         Rail weights:", regimeBlock.market_state.rail_weights);
    console.log("         Confidence:", regimeBlock.market_state.confidence);
  }
  console.log("\n[VERDICT]", report.verdict);
  console.log(`\n${"═".repeat(88)}\n`);
}

process.exit(0);
