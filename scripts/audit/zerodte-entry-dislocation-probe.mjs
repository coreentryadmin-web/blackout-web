// Entry-premium ACHIEVABILITY dislocation probe (2026-10-19, member-driven "Swift recap"
// benchmarking audit). For every real committed same-day-expiry (true 0DTE) 0DTE play over
// a trailing window, fetches the REAL Polygon NBBO quote nearest the exact commit instant
// and compares it to the ledger's persisted `entry_premium` — the number every subsequent
// win/loss grade and stop/target computation is denominated in.
//
// WHY same-day-expiry only: `resolveLedgerEntryPremium`'s achievability ceiling (plan.ts)
// exists to catch a flow fill that was never a tradeable price by the time the system
// committed off it. That failure mode is sharpest on 0DTE, where premium decays/moves fast
// enough for a flow print to go stale within seconds — this probe's first live run (TSLA
// 2026-10-19, O:TSLA261019C00365000) found exactly that: ledger entry 3.50 vs a real,
// liquid, 2-cent-spread NBBO of 2.28/2.30 at the exact commit second, a 34.6% dislocation
// the contract never traded at any point from the session open through the commit instant.
//
// Read-only: public `/api/admin/zerodte/tier-export` (admin-gated, temp Clerk session via
// audit-auth-fetch.mjs, released in `finally`) for entry_premium/strike/expiry/timestamp,
// plus public Polygon `/v3/quotes/{occ}` for the real NBBO. No writes to the app or DB.
//
// Usage: node --import tsx scripts/audit/zerodte-entry-dislocation-probe.mjs [--days=14] [--json]
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const POLYGON_BASE = process.env.POLYGON_API_BASE || "https://api.massive.com";
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const APP_BASE = process.env.AUDIT_BASE || "https://blackouttrades.com";

function parseArgs(argv) {
  const out = { days: 14, json: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--days=")) out.days = Number(a.slice("--days=".length));
  }
  return out;
}

function buildOcc(ticker, expiry, direction, strike) {
  const [y, m, d] = expiry.split("-");
  const yy = y.slice(2);
  const cp = direction === "long" ? "C" : "P";
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker}${yy}${m}${d}${cp}${strikeStr}`;
}

async function fetchQuoteNear(occ, atMs) {
  const from = (atMs - 90_000) * 1e6;
  const to = (atMs + 90_000) * 1e6;
  const url = `${POLYGON_BASE}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${from}&timestamp.lte=${to}&order=asc&limit=50000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  let best = null;
  let bestDiff = Infinity;
  for (const q of data.results) {
    const t = Math.floor(q.sip_timestamp / 1e6);
    const diff = Math.abs(t - atMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = q;
    }
  }
  return best ? { bid: best.bid_price, ask: best.ask_price, diffMs: bestDiff } : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = [];
  try {
    const res = await fetchAuditJson(APP_BASE, `/api/admin/zerodte/tier-export?days=${args.days}`);
    const sameDay = res.json.plays.filter((p) => p.expiry === p.session_date);
    for (const r of sameDay) {
      const occ = buildOcc(r.ticker, r.expiry, r.direction, r.top_strike);
      const atMs = Date.parse(r.first_flagged_at);
      try {
        const q = await fetchQuoteNear(occ, atMs);
        if (!q) {
          results.push({ ticker: r.ticker, date: r.session_date, occ, verdict: "NO_QUOTE_DATA" });
          continue;
        }
        const mid = (q.bid + q.ask) / 2;
        const dislocationPct = mid > 0 ? ((r.entry_premium - mid) / r.entry_premium) * 100 : null;
        results.push({
          ticker: r.ticker,
          date: r.session_date,
          occ,
          entry_premium: r.entry_premium,
          real_bid: q.bid,
          real_ask: q.ask,
          real_mid: Math.round(mid * 100) / 100,
          quote_diff_ms: q.diffMs,
          dislocation_pct: dislocationPct == null ? null : Math.round(dislocationPct * 10) / 10,
          outcome: r.plan_outcome,
          pnl_pct: r.plan_pnl_pct,
        });
      } catch (e) {
        results.push({ ticker: r.ticker, date: r.session_date, occ, error: e.message });
      }
      await new Promise((resolve) => setTimeout(resolve, 300)); // pace vs shared Polygon/UW rate limits
    }
  } finally {
    await releaseAuditClerkSession();
  }

  const severe = results.filter((r) => typeof r.dislocation_pct === "number" && r.dislocation_pct >= 20);
  if (args.json) {
    console.log(JSON.stringify({ results, severe_count: severe.length, total: results.length }, null, 2));
    return;
  }
  console.log(`${"ticker".padEnd(8)}${"date".padEnd(12)}${"entry".padStart(8)}${"real_mid".padStart(10)}${"dislocation%".padStart(14)}${"outcome".padStart(14)}`);
  for (const r of results) {
    if (r.verdict || r.error) {
      console.log(`${r.ticker.padEnd(8)}${r.date.padEnd(12)} ${r.verdict || r.error}`);
      continue;
    }
    console.log(
      `${r.ticker.padEnd(8)}${r.date.padEnd(12)}${String(r.entry_premium).padStart(8)}${String(r.real_mid).padStart(10)}${String(r.dislocation_pct).padStart(14)}${String(r.outcome).padStart(14)}`
    );
  }
  console.log(`\n${severe.length}/${results.length} commits with dislocation >= 20% (achievability ceiling threshold).`);
  if (severe.length > 0) {
    console.log("Severe rows:", severe.map((r) => `${r.ticker} ${r.date} (${r.dislocation_pct}%, ${r.outcome})`).join("; "));
  }
}

main();
