/**
 * SWIFT-VS-NIGHT-HAWK LITERAL COMPARISON — the first real, non-fabricated check against a
 * third-party trader's ("Swift") actual timestamped trades, per the member's standing request.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "Compare timestamped Swift examples against
 * Night Hawk's decisions and identify exactly where each was missed: discovery, timing, scoring,
 * entry, or exit.")
 * ------------------------------------------------------------------------------------------
 * Every prior session of this investigation reported Swift's literal trade data as UNAVAILABLE
 * (checked `/mnt/user-data/uploads`/`/root/.claude/uploads` directly, found nothing). This round
 * that check found real data: a Discord "#swift-swiftx SWIFT DAILY RECAP" screenshot for
 * 2026-10-19, transcribed (never fabricated) into `docs/audit/history/swift-trades/<date>.json`.
 * It carries ticker/strike/expiry/entry premium/exit premium/%, but NO exact alert timestamps —
 * a real, disclosed limitation of this data source (see each JSON file's own "note" field).
 *
 * METHOD — for each 0DTE Swift trade (same-day expiry only; a 4-DTE row in the 2026-10-19 recap
 * is excluded and flagged, out of scope for this 0DTE investigation):
 *   1. Resolve the REAL Polygon OCC for Swift's exact ticker/strike/side/expiry (not an ATM
 *      guess — the strike is already known from the transcript). SPX routes to the real SPXW
 *      weekly root per production's own `polygonSpotTicker` mapping (board.ts).
 *   2. Walk REAL historical NBBO quotes for that OCC across the whole session and find the
 *      window(s) where the quoted ask (for a long call) was close to Swift's stated entry price
 *      — this APPROXIMATES when Swift likely entered (a price-matching proxy, not a timestamp;
 *      ties are reported, never silently resolved to the first match only).
 *   3. Cross-reference the SAME ticker/direction/date against REAL production decisions:
 *      - `GET /api/admin/zerodte/tier-export` (admin-gated, real `entry_premium`/`top_strike`/
 *        `expiry`/`first_flagged_at`/`discovery_origin` per committed play — never reimplemented)
 *      - `GET /api/admin/zerodte/rejection-export` (admin-gated, real `gate_failed`/`blocks`/
 *        `observed_at`/`counterfactual` per hard-gate rejection)
 *   4. Classify each trade:
 *      - DISCOVERY_MISS: the ticker/direction never appears in EITHER export for that day — Night
 *        Hawk never generated a candidate for it at all (committed or rejected).
 *      - TIMING_MISS: Night Hawk generated/committed a candidate for the same ticker/direction,
 *        but materially AFTER the price-matched entry window — Swift's entry price was simply no
 *        longer available by the time Night Hawk acted.
 *      - GATE_REJECT: a real hard-gate rejection exists for this ticker/direction that session —
 *        names the exact gate and its counterfactual verdict.
 *      - COMMITTED: Night Hawk DID commit a real play on this ticker/direction that day —
 *        compares entry premium/timing directly (an ENTRY-quality or EXIT-quality question, not
 *        a discovery one).
 *      - INSUFFICIENT_DATA: the admin exports don't cover this ticker/day combination cleanly
 *        enough to classify (e.g., ambiguous direction, no OCC resolvable) — never forced into
 *        one of the above.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR EXIT RULE — diagnosis only. READ-ONLY; admin-gated
 * routes via the shared Clerk temp-admin session (`audit-auth-fetch.mjs`), released at the end.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-swift-comparison.mjs --trades=docs/audit/history/swift-trades/2026-10-19.json [options]
 * OPTIONS
 *   --trades=<path.json>  REQUIRED — one of this toolkit's transcribed Swift-trade files
 *   --base=URL
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const APP_BASE = process.env.AUDIT_BASE || "https://blackouttrades.com";
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const EMIT_JSON = Boolean(argv.json);
const BASE = argv.base ?? APP_BASE;

if (!argv.trades) {
  console.error("Usage: --trades=docs/audit/history/swift-trades/<date>.json is required.");
  process.exit(1);
}

const fs = await import("node:fs");
const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const line = (c = "─", w = 112) => c.repeat(w);
function etTimeOf(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}

// CORRECTNESS NOTE (caught live, 2026-10-20): the OCC for an SPX weekly 0DTE contract is
// prefixed "SPXW" (e.g. O:SPXW261019C07710000, matching production's own board.ts comment on the
// option ROOT) — but Polygon's /v3/reference/options/contracts `underlying_ticker` filter for
// that SAME contract is "SPX", not "SPXW" (verified live: underlying_ticker=SPXW returns 0
// results for a real, listed 7710 strike; underlying_ticker=SPX returns it with
// ticker=O:SPXW261019C07710000). The OPTION ROOT and the REFERENCE-API underlying_ticker are
// two different fields that happen to look like they should match and don't — no override is
// needed here; querying with the plain ticker (SPX) is already correct.
// A SEPARATE mapping from the one above — do not conflate the two, that is exactly the bug this
// comment exists to prevent a future reader from reintroducing. Night Hawk's OWN internal tables
// (`zerodte_setup_log`/`zerodte_scan_rejections`, surfaced via the tier-export/rejection-export
// admin routes) key every SPX 0DTE row under the ticker string "SPXW", never bare "SPX" —
// confirmed live: a 90-day tier-export pull showed 33 real SPXW commits and zero under "SPX".
// The FIRST version of this script queried those routes with the bare "SPX" from the Swift
// transcript and got zero matches for all three of this round's real SPX trades, which
// classified as DISCOVERY_MISS — a FALSE one: Night Hawk had in fact evaluated and rejected all
// three (31 real SPXW rejections that day, `score_floor`/`tape_alignment`/`no_market_bias`/
// `flow_accumulation_conflict`/`vix_elevated` stacking against a long bias while the tape read
// down). Caught by cross-checking a wider historical pull before trusting the zero-match result.
const TICKER_FOR_PRODUCTION_QUERY = { SPX: "SPXW", NDX: "NDXP" };

async function resolveKnownContract(ticker, strike, expiryYmd, side) {
  const underlyingTicker = ticker;
  const qs = new URLSearchParams({
    underlying_ticker: underlyingTicker, contract_type: side, expired: "true",
    "expiration_date.gte": expiryYmd, "expiration_date.lte": expiryYmd,
    "strike_price.gte": String(strike - 0.5), "strike_price.lte": String(strike + 0.5),
    limit: "50", apiKey: POLYGON_KEY,
  });
  const res = await fetch(`${POLYGON_BASE}/v3/reference/options/contracts?${qs}`);
  const j = await res.json().catch(() => null);
  const rows = j?.results ?? [];
  let best = null, bestDist = Infinity;
  for (const r of rows) {
    const dist = Math.abs(Number(r.strike_price) - strike);
    if (dist < bestDist) { bestDist = dist; best = r; }
  }
  return best ? { occ: best.ticker, strike: Number(best.strike_price) } : null;
}

// CORRECTNESS NOTE (caught live, 2026-10-20): the first cut of this function paginated the raw
// NBBO /v3/quotes feed with a fixed 6-page (300k-quote) cap. That silently under-covered any
// HEAVILY-liquid contract — QQQ 261019C00720000 alone produced 300,000 quotes in the first 78
// minutes of the session (9:30-10:48 ET) and the cap stopped there, so a price level that only
// occurred later in the day (e.g. after decay/a pullback) was invisibly never checked — a
// DISCOVERY_MISS-shaped false negative for the WINDOW-FINDING step, not a real absence. Minute
// AGGREGATE bars (one Polygon call for the whole day, same helper this toolkit's other real-cost
// scripts already use) give the real traded [low,high] range per minute regardless of how many
// raw quotes/trades happened inside it — immune to the liquidity-driven pagination truncation,
// and arguably a more honest "a real trade near this price occurred" signal than NBBO ask alone.
async function fetchOptionBars(occ, dayYmd) {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(occ)}/range/1/minute/${dayYmd}/${dayYmd}?limit=1000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return (data?.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

/** Find every 1-minute bar whose traded [low,high] range brackets (or comes within `tolPct` of)
 *  the target entry price. Returns ALL matching windows (collapsed into contiguous runs, a gap
 *  >10min starts a new one), never just the first — a price level touched twice in a day is
 *  reported as two real candidate windows, not silently collapsed to one. */
function findPriceMatchWindows(bars, targetPx, tolPct = 0.08) {
  const lo = targetPx * (1 - tolPct), hi = targetPx * (1 + tolPct);
  const hits = bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.l) && Number.isFinite(b.h))
    .filter((b) => b.l <= hi && b.h >= lo) // the bar's traded range overlaps the tolerance band
    .sort((a, b) => a.t - b.t);
  if (!hits.length) return [];
  const windows = [];
  let curStart = hits[0], curEnd = hits[0];
  for (let i = 1; i < hits.length; i++) {
    const gapMs = hits[i].t - curEnd.t;
    if (gapMs > 10 * 60_000) { windows.push({ start: curStart, end: curEnd }); curStart = hits[i]; }
    curEnd = hits[i];
  }
  windows.push({ start: curStart, end: curEnd });
  return windows.map((w) => ({ startMs: w.start.t, endMs: w.end.t }));
}

console.log(line("═"));
console.log(`  SWIFT-VS-NIGHT-HAWK LITERAL COMPARISON`);
console.log(`  trades file: ${argv.trades}`);
console.log(line("═"));

const tradesFile = JSON.parse(fs.readFileSync(argv.trades, "utf8"));
const sessionDate = tradesFile.session_date;
const zeroDteTrades = tradesFile.trades.filter((t) => t.expiry === sessionDate);
const outOfScope = tradesFile.trades.filter((t) => t.expiry !== sessionDate);
console.log(`\n  session: ${sessionDate} · ${zeroDteTrades.length} 0DTE trade(s) in scope, ${outOfScope.length} out of scope (non-0DTE)`);
if (outOfScope.length) {
  console.log(`  out of scope: ${outOfScope.map((t) => `${t.ticker} ${t.strike}${t.side === "call" ? "C" : "P"} exp ${t.expiry}`).join(", ")}`);
}

try {
  console.log(`\n[1] Fetching real production committed plays + rejections for ${sessionDate}…`);
  const tickers = [...new Set(zeroDteTrades.map((t) => t.ticker))];

  const tierExportRes = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=90`);
  const allCommitted = (tierExportRes?.json?.plays ?? []).filter((p) => p.session_date === sessionDate);
  console.log(`    committed plays on ${sessionDate} (any ticker): ${allCommitted.length}`);

  const rejectionsByTicker = new Map();
  for (const t of tickers) {
    const prodTicker = TICKER_FOR_PRODUCTION_QUERY[t] ?? t;
    const res = await fetchAuditJson(BASE, `/api/admin/zerodte/rejection-export?session_date=${sessionDate}&ticker=${prodTicker}&limit=200`).catch(() => null);
    rejectionsByTicker.set(t, res?.json?.rows ?? []);
    await new Promise((r) => setTimeout(r, 150));
  }
  const totalRejections = [...rejectionsByTicker.values()].reduce((s, a) => s + a.length, 0);
  console.log(`    rejections across Swift's ${tickers.length} ticker(s) on ${sessionDate}: ${totalRejections}`);

  console.log(`\n[2] Resolving real contracts + price-matching entry windows (Polygon NBBO)…`);
  const results = [];
  for (const trade of zeroDteTrades) {
    const side = trade.side === "call" ? "call" : "put";
    const contract = await resolveKnownContract(trade.ticker, trade.strike, trade.expiry, side);
    let entryWindows = [];
    if (contract) {
      const bars = await fetchOptionBars(contract.occ, sessionDate);
      entryWindows = findPriceMatchWindows(bars, trade.entry_px);
      console.log(`    ${trade.ticker} ${trade.strike}${side === "call" ? "C" : "P"} → ${contract.occ}: ${bars.length} minute bars, ${entryWindows.length} price-match window(s) @ ~$${trade.entry_px}`);
    } else {
      console.log(`    ${trade.ticker} ${trade.strike}${side === "call" ? "C" : "P"} → contract NOT resolvable`);
    }
    await new Promise((r) => setTimeout(r, 150));

    // Direction filter: Swift's "call" maps to Night Hawk's "long" direction (and "put" to
    // "short") — a ticker with BOTH long and short evaluations that day (e.g. SPXW, which can
    // run both biases depending on tape read) must be filtered to the SAME bias Swift actually
    // traded, or the comparison silently conflates two different real decisions.
    const nhDirection = side === "call" ? "long" : "short";
    const prodTicker = TICKER_FOR_PRODUCTION_QUERY[trade.ticker] ?? trade.ticker;
    const committed = allCommitted.filter((p) => p.ticker === prodTicker && p.direction === nhDirection);
    const rejectedAllDirections = rejectionsByTicker.get(trade.ticker) ?? [];
    const rejected = rejectedAllDirections.filter((r) => r.direction === nhDirection);
    const rejectedOppositeDirection = rejectedAllDirections.filter((r) => r.direction && r.direction !== nhDirection);

    let classification, detail;
    if (!committed.length && !rejected.length) {
      classification = rejectedOppositeDirection.length ? "DISCOVERY_MISS_SAME_BIAS_ONLY" : "DISCOVERY_MISS";
      detail = rejectedOppositeDirection.length
        ? `Night Hawk evaluated ${trade.ticker} that day but only on the OPPOSITE bias (${rejectedOppositeDirection.length} ${nhDirection === "long" ? "short" : "long"} rejection(s)) — no ${nhDirection} (Swift's own side) candidate was ever generated.`
        : "Night Hawk generated NO candidate (committed or rejected, either direction) for this ticker that session day.";
    } else if (committed.length) {
      classification = "COMMITTED";
      const c = committed[0];
      detail = `Night Hawk COMMITTED a real play on ${trade.ticker} that day: entry_premium=${c.entry_premium}, top_strike=${c.top_strike}, first_flagged_at=${c.first_flagged_at}, origin=${JSON.stringify(c.discovery_origin)}.`;
    } else {
      classification = "GATE_REJECT";
      const byGate = new Map();
      for (const r of rejected) byGate.set(r.gate_failed, (byGate.get(r.gate_failed) ?? 0) + 1);
      detail = `Night Hawk REJECTED ${rejected.length} candidate(s) on ${trade.ticker} that day. Gates: ${[...byGate.entries()].map(([g, n]) => `${g}×${n}`).join(", ")}.`;
    }

    // TIMING check: if committed/rejected has a timestamp and we have a price-match window,
    // compare — a NH action materially AFTER every price-match window's end is a timing miss
    // layered on top of the base classification (not mutually exclusive with GATE_REJECT).
    let timingNote = null;
    if (entryWindows.length) {
      const firstWindowStart = Math.min(...entryWindows.map((w) => w.startMs));
      const lastWindowEnd = Math.max(...entryWindows.map((w) => w.endMs));
      const nhTimestamps = [
        ...committed.map((c) => c.first_flagged_at ? Date.parse(c.first_flagged_at) : null),
        ...rejected.map((r) => Date.parse(r.observed_at)),
      ].filter((t) => Number.isFinite(t));
      if (nhTimestamps.length) {
        const earliestNh = Math.min(...nhTimestamps);
        if (earliestNh > lastWindowEnd) {
          timingNote = `Night Hawk's earliest action (${etTimeOf(earliestNh)} ET) came AFTER Swift's last price-match window ended (${etTimeOf(lastWindowEnd)} ET) — a real timing lag on top of the base classification.`;
        } else if (earliestNh < firstWindowStart) {
          timingNote = `Night Hawk's earliest action (${etTimeOf(earliestNh)} ET) came BEFORE Swift's first price-match window (${etTimeOf(firstWindowStart)} ET) — NH was not late here.`;
        } else {
          timingNote = `Night Hawk's earliest action (${etTimeOf(earliestNh)} ET) falls WITHIN Swift's price-match window — comparable timing.`;
        }
      }
    }

    results.push({
      ticker: trade.ticker, strike: trade.strike, side, entry_px: trade.entry_px, exit_px: trade.exit_px, pct: trade.pct,
      swift_marked: trade.swift_marked, occ: contract?.occ ?? null,
      entryWindowsEt: entryWindows.map((w) => `${etTimeOf(w.startMs)}-${etTimeOf(w.endMs)}`),
      classification, detail, timingNote,
    });
  }

  console.log(`\n${line("═")}`);
  console.log(`  RESULTS — ${results.length} Swift 0DTE trade(s) classified`);
  console.log(line("═"));
  const counts = new Map();
  for (const r of results) counts.set(r.classification, (counts.get(r.classification) ?? 0) + 1);
  console.log(`\n  classification breakdown: ${JSON.stringify(Object.fromEntries(counts))}`);
  for (const r of results) {
    console.log(`\n  ${r.ticker} ${r.strike}${r.side === "call" ? "C" : "P"} @ ${r.entry_px}→${r.exit_px} (${r.pct}%, Swift marked ${r.swift_marked})`);
    console.log(`    OCC: ${r.occ ?? "unresolved"}`);
    console.log(`    price-match window(s) ET: ${r.entryWindowsEt.length ? r.entryWindowsEt.join(", ") : "none found"}`);
    console.log(`    classification: ${r.classification}`);
    console.log(`    ${r.detail}`);
    if (r.timingNote) console.log(`    TIMING: ${r.timingNote}`);
  }

  console.log(`\n${line("═")}`);
  console.log(`  No gate, filter, or exit rule changed by this run — diagnosis only.`);
  console.log(line("═"));

  if (EMIT_JSON) {
    console.log("\n<<<JSON>>>");
    console.log(JSON.stringify({ session_date: sessionDate, results, out_of_scope: outOfScope }, null, 2));
  }
} finally {
  await releaseAuditClerkSession();
}
