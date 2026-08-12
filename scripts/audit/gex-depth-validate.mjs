/**
 * SYNTHETIC ORDER BOOK — live validation harness.
 *
 * Runs the REAL `buildGexDepthLadder` against REAL Polygon chains and checks it against the levels
 * production actually serves. Built BEFORE the view, on the principle that a visualization of a
 * number nobody has checked is worse than no visualization: if the ladder cannot reproduce the net
 * GEX and the walls the matrix already publishes, it is describing a different book than the one
 * drawn beside it and is not worth rendering.
 *
 * Two independent routes to one number are what makes this evidence rather than assertion:
 *   - the matrix sums the PROVIDER's per-contract gamma
 *   - the ladder recomputes gamma from closed-form Black-Scholes using the provider's IV
 * Agreement means both the greeks and the sign convention line up. Disagreement localises the bug.
 *
 * Read-only. Polygon only — no UW, no DB, no Clerk, no writes.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY NODE_USE_ENV_PROXY=1 \
 *     node --import tsx scripts/audit/gex-depth-validate.mjs [--tickers=SPY,NVDA] [--json]
 */
import { buildGexDepthLadder, netDollarGammaAt } from "../../src/lib/gex-depth.ts";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const asJson = args.includes("--json");

const KEY = process.env.POLYGON_API_KEY;
// Self-default the base the same way every other audit script does — the shared-env ref does not
// resolve in this sandbox and an unresolved literal throws an unhelpful ERR_INVALID_URL.
const RAW_BASE = process.env.POLYGON_API_BASE;
const BASE = /^https?:/.test(RAW_BASE ?? "") ? RAW_BASE : "https://api.massive.com";

const TICKERS = flag("tickers", "SPY,QQQ,NVDA,TSLA,ASTS").split(",").map((t) => t.trim()).filter(Boolean);
/** Mirrors NEAR_TERM_EXPIRY_COUNT in polygon-options-gex.ts — the walls are near-term only, so the
 *  ladder must be scoped identically or the comparison is meaningless. */
const NEAR_TERM_EXPIRY_COUNT = 8;

if (!KEY) {
  console.error("POLYGON_API_KEY missing — cannot validate against live chains.");
  process.exit(2);
}

const todayEt = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

async function fetchChain(ticker) {
  const out = [];
  let page = await getJson(`${BASE}/v3/snapshot/options/${ticker}?limit=250&apiKey=${KEY}`);
  let guard = 0;
  while (page && guard < 12) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await getJson(`${page.next_url}&apiKey=${KEY}`);
    guard += 1;
  }
  return out;
}

async function fetchSpot(ticker) {
  // An INDEX is not on the stocks snapshot endpoint. Asking for SPX there returns nothing, which
  // the harness then reported as a hard FAIL — a harness gap dressed up as a product defect, which
  // is exactly the failure mode the rest of this file exists to avoid.
  if (ticker === "SPX" || ticker.startsWith("I:")) {
    const sym = ticker.startsWith("I:") ? ticker : `I:${ticker}`;
    const j = await getJson(`${BASE}/v3/snapshot/indices?ticker.any_of=${encodeURIComponent(sym)}&apiKey=${KEY}`);
    const px = j?.results?.[0]?.value ?? j?.results?.[0]?.session?.close;
    return Number.isFinite(px) && px > 0 ? px : 0;
  }
  const j = await getJson(`${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${KEY}`);
  const t = j?.ticker;
  const px = t?.lastTrade?.p ?? t?.day?.c ?? t?.prevDay?.c;
  return Number.isFinite(px) && px > 0 ? px : 0;
}

/** The matrix's own math, reproduced exactly: dealer sign × provider gamma × OI × shares × S² × 0.01. */
function providerNetGex(contracts, spot, today, keepExpiries) {
  let total = 0;
  const perStrike = new Map();
  for (const c of contracts) {
    const strike = Number(c.details?.strike_price);
    const expiry = String(c.details?.expiration_date ?? "").slice(0, 10);
    const type = String(c.details?.contract_type ?? "").toLowerCase();
    const gamma = Number(c.greeks?.gamma ?? 0);
    const oi = Number(c.open_interest ?? 0);
    if (!(strike > 0) || !expiry || expiry < today || !oi || !gamma) continue;
    if (keepExpiries && !keepExpiries.has(expiry)) continue;
    const sign = type === "call" ? 1 : type === "put" ? -1 : 0;
    if (!sign) continue;
    const shares =
      Number.isFinite(c.details?.shares_per_contract) && (c.details?.shares_per_contract ?? 0) > 0
        ? Number(c.details.shares_per_contract)
        : 100;
    const v = sign * gamma * oi * shares * spot * spot * 0.01;
    total += v;
    perStrike.set(strike, (perStrike.get(strike) ?? 0) + v);
  }
  return { total, perStrike };
}

function wallsFrom(perStrike) {
  let callWall = null;
  let putWall = null;
  let maxPos = 0;
  let maxNeg = 0;
  for (const [strike, g] of perStrike) {
    if (g > maxPos) { maxPos = g; callWall = strike; }
    if (g < maxNeg) { maxNeg = g; putWall = strike; }
  }
  return { callWall, putWall };
}

const money = (n) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};

const results = [];
let worst = "PASS";
const bump = (v) => {
  const rank = { PASS: 0, WARN: 1, FAIL: 2 };
  if (rank[v] > rank[worst]) worst = v;
};

const today = todayEt();

for (const ticker of TICKERS) {
  const optionsRoot = ticker === "SPX" ? "I:SPX" : ticker;
  const [rawChain, spot] = await Promise.all([fetchChain(optionsRoot), fetchSpot(ticker)]);
  if (!spot || rawChain.length === 0) {
    results.push({ ticker, verdict: "FAIL", reason: `no ${!spot ? "spot" : "chain"}` });
    bump("FAIL");
    continue;
  }

  // Near-term expiry axis, exactly as the matrix scopes its structural levels.
  const liveExpiries = [...new Set(
    rawChain
      .map((c) => String(c.details?.expiration_date ?? "").slice(0, 10))
      .filter((e) => e && e >= today)
  )].sort();
  const keep = new Set(liveExpiries.slice(0, NEAR_TERM_EXPIRY_COUNT));

  const contracts = rawChain
    .map((c) => ({
      strike: Number(c.details?.strike_price),
      expiry: String(c.details?.expiration_date ?? "").slice(0, 10),
      type: String(c.details?.contract_type ?? "").toLowerCase(),
      openInterest: Number(c.open_interest ?? 0),
      iv: Number(c.implied_volatility ?? 0),
      sharesPerContract: Number(c.details?.shares_per_contract ?? 100),
    }))
    .filter((c) => c.strike > 0 && c.expiry && (c.type === "call" || c.type === "put"));

  const prov = providerNetGex(rawChain, spot, today, keep);
  const { callWall, putWall } = wallsFrom(prov.perStrike);

  const t0 = Date.now();
  const ladder = buildGexDepthLadder(contracts, spot, {
    todayYmd: today,
    expiries: keep,
    rangePct: 0.08,
    stepPct: 0.005,
    anchorNetGamma: prov.total,
  });
  const ms = Date.now() - t0;

  // ── Check 1: does our Black-Scholes gamma reproduce the provider's? ──────────────────────
  // Measured RAW, before the anchor is applied — anchoring makes the two agree by construction, so
  // comparing post-anchor would be a tautology that reports PASS no matter how wrong the model is.
  const rawSpotGamma = netDollarGammaAt(contracts, spot, today, keep);
  const denom = Math.max(Math.abs(prov.total), Math.abs(rawSpotGamma), 1);
  const gexDiffPct = (Math.abs(rawSpotGamma - prov.total) / denom) * 100;
  const sameSign = (rawSpotGamma >= 0) === (prov.total >= 0);
  let gexVerdict = "PASS";
  if (!sameSign) gexVerdict = "FAIL";
  else if (gexDiffPct > 25) gexVerdict = "WARN";
  bump(gexVerdict);

  // Post-anchor the headline MUST match the matrix exactly, or the ladder and the number printed
  // beside it disagree on screen.
  const anchored = Math.abs(ladder.netGammaAtSpot - prov.total) <= Math.abs(prov.total) * 1e-9 + 1;
  if (!anchored && ladder.calibrationFactor !== 1) bump("FAIL");

  // ── Check 2: are the ladder's two independent outputs internally consistent? ─────────────
  //
  // TWO EARLIER VERSIONS OF THIS CHECK WERE WRONG, both the same way, and it is worth recording
  // because it is the easiest mistake to make with this data. First it asserted the peak forced-SELL
  // band lands ON the call wall; then that net book gamma is negative AT the put wall. Both conflate
  // a PER-STRIKE quantity (a wall is the strike with the largest per-strike gamma) with a
  // WHOLE-BOOK one (the ladder reprices every contract at a hypothetical spot). A book that is
  // heavily net-long gamma has positive total gamma even at its put wall — as SPY, NVDA and TSLA all
  // do right now. There is no invariant linking the two, so asserting one just produces noise.
  //
  // What IS invariant is that the ladder must agree WITH ITSELF. `shares` comes from differencing
  // dealer DELTA across a band; `gamma` comes from summing closed-form GAMMA at a price. They are
  // computed independently, and calculus requires them to line up: where gamma is positive, moving
  // up must force selling and moving down must force buying. A sign error in either one breaks this
  // immediately, on real chains, which is exactly what a live harness should catch.
  let dirMismatches = 0;
  let dirChecked = 0;
  for (const l of ladder.levels) {
    if (l.direction === "flat" || l.gamma === 0) continue;
    if (Math.abs(l.notional) < ladder.maxAbsNotional * 0.02) continue; // ignore dust bands
    dirChecked++;
    const above = l.price > spot;
    const longGamma = l.gamma > 0;
    // long gamma: sell above / buy below.  short gamma: buy above / sell below.
    const expected = longGamma === above ? "sell" : "buy";
    if (l.direction !== expected) dirMismatches++;
  }
  const wallVerdict = dirMismatches === 0 ? "PASS" : "FAIL";
  bump(wallVerdict);

  // Informational only — see above for why these are NOT asserted.
  const gAtCallWall = callWall != null ? netDollarGammaAt(contracts, callWall, today, keep) : null;
  const gAtPutWall = putWall != null ? netDollarGammaAt(contracts, putWall, today, keep) : null;
  const peakSellDist = callWall != null && ladder.peakSell != null ? Math.abs(ladder.peakSell - callWall) : null;
  const peakBuyDist = putWall != null && ladder.peakBuy != null ? Math.abs(ladder.peakBuy - putWall) : null;

  // ── Check 3: internal coherence — cumulative must be the running sum of marginals ────────
  let coherent = true;
  for (const side of [1, -1]) {
    const rows = ladder.levels
      .filter((l) => (side > 0 ? l.price > spot : l.price < spot))
      .sort((a, b) => (side > 0 ? a.price - b.price : b.price - a.price));
    let run = 0;
    for (const r of rows) {
      run += r.notional;
      if (Math.abs(run - r.cumulative) > Math.abs(run) * 1e-9 + 1e-6) coherent = false;
    }
  }
  if (!coherent) bump("FAIL");

  const above = ladder.levels.filter((l) => l.price > spot).reduce((s, l) => s + l.notional, 0);
  const below = ladder.levels.filter((l) => l.price < spot).reduce((s, l) => s + l.notional, 0);

  const row = {
    ticker,
    spot: Number(spot.toFixed(2)),
    contracts: ladder.contractsUsed,
    ms,
    netGexProvider: prov.total,
    netGexLadder: ladder.netGammaAtSpot,
    gexDiffPct: Number(gexDiffPct.toFixed(1)),
    gexVerdict,
    callWall,
    peakSell: ladder.peakSell,
    putWall,
    peakBuy: ladder.peakBuy,
    wallVerdict,
    dirChecked,
    dirMismatches,
    calibrationFactor: Number(ladder.calibrationFactor.toFixed(4)),
    gAtCallWall,
    gAtPutWall,
    peakSellDist,
    peakBuyDist,
    crossing: ladder.crossing,
    coherent,
    forcedAbove: above,
    forcedBelow: below,
  };
  results.push(row);

  if (!asJson) {
    console.log(`\n═══ ${ticker}  spot ${row.spot}  ·  ${row.contracts} contracts  ·  ladder built in ${ms}ms`);
    console.log(`  net GEX   provider ${money(prov.total).padStart(9)}   ladder(raw) ${money(rawSpotGamma).padStart(9)}   raw diff ${row.gexDiffPct}%   [${gexVerdict}]`);
    console.log(`  anchor    x${ladder.calibrationFactor.toFixed(3)}  ->  ladder ${money(ladder.netGammaAtSpot).padStart(9)}   matches matrix: ${anchored}`);
    console.log(`  flow/gamma coherence: ${dirChecked - dirMismatches}/${dirChecked} bands agree   [${wallVerdict}]`);
    console.log(`  (info) call wall ${callWall} vs peak SELL ${ladder.peakSell?.toFixed(2)} · put wall ${putWall} vs peak BUY ${ladder.peakBuy?.toFixed(2)} — different quantities, not asserted`);
    console.log(`  regime crossing ${ladder.crossing ?? "none (single regime)"}`);
    console.log(`  forced flow: ${money(above)} above spot · ${money(below)} below spot   cumulative-coherent: ${coherent}`);
    // A compact ladder so the shape is visible, not just asserted.
    const shown = ladder.levels.filter((_, i) => i % 2 === 0);
    const scale = ladder.maxAbsNotional || 1;
    console.log("  ── ladder ──");
    for (const l of [...shown].reverse()) {
      const w = Math.round((Math.abs(l.notional) / scale) * 24);
      const bar = l.direction === "buy" ? "▐".repeat(w).padStart(26) : "".padStart(26) ;
      const bar2 = l.direction === "sell" ? "▌".repeat(w) : "";
      const mark = Math.abs(l.price - spot) < spot * 0.0026 ? " ← spot" : "";
      console.log(`  ${l.price.toFixed(2).padStart(9)} ${bar}│${bar2.padEnd(26)} ${money(l.notional).padStart(9)} ${l.direction}${mark}`);
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ worst, today, results }, null, 2));
} else {
  console.log(`\n${"═".repeat(72)}\nWORST VERDICT: ${worst}`);
}
process.exit(worst === "FAIL" ? 1 : 0);
