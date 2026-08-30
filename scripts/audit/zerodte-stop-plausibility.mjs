/**
 * 0DTE STOP-EXIT PLAUSIBILITY CHECK — live evidence-gathering harness.
 *
 * WHY THIS EXISTS. Live, 2026-08-27, in response to the direct question "why do we have losers
 * and can we make the system stronger": NVDA's hard stop (-52.9% vs a ~-50% plan stop) is normal
 * slippage, but QQQ's (-77.06% vs the same ~-50%) fired 0.357s after the play was flagged, while
 * QQQ's own 1-minute bars for that exact window show it trading in a 0.15% range. A 0.15%
 * underlying move cannot legitimately reprice a 0DTE option -77% in a third of a second — this
 * looks like the system reacting to a single bad/erroneous quote tick and locking in a phantom
 * loss, not a real market outcome. `evaluateLedgerRowExit` (src/lib/zerodte/exit-sync.ts) treats
 * any fresh mark as authoritative for a stop with no plausibility check against the underlying's
 * own concurrent move.
 *
 * This is a MEASUREMENT tool, not a fix — matching this repo's calibration-first convention (see
 * gex-depth-validate.mjs, discovery-recall-probe.mjs): before adding any guard to live exit logic,
 * measure how often this actually happens and how severe it is, so a threshold comes from a real
 * distribution instead of a single incident. Pure verdict logic lives in
 * lib/stop-plausibility-eval.mjs (unit-tested); this script is only IO — fetch the ledger, fetch
 * the underlying's bars, evaluate.
 *
 * Read-only. One temp Clerk user for the board fetch, deleted in a `finally`. Polygon for
 * underlying bars — self-defaults POLYGON_API_BASE like every other script here.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
 *     scripts/audit/zerodte-stop-plausibility.mjs [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { evaluateStopPlausibility } from "./lib/stop-plausibility-eval.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");

const APP_BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const POLYGON_KEY = process.env.POLYGON_API_KEY;
const RAW_POLY_BASE = process.env.POLYGON_API_BASE;
const POLYGON_BASE = /^https?:/.test(RAW_POLY_BASE ?? "") ? RAW_POLY_BASE : "https://api.massive.com";

/** (high-low)/open * 100 across every 1-minute bar overlapping [fromMs, toMs], with a small
 *  buffer on each side so a sub-minute window still lands inside at least one bar. Returns null
 *  (never 0) when no bars cover the window, so "no data" can never read as "no move". */
async function underlyingMovePct(ticker, fromMs, toMs) {
  const day = new Date(fromMs).toISOString().slice(0, 10);
  const url =
    `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${day}/${day}` +
    `?adjusted=true&sort=asc&limit=1000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const bufferMs = 60_000;
  const rows = (data?.results ?? []).filter((r) => r.t >= fromMs - bufferMs && r.t <= toMs + bufferMs);
  if (rows.length === 0) return null;
  const open = rows[0].o;
  if (!(open > 0)) return null;
  const high = Math.max(...rows.map((r) => r.h));
  const low = Math.min(...rows.map((r) => r.l));
  return ((high - low) / open) * 100;
}

async function main() {
  if (!POLYGON_KEY) {
    console.error("POLYGON_API_KEY not set");
    process.exit(1);
  }
  const session = await mintClerkPremiumSession({ appUrl: APP_BASE });
  if (session.skip) {
    console.error("SKIP:", session.reason);
    process.exit(0);
  }
  try {
    const res = await fetch(`${APP_BASE}/api/market/zerodte/board`, {
      headers: { Cookie: session.cookieHeader, Accept: "application/json" },
    });
    const board = await res.json().catch(() => null);
    const ledger = board?.ledger ?? [];
    const stops = ledger.filter((r) => r.exit_reason === "stop" && r.status === "CLOSED");

    const results = [];
    for (const row of stops) {
      const flagMs = Date.parse(row.first_flagged_at);
      const exitMs = row.exit_at ? Date.parse(row.exit_at) : NaN;
      let move = null;
      if (Number.isFinite(flagMs) && Number.isFinite(exitMs)) {
        move = await underlyingMovePct(row.ticker, flagMs, exitMs).catch(() => null);
      }
      const verdict = evaluateStopPlausibility(row, move);
      results.push({ ticker: row.ticker, direction: row.direction, exit_pnl_pct: row.exit_pnl_pct, underlying_move_pct: move, ...verdict });
    }

    if (asJson) {
      console.log(JSON.stringify({ total_stops: stops.length, suspect_count: results.filter((r) => r.suspect).length, results }, null, 2));
    } else {
      console.log(`\n=== 0DTE STOP-EXIT PLAUSIBILITY — ${stops.length} stop(s) checked ===\n`);
      for (const r of results) {
        const tag = r.suspect ? "SUSPECT" : "clean  ";
        console.log(
          `${tag}  ${r.ticker.padEnd(6)} ${r.direction.padEnd(6)} exit=${r.exit_pnl_pct}%  underlying_move=${r.underlying_move_pct == null ? "n/a" : r.underlying_move_pct.toFixed(2) + "%"}  ${r.reason}`
        );
      }
      const suspectCount = results.filter((r) => r.suspect).length;
      console.log(`\n${suspectCount}/${stops.length} flagged SUSPECT (implausible given the underlying's own move).`);
    }
    process.exitCode = results.some((r) => r.suspect) ? 1 : 0;
  } finally {
    await session.cleanup();
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
