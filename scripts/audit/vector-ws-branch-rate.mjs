/**
 * Which source is Vector actually serving walls from — the UW WebSocket ladder, or the Polygon
 * REST chain?
 *
 * WHY THIS IS INDIRECT. `getVectorGexWalls` picks its branch in-process:
 *
 *     if (hasLiveGexStrikeExpiry(t)) -> computeGexWalls(getGexStrikeExpiryLadder(t, expiries))
 *     else                           -> computeGexWalls(fallbackStrikeTotals)   // Polygon REST
 *
 * Nothing in the response says which one ran, `/api/worker/ready` is gated to the ingest role (404
 * from the web ALB), and the sandbox cannot open a WebSocket at all. So this infers the branch from
 * OUTPUT rather than instrumenting the process:
 *
 *   - `/api/market/vector/walls`  -> whatever branch getVectorGexWalls took
 *   - `/api/market/gex-heatmap`   -> `gex.strike_totals`, the raw POLYGON REST ladder
 *
 * Recompute the walls from the REST strike_totals with the SAME production function Vector uses,
 * then compare:
 *
 *   walls DIFFER from the REST-derived pair  -> Vector served the WS ladder
 *   walls MATCH the REST-derived pair        -> Vector served the REST fallback (or the two sources
 *                                               happen to agree, which is reported separately as
 *                                               INDETERMINATE rather than counted as REST)
 *
 * The agreement case is genuinely ambiguous and is NOT scored as a REST hit. Two independent
 * sources agreeing on the dominant strike is the expected outcome when both are healthy, so
 * counting it as REST would understate WS coverage exactly when the system is working best.
 *
 * OFF-HOURS THIS MEASURES NOTHING USEFUL. uw-socket's own comment: the GEX and flow channels "go
 * quiet off-hours but that's expected silence". `hasLiveGexStrikeExpiry` gates on data freshness,
 * so outside RTH every ticker legitimately falls to REST. Run it during a live session; the
 * off-hours run is only good for proving the method works and for establishing the floor.
 *
 * Read-only. One temp Clerk member, deleted in a finally. The session JWT dies ~72s after issue
 * (measured), so the ticker list is kept small enough to finish inside that window and the run
 * reports its own auth failures rather than silently scoring them as REST.
 *
 * Run: node --import tsx scripts/audit/vector-ws-branch-rate.mjs [--tickers=SPX,SPY,...] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { computeGexWalls } from "../../src/lib/providers/gex-wall-levels.ts";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKERS = arg("tickers", "SPX,SPY,QQQ,NVDA,TSLA,AAPL").split(",").filter(Boolean);
const AS_JSON = argv.includes("--json");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Same shape conversion the server does before computeGexWalls. */
function toLadder(strikeTotals) {
  return new Map(
    Object.entries(strikeTotals ?? {})
      .map(([k, v]) => [Number(k), Number(v)])
      .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v))
  );
}

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  console.error(`SKIP: ${session.reason}`);
  process.exit(2);
}

const rows = [];
let unauthorized = 0;

try {
  for (const ticker of TICKERS) {
    const t = encodeURIComponent(ticker);
    const [wallsRes, heatRes] = await Promise.all([
      fetch(`${BASE}/api/market/vector/walls?ticker=${t}&dte=all`, { headers: { Cookie: session.cookieHeader } }),
      fetch(`${BASE}/api/market/gex-heatmap?ticker=${t}`, { headers: { Cookie: session.cookieHeader } }),
    ]);
    if (wallsRes.status === 401 || heatRes.status === 401) {
      unauthorized++;
      rows.push({ ticker, verdict: "AUTH-EXPIRED" });
      continue;
    }
    if (!wallsRes.ok || !heatRes.ok) {
      rows.push({ ticker, verdict: "HTTP-ERROR", detail: `walls ${wallsRes.status} / heatmap ${heatRes.status}` });
      continue;
    }
    const walls = await wallsRes.json();
    const heat = await heatRes.json();

    const served = {
      call: num(walls?.walls?.callWalls?.[0]?.strike),
      put: num(walls?.walls?.putWalls?.[0]?.strike),
    };
    const restLadder = toLadder(heat?.gex?.strike_totals);
    const restWalls = restLadder.size ? computeGexWalls(restLadder) : null;
    const rest = {
      call: num(restWalls?.callWalls?.[0]?.strike),
      put: num(restWalls?.putWalls?.[0]?.strike),
    };

    // The heatmap route applies its OWN WS override to gex.call_wall/put_wall while leaving
    // strike_totals as the raw Polygon ladder — so a mismatch between those two is independent
    // evidence that the WS feed is live for this ticker.
    const routeWall = { call: num(heat?.gex?.call_wall), put: num(heat?.gex?.put_wall) };
    const routeOverrode =
      routeWall.call != null && rest.call != null
        ? routeWall.call !== rest.call || routeWall.put !== rest.put
        : null;

    let verdict;
    if (served.call == null || rest.call == null) verdict = "NO-DATA";
    else if (served.call !== rest.call || served.put !== rest.put) verdict = "WS";
    else verdict = "INDETERMINATE"; // identical — REST fallback, or both sources simply agree

    rows.push({ ticker, verdict, served, rest, routeWall, routeOverrode });
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}

const tally = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {});

if (AS_JSON) {
  console.log(JSON.stringify({ base: BASE, rows, tally }, null, 2));
} else {
  console.log(`\n=== VECTOR WALL SOURCE — WS ladder vs Polygon REST @ ${BASE}\n`);
  for (const r of rows) {
    if (r.verdict === "AUTH-EXPIRED" || r.verdict === "HTTP-ERROR") {
      console.log(`  ${r.verdict.padEnd(14)} ${r.ticker}${r.detail ? ` — ${r.detail}` : ""}`);
      continue;
    }
    const o = r.routeOverrode === true ? "route-override:YES" : r.routeOverrode === false ? "route-override:no " : "route-override:?  ";
    console.log(
      `  ${r.verdict.padEnd(14)} ${r.ticker.padEnd(5)} served=${r.served.call}/${r.served.put}` +
        `  rest=${r.rest.call}/${r.rest.put}  ${o}`
    );
  }
  console.log(`\ntally: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  const scored = (tally.WS ?? 0) + (tally.INDETERMINATE ?? 0);
  if (scored > 0) {
    console.log(`WS-confirmed: ${tally.WS ?? 0}/${scored} (${(((tally.WS ?? 0) / scored) * 100).toFixed(0)}%)`);
  }
  console.log(
    "\nINDETERMINATE = served walls identical to the REST-derived pair. That is the REST fallback\n" +
      "OR two healthy sources agreeing; this cannot tell them apart from outside, so it is not\n" +
      "scored as REST. Off-hours the UW GEX channel is quiet by design, so a 0% WS reading here\n" +
      "says nothing about a live session — re-run during RTH."
  );
}

// Auth expiry invalidates the run rather than lowering the score.
process.exit(unauthorized > 0 ? 2 : 0);
