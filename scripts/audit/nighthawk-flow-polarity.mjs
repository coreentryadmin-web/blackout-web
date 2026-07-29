/**
 * NIGHT HAWK LEGACY — flow polarity measurement (READ-ONLY / no scorer change).
 *
 * Compares Legacy call/put direction vs signed-aggression polarity (0DTE semantics:
 * ask-call / bid-put → bullish). Reports disagreement rate and the bid-put share —
 * the bucket most likely to invert a Legacy SHORT into a signed LONG.
 *
 * Modes:
 *   --fixture=<path.json>  array of {ticker, flows:[...]} or raw flow rows with ticker
 *   --live                 pull today's market flow alerts (needs UW_API_KEY), group by ticker
 *
 * Flags: --json --quiet --min-premium=100000 --min-prints=3
 *
 * Run:
 *   node --import tsx scripts/audit/nighthawk-flow-polarity.mjs --fixture=flows.json --json
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/nighthawk-flow-polarity.mjs --live --json
 *
 * Exit: 0 always on successful measure; 2 missing env/fixture; 1 import/runtime error.
 */
import { readFileSync } from "node:fs";

const SRC = new URL("../../src/", import.meta.url).pathname;

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);

const JSON_OUT = argv.json === true || argv.json === "true";
const QUIET = argv.quiet === true || argv.quiet === "true";
const MIN_PREM = Number(argv["min-premium"] ?? 100_000);
const MIN_PRINTS = Number(argv["min-prints"] ?? 3);

function log(...args) {
  if (!QUIET && !JSON_OUT) console.log(...args);
}

function groupByTicker(rows) {
  /** @type {Map<string, Record<string, unknown>[]>} */
  const map = new Map();
  for (const r of rows) {
    const t = String(r.ticker ?? r.ticker_symbol ?? "").toUpperCase();
    if (!t) continue;
    const prem = Number(r.total_premium ?? r.premium ?? 0);
    if (!Number.isFinite(prem) || prem < MIN_PREM) continue;
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(r);
  }
  return map;
}

async function loadLive() {
  if (!process.env.UW_API_KEY) {
    console.error("UW_API_KEY required for --live");
    process.exit(2);
  }
  const uw = await import(`${SRC}lib/providers/unusual-whales.ts`);
  const fetchRows = uw.fetchMarketFlowAlertRows ?? uw.default?.fetchMarketFlowAlertRows;
  if (typeof fetchRows !== "function") {
    console.error("fetchMarketFlowAlertRows not available from unusual-whales module");
    process.exit(1);
  }
  const rows = await fetchRows({ limit: 450, min_premium: MIN_PREM });
  // Same shape Legacy scorer sees: raw UW fields + ticker/premium from the parsed flow.
  return rows.map((r) => {
    const raw = r.raw ?? {};
    const flow = r.flow ?? {};
    return {
      ...raw,
      ticker: flow.ticker ?? raw.ticker ?? raw.ticker_symbol,
      total_premium: flow.premium ?? raw.total_premium ?? raw.premium,
      type: flow.option_type ?? raw.type ?? raw.option_type,
      premium: flow.premium ?? raw.premium,
    };
  });
}

function loadFixture(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw) && raw[0]?.flows) {
    /** @type {Map<string, Record<string, unknown>[]>} */
    const map = new Map();
    for (const row of raw) {
      const t = String(row.ticker ?? "").toUpperCase();
      if (!t) continue;
      map.set(t, row.flows);
    }
    return map;
  }
  if (Array.isArray(raw)) return groupByTicker(raw);
  if (raw.flows) return groupByTicker(raw.flows);
  throw new Error("fixture shape: [{ticker,flows}] | flow rows | {flows:[]}");
}

const { compareFlowPolarity } = await import(
  `${SRC}features/nighthawk/lib/flow-polarity.ts`
);

let byTicker;
if (argv.live === true || argv.live === "true") {
  byTicker = groupByTicker(await loadLive());
} else if (argv.fixture && argv.fixture !== true) {
  byTicker = loadFixture(String(argv.fixture));
} else {
  console.error("Provide --fixture=<path> or --live");
  process.exit(2);
}

const rows = [];
let sideKnownPrints = 0;
let sideUnknownPrints = 0;
for (const [ticker, flows] of byTicker) {
  if (flows.length < MIN_PRINTS) continue;
  for (const f of flows) {
    const s = String(f.side ?? f.trade_side ?? f.tag_side ?? "").trim();
    const askPct = Number(f.ask_side_pct);
    const askPrem = Number(f.total_ask_side_prem);
    if (s || (Number.isFinite(askPct) && askPct > 0) || (Number.isFinite(askPrem) && askPrem > 0)) {
      sideKnownPrints += 1;
    } else {
      sideUnknownPrints += 1;
    }
  }
  const c = compareFlowPolarity(flows);
  rows.push({ ticker, prints: flows.length, ...c });
}

rows.sort((a, b) => Number(b.disagree) - Number(a.disagree) || b.put_premium - a.put_premium);

const disagree = rows.filter((r) => r.disagree);
const bidPutHeavy = disagree.filter((r) => r.bid_put_share_of_puts >= 0.5 && r.legacy_direction === "short");

const out = {
  tickers_measured: rows.length,
  disagree_count: disagree.length,
  disagree_rate: rows.length ? disagree.length / rows.length : 0,
  /** Disagreements where Legacy is SHORT but ≥50% of put premium is bid-side (classic misread). */
  bid_put_short_misread_count: bidPutHeavy.length,
  bid_put_short_misread_rate: rows.length ? bidPutHeavy.length / rows.length : 0,
  side_coverage: {
    known_prints: sideKnownPrints,
    unknown_prints: sideUnknownPrints,
    known_frac:
      sideKnownPrints + sideUnknownPrints > 0
        ? sideKnownPrints / (sideKnownPrints + sideUnknownPrints)
        : 0,
  },
  top_disagreements: disagree.slice(0, 25).map((r) => ({
    ticker: r.ticker,
    legacy: r.legacy_direction,
    signed: r.signed_direction,
    bid_put_share: Number(r.bid_put_share_of_puts.toFixed(3)),
    put_premium: r.put_premium,
    call_premium: r.call_premium,
  })),
};

if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
else {
  log(`Night Hawk Legacy flow polarity — ${out.tickers_measured} tickers (≥${MIN_PRINTS} prints)`);
  log(
    `  disagree ${out.disagree_count}/${out.tickers_measured}` +
      ` (${(out.disagree_rate * 100).toFixed(1)}%)`
  );
  log(
    `  bid-put SHORT misread bucket ${out.bid_put_short_misread_count}` +
      ` (${(out.bid_put_short_misread_rate * 100).toFixed(1)}%)`
  );
  for (const d of out.top_disagreements.slice(0, 10)) {
    log(
      `  ${d.ticker}: legacy=${d.legacy} signed=${d.signed}` +
        ` bidPutShare=${d.bid_put_share} putPrem=${Math.round(d.put_premium / 1e6)}M`
    );
  }
}

process.exit(0);
