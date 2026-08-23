#!/usr/bin/env node
/**
 * SPX tape aggressor measurement — does the SPX confluence engine's directional read
 * survive accounting for WHO was the aggressor?
 *
 * WHY THIS EXISTS
 * ───────────────
 * Two factors in `spx-signals.ts` score direction from the option TYPE alone:
 *
 *   - `scoreHelixFlowAlignment` (±15 / ±10): call sweep premium vs put sweep premium.
 *   - `tapeSkew` -> the "Live tape" factor (±12): the last 8 flow prints, `side === "call"`
 *     counted bull, `side === "put"` counted bear.
 *
 * That is up to **±27 of a score whose grade thresholds are 72 / 58 / 45 / 30** — decisive.
 * Neither factor asks whether the calls were BOUGHT or SOLD. A block of aggressively SOLD
 * calls is bearish on the rule this product already ships elsewhere (`printBias`,
 * `flowDirection`), and it is currently scored as bullish conviction on the SPX desk.
 *
 * The HELIX lane measured the same defect shape market-wide on 2026-08-23 and found 44.6% of
 * tickers sign-flip once aggression is accounted for — **`SPXW` among them**. This probe asks
 * the narrower question the SPX lane actually needs answered: on the SPX/SPXW tape
 * specifically, (a) how much premium even CARRIES an aggressor reading, and (b) how often the
 * two rules disagree about the direction of the same window.
 *
 * WHAT IT MEASURES (read-only, live prod)
 * ───────────────
 *  1. COVERAGE — share of SPX/SPXW prints and premium carrying a finite `ask_pct`. Without
 *     this the rest is meaningless: a rule that can only be applied to 3% of the tape is not
 *     an improvement, it is a silence.
 *  2. WHOLE-TAPE SPLIT — bullish/bearish/undetermined premium under each rule.
 *  3. WINDOW DISAGREEMENT — replays the ACTUAL `tapeSkew` window (8 most recent flow prints,
 *     newest-first) over every 8-print window in the sample and counts how many windows the
 *     two rules label differently. This is the number that maps to a shipped ±12, rather
 *     than an aggregate that no factor ever computes.
 *
 * It deliberately does NOT propose a threshold or grade anything against forward returns —
 * that is a separate question. This answers only "do the two rules disagree, and on how much".
 *
 * READ-ONLY. One temp Clerk user, released before exit.
 *
 * Usage:
 *   node scripts/audit/spx-tape-aggressor.mjs [--since-hours=168] [--limit=500]
 *                                             [--min-premium=50000] [--json]
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const JSON_OUT = args.includes("--json");
const BASE = flag("base", process.env.VALIDATE_BASE || "https://blackouttrades.com");
const SINCE_HOURS = Math.max(1, Number(flag("since-hours", 168)) || 168);
const LIMIT = Math.max(1, Number(flag("limit", 500)) || 500);
/** Matches the desk tape's own floor (`spxTapeMinPremium()`, SPX_TAPE_MIN_PREMIUM, default 50K),
 *  so the sample is the population `tapeSkew` actually scores rather than the whole raw tape. */
const MIN_PREMIUM = Math.max(0, Number(flag("min-premium", 50_000)) || 0);

/** Mirrors ASK_SIDE_BOUGHT_PCT / ASK_SIDE_SOLD_PCT in helix-flow-aggression.ts. */
const BOUGHT_PCT = 60;
const SOLD_PCT = 40;

function aggressorSide(askPct) {
  if (askPct == null || !Number.isFinite(Number(askPct))) return "undetermined";
  const pct = Number(askPct);
  if (pct >= BOUGHT_PCT) return "bought";
  if (pct <= SOLD_PCT) return "sold";
  return "undetermined";
}

/** CALL bought -> bullish, CALL sold -> bearish, PUT bought -> bearish, PUT sold -> bullish. */
function aggressionAwareDirection(row) {
  const side = aggressorSide(row.ask_pct);
  if (side === "undetermined") return "undetermined";
  const type = String(row.option_type ?? "").toUpperCase();
  if (type !== "CALL" && type !== "PUT") return "undetermined";
  const bought = side === "bought";
  if (type === "CALL") return bought ? "bullish" : "bearish";
  return bought ? "bearish" : "bullish";
}

/** The rule shipping today: option type alone. */
function typeOnlyDirection(row) {
  const type = String(row.option_type ?? "").toUpperCase();
  if (type === "CALL") return "bullish";
  if (type === "PUT") return "bearish";
  return "undetermined";
}

/**
 * The shipped `tapeSkew` verdict for one window: bull/bear premium, 1.25x margin, and a
 * $250K floor — reproduced exactly so the disagreement count is about the FACTOR, not about
 * an aggregate the engine never computes.
 */
function tapeVerdict(rows, directionOf) {
  let bull = 0;
  let bear = 0;
  for (const r of rows) {
    const d = directionOf(r);
    const prem = Number(r.premium) || 0;
    if (d === "bullish") bull += prem;
    else if (d === "bearish") bear += prem;
  }
  if (bull + bear <= 250_000) return "none";
  if (bull > bear * 1.25) return "bullish";
  if (bear > bull * 1.25) return "bearish";
  return "none";
}

function money(n) {
  return `$${(n / 1e6).toFixed(1)}M`;
}

async function main() {
  /** @type {Record<string, {rows: unknown[], truncated: boolean}>} */
  const byTicker = {};
  const rows = [];
  for (const ticker of ["SPX", "SPXW"]) {
    const res = await fetchAuditJson(
      BASE,
      `/api/market/flows?ticker=${ticker}&limit=${LIMIT}&since_hours=${SINCE_HOURS}` +
        `&min_premium=${MIN_PREMIUM}`
    );
    if (!res.ok) {
      console.error(`HARNESS: /api/market/flows?ticker=${ticker} -> HTTP ${res.status}`);
      return 2;
    }
    const flows = res.json?.flows;
    if (!Array.isArray(flows)) {
      console.error(`HARNESS: flows payload for ${ticker} is not an array`);
      return 2;
    }
    byTicker[ticker] = { rows: flows, truncated: Boolean(res.json?.has_more) };
    for (const f of flows) rows.push(f);
  }

  if (!rows.length) {
    console.error(`HARNESS: no SPX/SPXW prints in the last ${SINCE_HOURS}h — nothing to measure`);
    return 2;
  }

  // Newest-first, exactly as the desk tape orders before `tapeSkew` slices its 8.
  rows.sort((a, b) => new Date(b.alerted_at).getTime() - new Date(a.alerted_at).getTime());

  const hasAsk = (r) => r.ask_pct != null && Number.isFinite(Number(r.ask_pct));
  const sumPrem = (rs) => rs.reduce((s, r) => s + (Number(r.premium) || 0), 0);

  const coverage = {};
  for (const [ticker, { rows: rs, truncated }] of Object.entries(byTicker)) {
    const wa = rs.filter(hasAsk);
    coverage[ticker] = {
      prints: rs.length,
      prints_with_ask_pct: wa.length,
      print_coverage: rs.length ? wa.length / rs.length : 0,
      premium: sumPrem(rs),
      premium_with_ask_pct: sumPrem(wa),
      premium_coverage: sumPrem(rs) > 0 ? sumPrem(wa) / sumPrem(rs) : 0,
      truncated_by_limit: truncated,
    };
  }

  const split = (directionOf) => {
    const out = { bullish: 0, bearish: 0, undetermined: 0 };
    for (const r of rows) out[directionOf(r)] += Number(r.premium) || 0;
    return out;
  };
  const typeOnly = split(typeOnlyDirection);
  const aware = split(aggressionAwareDirection);

  // Every 8-print window, the exact slice size tapeSkew uses.
  const WINDOW = 8;
  let windows = 0;
  let disagree = 0;
  let flipped = 0; // both rules fire and point OPPOSITE ways — the worst case
  let silenced = 0; // shipped rule fires, aggression-aware cannot
  let woken = 0; // aggression-aware fires where the shipped rule was silent
  let minorityReadable = 0; // windows where unreadable premium exceeds readable premium
  for (let i = 0; i + WINDOW <= rows.length; i++) {
    const w = rows.slice(i, i + WINDOW);
    const a = tapeVerdict(w, typeOnlyDirection);
    const b = tapeVerdict(w, aggressionAwareDirection);
    windows++;
    const readable = sumPrem(w.filter((r) => aggressionAwareDirection(r) !== "undetermined"));
    if (readable < sumPrem(w) - readable) minorityReadable++;
    if (a === b) continue;
    disagree++;
    if (a !== "none" && b !== "none") flipped++;
    else if (a !== "none" && b === "none") silenced++;
    else woken++;
  }

  const result = {
    base: BASE,
    since_hours: SINCE_HOURS,
    min_premium: MIN_PREMIUM,
    prints: rows.length,
    coverage_by_ticker: coverage,
    split_type_only: typeOnly,
    split_aggression_aware: aware,
    windows,
    windows_disagreeing: disagree,
    windows_sign_flipped: flipped,
    windows_silenced: silenced,
    windows_woken: woken,
    windows_unreadable_premium_majority: minorityReadable,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(
    `SPX TAPE AGGRESSOR — ${BASE}, last ${SINCE_HOURS}h, min_premium $${(MIN_PREMIUM / 1e3).toFixed(0)}K`
  );
  console.log("");
  console.log("  ask_pct COVERAGE BY TICKER");
  for (const [ticker, c] of Object.entries(coverage)) {
    console.log(
      `    ${ticker.padEnd(5)} ${String(c.prints).padStart(4)} prints  ` +
        `${(c.print_coverage * 100).toFixed(1).padStart(5)}% of prints  ` +
        `${(c.premium_coverage * 100).toFixed(1).padStart(5)}% of premium  ` +
        `${money(c.premium)}` +
        (c.truncated_by_limit ? `  [TRUNCATED at limit=${LIMIT} — more rows exist]` : "")
    );
  }
  console.log("");
  console.log("  WHOLE-TAPE SPLIT (both tickers)");
  console.log(
    `    option_type alone        bull ${money(typeOnly.bullish)}  bear ${money(typeOnly.bearish)}  undetermined ${money(typeOnly.undetermined)}`
  );
  console.log(
    `    aggression-aware         bull ${money(aware.bullish)}  bear ${money(aware.bearish)}  undetermined ${money(aware.undetermined)}`
  );
  console.log("");
  console.log(`  TAPE-FACTOR WINDOWS (${WINDOW}-print, the slice tapeSkew scores)`);
  console.log(`    windows                  ${windows}`);
  console.log(
    `    disagreeing              ${disagree} (${windows ? ((disagree / windows) * 100).toFixed(1) : "0.0"}%)`
  );
  console.log(`      SIGN-FLIPPED           ${flipped}  <- shipped ±12 points the wrong way`);
  console.log(`      SILENCED               ${silenced}  <- shipped rule fires, aggressor can't say`);
  console.log(`      WOKEN                  ${woken}  <- aggressor speaks where shipped rule was mute`);
  console.log(
    `    unreadable premium >50%  ${minorityReadable} (${windows ? ((minorityReadable / windows) * 100).toFixed(1) : "0.0"}%)`
  );

  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`HARNESS: ${err?.message ?? err}`);
  code = 2;
}
await releaseAuditClerkSession().catch(() => {});
process.exit(code);
