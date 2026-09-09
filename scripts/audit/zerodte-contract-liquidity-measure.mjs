/**
 * 0DTE CONTRACT-LIQUIDITY MEASUREMENT — real bid/ask size + volume/OI distributions,
 * split by ticker class, so `QUOTE_VALIDITY.min_quote_size` (plan.ts) can be recalibrated
 * from EVIDENCE instead of the current universal floor of 1 (a single resting contract on
 * each side — the same bar for SPX and for a random single name).
 *
 * WHY this exists: G-9/WS-04 already have a liquidity gate (evaluateQuoteValidity), but its
 * `min_quote_size` is 1 for every ticker, and there is no volume/OI check anywhere in the
 * gate stack. An index/ETF book quoting size=50 on both sides and a single name quoting
 * size=1/1 both pass identically today. This script measures what REAL 0DTE-eligible books
 * actually look like, per ticker class, so a real per-class floor can be set — never guessed.
 *
 * Pulls the REAL Polygon/Massive unified option-chain snapshot (`/v3/snapshot/options/{ticker}`,
 * the SAME endpoint `mapUnifiedSnapshotResult`/`options-snapshot.ts` reads in production) for
 * each ticker, filters to the NEAREST expiry with same-day or next-available bias (0DTE when the
 * market has one, else the closest listed expiry — index/single-name chains are not guaranteed
 * to have a same-day expiry every session), restricts to NEAR-THE-MONEY strikes (within
 * `--band` %, default 15%, of spot — the same rough moneyness band the board actually trades
 * (SETUP_MAX_OTM_PCT=12-16%, board.ts), so this measures the population the gate actually sees,
 * not a deep-OTM tail nobody would commit to), and reports min/p10/p25/median for bid size,
 * ask size, and day volume / open interest — split by ticker class (INDEX/ETF vs SINGLE NAME).
 *
 * Read-only. Polygon/Massive only — no UW, no DB, no Clerk, no writes.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
 *     scripts/audit/zerodte-contract-liquidity-measure.mjs [--tickers=SPX,SPY,QQQ,NVDA,TSLA,AAPL] [--band=15] [--json]
 */

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const asJson = args.includes("--json");

const KEY = process.env.POLYGON_API_KEY;
// Self-default the base the same way every other audit script does — `${{shared.*}}` env refs
// do not resolve in this sandbox, so POLYGON_API_BASE arrives as the literal unresolved string
// "POLYGON_API_BASE" and a truthiness check alone would 404 every fetch (see CLAUDE.md).
const RAW_BASE = process.env.POLYGON_API_BASE;
const BASE = /^https?:/.test(RAW_BASE ?? "") ? RAW_BASE : "https://api.massive.com";

if (!KEY) {
  console.error("POLYGON_API_KEY missing — cannot measure against live chains.");
  process.exit(2);
}

// Ticker class — mirrors INDEX_ETF_TICKERS in gates.ts (kept as a literal copy here so this
// plain .mjs script avoids the TS path-alias import; keep in lockstep if gates.ts's set changes).
const INDEX_ETF_TICKERS = new Set(["SPY", "QQQ", "IWM", "DIA"]);
// SPX/SPXW are an index option (no underlying ETF share), traded via the SPXW OCC root —
// treated as its own INDEX class distinct from SPY/QQQ (cash-settled, European, no assignment,
// typically thinner top-of-book size than SPY despite deep aggregate liquidity).
const tickerClass = (ticker) => {
  const t = ticker.toUpperCase();
  if (t === "SPX" || t === "SPXW") return "INDEX";
  if (INDEX_ETF_TICKERS.has(t)) return "ETF";
  return "SINGLE";
};
// Polygon's options-chain snapshot path accepts the bare "SPX" root directly and returns SPXW-
// rooted OCC contracts under it (verified live: underlying_asset.ticker comes back "I:SPX") — no
// separate "SPXW" chain path exists on this endpoint.
const chainPathTicker = (ticker) => ticker.toUpperCase();

const DEFAULT_TICKERS = "SPX,SPY,QQQ,NVDA,TSLA,AAPL";
const TICKERS = flag("tickers", DEFAULT_TICKERS)
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
const BAND_PCT = Number(flag("band", "15"));

const todayEt = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  return r.json();
}

/** Fetch the full option chain snapshot for one ticker (paginated, capped). */
async function fetchChain(ticker) {
  const out = [];
  let url = `${BASE}/v3/snapshot/options/${chainPathTicker(ticker)}?limit=250&apiKey=${KEY}`;
  let guard = 0;
  while (url && guard < 20) {
    const page = await getJson(url);
    if (!page) break;
    out.push(...(page.results ?? []));
    url = page.next_url ? `${page.next_url}&apiKey=${KEY}` : null;
    guard++;
  }
  return out;
}

const quantile = (sorted, q) => {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

function summarize(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return { n: 0, min: null, p10: null, p25: null, median: null };
  return {
    n: nums.length,
    min: nums[0],
    p10: quantile(nums, 0.1),
    p25: quantile(nums, 0.25),
    median: quantile(nums, 0.5),
  };
}

/** Index-option chains (SPX/SPXW) carry only `underlying_asset.ticker` on this endpoint (no
 *  price/value on the options-chain rows — verified live 2026-09-09) — spot must come from the
 *  separate `/v3/snapshot/indices` endpoint, the same one `fetchIndexSnapshot` (polygon.ts) uses. */
async function fetchIndexSpot(underlyingTicker) {
  const data = await getJson(
    `${BASE}/v3/snapshot/indices?ticker.any_of=${encodeURIComponent(underlyingTicker)}&apiKey=${KEY}`
  );
  const row = data?.results?.[0];
  const v = row?.value ?? row?.session?.close ?? null;
  return typeof v === "number" && v > 0 ? v : null;
}

async function measureTicker(ticker) {
  const today = todayEt();
  const raw = await fetchChain(ticker);
  if (raw.length === 0) return { ticker, class: tickerClass(ticker), error: "empty chain", n: 0 };

  // Pick the nearest expiry >= today (0DTE when one exists, else nearest upcoming — index/
  // single-name chains do not all list a same-day expiry every session, and a fair liquidity
  // read needs SOME near-dated contract population, not none).
  const expiries = [...new Set(raw.map((r) => r.details?.expiration_date).filter(Boolean))].sort();
  const nearest = expiries.find((e) => e >= today) ?? expiries[expiries.length - 1] ?? null;
  if (!nearest) return { ticker, class: tickerClass(ticker), error: "no expiry found", n: 0 };

  const spotCandidates = raw
    .map((r) => r.underlying_asset?.price ?? r.underlying_asset?.value)
    .filter((v) => typeof v === "number" && v > 0);
  let spot = spotCandidates.length > 0 ? spotCandidates[0] : null;
  if (spot == null && tickerClass(ticker) === "INDEX") {
    spot = await fetchIndexSpot(`I:${ticker.toUpperCase()}`);
  }

  const rows = raw.filter((r) => {
    if (r.details?.expiration_date !== nearest) return false;
    if (spot == null) return true; // no spot known — keep the whole nearest-expiry slice
    const strike = r.details?.strike_price;
    if (typeof strike !== "number") return false;
    return Math.abs(strike - spot) / spot <= BAND_PCT / 100;
  });

  const bidSizes = rows.map((r) => r.last_quote?.bid_size).filter((v) => typeof v === "number");
  const askSizes = rows.map((r) => r.last_quote?.ask_size).filter((v) => typeof v === "number");
  const volumes = rows.map((r) => r.day?.volume).filter((v) => typeof v === "number");
  const ois = rows.map((r) => r.open_interest).filter((v) => typeof v === "number");
  // Degenerate books (zero on either side) are exactly what QUOTE_VALIDITY.thin_size should
  // catch — count them separately so the "min" stat isn't misread as "typical".
  const zeroBidSizeCount = bidSizes.filter((v) => v === 0).length;
  const zeroAskSizeCount = askSizes.filter((v) => v === 0).length;

  return {
    ticker,
    class: tickerClass(ticker),
    expiry_used: nearest,
    is_0dte: nearest === today,
    spot,
    band_pct: BAND_PCT,
    contracts_in_band: rows.length,
    bid_size: summarize(bidSizes),
    ask_size: summarize(askSizes),
    day_volume: summarize(volumes),
    open_interest: summarize(ois),
    zero_bid_size_count: zeroBidSizeCount,
    zero_ask_size_count: zeroAskSizeCount,
  };
}

async function main() {
  const results = [];
  for (const ticker of TICKERS) {
    // Sequential — small ticker list, avoids bursting the Polygon rate limiter this sandbox shares.
    // eslint-disable-next-line no-await-in-loop
    const r = await measureTicker(ticker).catch((e) => ({ ticker, class: tickerClass(ticker), error: String(e) }));
    results.push(r);
  }

  // Roll up by class for the headline per-class floor evidence.
  const byClass = {};
  for (const r of results) {
    if (r.error || r.n === 0) continue;
    byClass[r.class] ??= { bid: [], ask: [], vol: [], oi: [] };
    byClass[r.class].bid.push(r.bid_size);
    byClass[r.class].ask.push(r.ask_size);
    byClass[r.class].vol.push(r.day_volume);
    byClass[r.class].oi.push(r.open_interest);
  }
  const classSummary = {};
  for (const [cls, buckets] of Object.entries(byClass)) {
    // Merge each ticker's own summarized min/p10 conservatively (min-of-mins, so the class
    // floor reflects the WORST observed ticker in the class, not an average that hides it).
    const mergeMin = (arr, key) => {
      const vals = arr.map((s) => s?.[key]).filter((v) => typeof v === "number");
      return vals.length ? Math.min(...vals) : null;
    };
    classSummary[cls] = {
      bid_size_min_across_tickers: mergeMin(buckets.bid, "min"),
      bid_size_p10_min_across_tickers: mergeMin(buckets.bid, "p10"),
      ask_size_min_across_tickers: mergeMin(buckets.ask, "min"),
      ask_size_p10_min_across_tickers: mergeMin(buckets.ask, "p10"),
      day_volume_min_across_tickers: mergeMin(buckets.vol, "min"),
      day_volume_p10_min_across_tickers: mergeMin(buckets.vol, "p10"),
      open_interest_min_across_tickers: mergeMin(buckets.oi, "min"),
      open_interest_p10_min_across_tickers: mergeMin(buckets.oi, "p10"),
    };
  }

  if (asJson) {
    console.log(JSON.stringify({ results, classSummary }, null, 2));
    return;
  }

  console.log(`0DTE CONTRACT-LIQUIDITY MEASUREMENT — band ±${BAND_PCT}% of spot, ${todayEt()} ET`);
  console.log("=".repeat(78));
  for (const r of results) {
    if (r.error) {
      console.log(`${r.ticker} (${r.class}): ERROR — ${r.error}`);
      continue;
    }
    console.log(
      `${r.ticker} (${r.class}) — expiry ${r.expiry_used}${r.is_0dte ? " [0DTE]" : " [nearest, not same-day]"}, spot ${r.spot}, ${r.contracts_in_band} contracts in band`
    );
    console.log(
      `  bid_size:  min=${r.bid_size.min} p10=${r.bid_size.p10} p25=${r.bid_size.p25} median=${r.bid_size.median} (n=${r.bid_size.n}, zero-count=${r.zero_bid_size_count})`
    );
    console.log(
      `  ask_size:  min=${r.ask_size.min} p10=${r.ask_size.p10} p25=${r.ask_size.p25} median=${r.ask_size.median} (n=${r.ask_size.n}, zero-count=${r.zero_ask_size_count})`
    );
    console.log(
      `  volume:    min=${r.day_volume.min} p10=${r.day_volume.p10} p25=${r.day_volume.p25} median=${r.day_volume.median} (n=${r.day_volume.n})`
    );
    console.log(
      `  open_int:  min=${r.open_interest.min} p10=${r.open_interest.p10} p25=${r.open_interest.p25} median=${r.open_interest.median} (n=${r.open_interest.n})`
    );
  }
  console.log("=".repeat(78));
  console.log("PER-CLASS ROLLUP (min-across-tickers, i.e. the worst ticker sets the class floor):");
  for (const [cls, s] of Object.entries(classSummary)) {
    console.log(`  ${cls}: ${JSON.stringify(s)}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
