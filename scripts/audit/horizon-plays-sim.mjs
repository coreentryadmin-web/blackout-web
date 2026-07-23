/**
 * Night Hawk 3-horizon engine — END-TO-END live harness (remodel slice 4).
 *
 * Proves the shipped engine core (horizons.ts → horizon-fanout.ts → horizon-plays.ts) against REAL data:
 *   1. Screen the WHOLE market (Polygon grouped-daily, ~12k tickers) for movers, + always include the
 *      0DTE-anchor index/ETFs (SPY/QQQ/IWM) so the same-day lane has same-day-expiry names to show.
 *   2. For each candidate, fetch its FULL option chain (all expiries in an ATM±band) from Polygon.
 *   3. Feed it through the SHIPPED produceHorizonPlays() → three lanes (0DTE / Swing / LEAPS), each
 *      play stamped COMMIT (score ≥ lane floor) / WATCH.
 *   4. Print the lanes. This is "8,000 tickers → 0DTE + Swing + LEAPS plays" running for real.
 *
 * SCORING NOTE: the conviction score here is a PLACEHOLDER proxy off breakout strength — the real
 * unified scorer is a later slice. This harness proves the PLUMBING (discovery → chain → fan-out →
 * lanes), not the alpha. Run: POLYGON_API_BASE=https://api.massive.com node --import tsx scripts/audit/horizon-plays-sim.mjs
 * Flags: --top=N (movers, default 12) --band=0.18 (chain strike band) --date=YYYY-MM-DD (grouped session)
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const BASE = process.env.POLYGON_API_BASE;
const KEY = process.env.POLYGON_API_KEY;
if (!KEY) { console.error("FATAL: POLYGON_API_KEY not set"); process.exit(3); }

const SRC = new URL("../../src/", import.meta.url).pathname;
const { produceHorizonPlays } = await import(`${SRC}lib/horizon-plays.ts`);
const { HORIZONS, HORIZON_ORDER } = await import(`${SRC}lib/horizons.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=?(.*)$/.exec(a);
    return m ? [m[1], m[2] === "" ? true : m[2]] : [a, true];
  }),
);
const TOP = Number(argv.top) || 12;
const BAND = Number(argv.band) || 0.18;
const ANCHORS = ["SPY", "QQQ", "IWM"]; // always-present 0DTE-eligible daily-expiry names
const PRICE_MIN = 5, PRICE_MAX = 400, MIN_VOL = 1_000_000, MIN_GAIN = 0.05;

const jget = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
const etYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Placeholder conviction proxy off breakout strength (0-100). Real unified scorer is a later slice. */
function proxyScore({ gain = 0, closeStrength = 0.5, anchor = false }) {
  if (anchor) return 68; // index anchors: neutral-committable so the 0DTE lane demonstrates commits
  return clamp(Math.round(45 + gain * 300 + closeStrength * 15), 0, 100);
}

/** Resolve a spot price for a ticker (stocks snapshot). */
async function spotOf(ticker) {
  const s = await jget(`${BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${KEY}`);
  return s?.ticker?.lastTrade?.p ?? s?.ticker?.day?.c ?? s?.ticker?.prevDay?.c ?? null;
}

/** Fetch the full option chain (all expiries) in an ATM±band for a name. Returns Polygon snapshot contracts. */
async function fetchChain(ticker, spot) {
  const lo = Math.floor(spot * (1 - BAND)), hi = Math.ceil(spot * (1 + BAND));
  const root = ticker === "SPX" ? "I:SPX" : ticker;
  const out = [];
  let url = `${BASE}/v3/snapshot/options/${root}?strike_price.gte=${lo}&strike_price.lte=${hi}&limit=250&apiKey=${KEY}`;
  let guard = 0;
  while (url && guard < 6) {
    const page = await jget(url);
    if (!page) break;
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    url = page.next_url.includes("apiKey=") ? page.next_url : `${page.next_url}&apiKey=${KEY}`;
    guard += 1;
  }
  return out;
}

/** Map Polygon per-contract snapshots → the engine's ChainStrikeRow[] (call+put grouped per strike×expiry). */
function polyToChainRows(contracts) {
  const byKey = new Map();
  for (const c of contracts) {
    const strike = c.details?.strike_price, expiry = c.details?.expiration_date, type = c.details?.contract_type;
    if (!(strike > 0) || !expiry || !type) continue;
    const key = `${expiry}|${strike}`;
    let row = byKey.get(key);
    if (!row) { row = { expiry, strike, call_bid: null, call_ask: null, call_delta: null, call_oi: 0, put_bid: null, put_ask: null, put_delta: null, put_oi: 0 }; byKey.set(key, row); }
    const bid = c.last_quote?.bid ?? null, ask = c.last_quote?.ask ?? null, delta = c.greeks?.delta ?? null, oi = c.open_interest ?? 0;
    if (type === "call") { row.call_bid = bid; row.call_ask = ask; row.call_delta = delta; row.call_oi = oi; }
    else if (type === "put") { row.put_bid = bid; row.put_ask = ask; row.put_delta = delta; row.put_oi = oi; }
  }
  return [...byKey.values()];
}

// ── MAIN ────────────────────────────────────────────────────────────────────
const asOf = argv.date && argv.date !== true ? String(argv.date) : etYmd();
console.log(`\n${"═".repeat(96)}`);
console.log(`  NIGHT HAWK 3-HORIZON ENGINE — LIVE END-TO-END (slice 4)  ·  as-of ${asOf}`);
console.log(`  windows: 0DTE ${HORIZONS.ZERO_DTE.dteMin}-${HORIZONS.ZERO_DTE.dteMax} · Swing ${HORIZONS.SWING.dteMin}-${HORIZONS.SWING.dteMax} · LEAPS ${HORIZONS.LEAPS.dteMin}-${HORIZONS.LEAPS.dteMax} DTE`);
console.log(`${"═".repeat(96)}`);

// 1. whole-market screen
const grouped = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${asOf}?adjusted=true&apiKey=${KEY}`);
if (!grouped?.results?.length) { console.error(`No grouped data for ${asOf} (market closed?). Try --date=<trading day>.`); process.exit(1); }
const movers = grouped.results
  .filter((x) => x.c >= PRICE_MIN && x.c <= PRICE_MAX && x.v >= MIN_VOL && (x.c - x.o) / x.o >= MIN_GAIN && (x.h - x.c) / Math.max(1e-9, x.h - x.l) <= 0.5)
  .map((x) => ({ ticker: x.T, spot: x.c, gain: (x.c - x.o) / x.o, closeStrength: (x.c - x.l) / Math.max(1e-9, x.h - x.l), dollar: x.v * x.c, anchor: false }))
  .sort((a, b) => b.dollar - a.dollar)
  .slice(0, TOP);
console.log(`  screened ${grouped.results.length} stocks → ${movers.length} movers (gain ≥5%, $-vol ranked) + ${ANCHORS.length} index anchors\n`);

// 2. build candidate list (movers + anchors), fetch spot for anchors, fetch chains for all
const anchorCands = [];
for (const t of ANCHORS) { const sp = await spotOf(t); if (sp > 0) anchorCands.push({ ticker: t, spot: sp, anchor: true, gain: 0, closeStrength: 0.5 }); }
const raw = [...anchorCands, ...movers];

const candidates = [];
for (const m of raw) {
  const contracts = await fetchChain(m.ticker, m.spot);
  const chainRows = polyToChainRows(contracts);
  candidates.push({
    ticker: m.ticker,
    direction: "LONG", // breakout movers + anchors → calls; real direction logic is discovery's job (later slice)
    score: proxyScore(m),
    asOfYmd: asOf,
    chainRows,
    _spot: m.spot,
    _chainCount: chainRows.length,
  });
}

// 3. run the SHIPPED engine
const set = produceHorizonPlays(candidates);

// 4. print the three lanes
const fmtPlay = (p) => `${p.status === "COMMIT" ? "✅" : "·"} ${p.ticker.padEnd(6)} ${p.direction} score ${String(p.score).padStart(3)} [${p.status}]  ${p.reason}`;
for (const h of HORIZON_ORDER) {
  const lane = set[h];
  const committed = lane.filter((p) => p.status === "COMMIT").length;
  console.log(`\n${"─".repeat(96)}`);
  console.log(`  ${HORIZONS[h].label.toUpperCase()}  (${HORIZONS[h].dteMin}-${HORIZONS[h].dteMax} DTE · floor ${HORIZONS[h].scoreFloor}${HORIZONS[h].scoreFloorGraduated ? "" : " provisional"})  —  ${committed} committed / ${lane.length} total`);
  console.log(`${"─".repeat(96)}`);
  if (!lane.length) { console.log("  (no name lists a liquid contract in this window — honesty rule: no contract, no play)"); continue; }
  for (const p of lane.slice(0, 25)) console.log(`  ${fmtPlay(p)}`);
}

// summary
const totals = HORIZON_ORDER.map((h) => `${HORIZONS[h].label} ${set[h].filter((p) => p.status === "COMMIT").length}/${set[h].length}`).join("  ·  ");
console.log(`\n${"═".repeat(96)}`);
console.log(`  SUMMARY (committed/total per lane):  ${totals}`);
console.log(`  candidates: ${candidates.length} (${anchorCands.length} anchors + ${movers.length} movers) · chains fetched: ${candidates.filter((c) => c._chainCount > 0).length}`);
console.log(`${"═".repeat(96)}\n`);
