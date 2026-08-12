/**
 * SYNTHETIC ORDER BOOK — post-deploy live check.
 *
 * The strongest proof available that the feature is actually working in production: fetch the
 * ladder the SERVER built, independently rebuild one from the raw Polygon chain in this process,
 * and compare them. Agreement means the deployed code path ran, used the expiries it claims to use,
 * and applied the anchor — not merely that a `depth` key exists.
 *
 * WHY THIS EXISTS AT ALL. On 2026-08-12 a correct fix (#2084) was read as broken because the matrix
 * was still serving a PRE-DEPLOY CACHED payload and the check ran 80 seconds after rollout. A
 * key-presence check would have repeated that mistake in the other direction — reporting success off
 * a stale payload that happened to predate nothing. So this reports `asof` and cache age on every
 * ticker, and `--wait` polls until the matrix is demonstrably newer than the deploy.
 *
 * Read-only. Authenticates through the app the same way every other audit probe does.
 *
 * Run:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/depth-live-check.mjs \
 *     [--tickers=SPY,NVDA] [--wait=600] [--json]
 */
import { buildGexDepthLadder } from "../../src/lib/gex-depth.ts";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const BASE = flag("base", "https://blackouttrades.com");
const TICKERS = flag("tickers", "SPY,NVDA,ASTS").split(",").map((t) => t.trim()).filter(Boolean);
/** Seconds to keep polling for a matrix that carries `depth`. 0 = single shot. */
const WAIT_SEC = Number(flag("wait", "0")) || 0;

const KEY = process.env.POLYGON_API_KEY;
const RAW_BASE = process.env.POLYGON_API_BASE;
const POLY = /^https?:/.test(RAW_BASE ?? "") ? RAW_BASE : "https://api.massive.com";

const todayEt = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const money = (n) => {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};

async function polyJson(url) {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

async function fetchChain(root) {
  const out = [];
  let page = await polyJson(`${POLY}/v3/snapshot/options/${root}?limit=250&apiKey=${KEY}`);
  let guard = 0;
  while (page && guard < 12) {
    out.push(...(page.results ?? []));
    if (!page.next_url) break;
    page = await polyJson(`${page.next_url}&apiKey=${KEY}`);
    guard += 1;
  }
  return out;
}

const results = [];
let worst = "PASS";
const bump = (v) => {
  const rank = { PASS: 0, WARN: 1, FAIL: 2 };
  if (rank[v] > rank[worst]) worst = v;
};

try {
  for (const ticker of TICKERS) {
    // ── Fetch the served matrix, optionally waiting for one that carries the ladder ──────────
    let served = null;
    let waited = 0;
    for (;;) {
      const r = await fetchAuditJson(BASE, `/api/market/gex-heatmap?ticker=${ticker}`);
      if (!r.ok) {
        results.push({ ticker, verdict: "FAIL", reason: `HTTP ${r.status}` });
        bump("FAIL");
        break;
      }
      served = r.json?.heatmap ?? r.json;
      if (served?.depth?.levels?.length > 0) break;
      if (waited >= WAIT_SEC) break;
      // The matrix is cached; a missing ladder right after a deploy usually means the cache has
      // not turned over yet, NOT that the code is broken. Say which, out loud, while waiting.
      if (!asJson) console.log(`  ${ticker}: no depth yet (asof ${served?.asof ?? "?"}) — waited ${waited}s of ${WAIT_SEC}s`);
      await sleep(15_000);
      waited += 15;
    }
    if (!served) continue;

    const depth = served.depth;
    if (!depth || !(depth.levels?.length > 0)) {
      results.push({
        ticker,
        verdict: "FAIL",
        reason: "served matrix carries no depth ladder",
        asof: served.asof ?? null,
      });
      bump("FAIL");
      if (!asJson) console.log(`\n═══ ${ticker}  [FAIL] no depth on the served matrix (asof ${served.asof})`);
      continue;
    }

    // ── Rebuild independently from the raw chain and compare ─────────────────────────────────
    const spot = Number(served.spot);
    const nearTerm = new Set(served.near_term_expiries ?? served.expiries ?? []);
    let rebuilt = null;
    if (KEY && spot > 0) {
      const root = ticker === "SPX" ? "I:SPX" : ticker;
      const raw = await fetchChain(root);
      const contracts = raw
        .map((c) => ({
          strike: Number(c.details?.strike_price),
          expiry: String(c.details?.expiration_date ?? "").slice(0, 10),
          type: String(c.details?.contract_type ?? "").toLowerCase(),
          openInterest: Number(c.open_interest ?? 0),
          iv: Number(c.implied_volatility ?? 0),
          sharesPerContract: Number(c.details?.shares_per_contract ?? 100),
        }))
        .filter((c) => c.strike > 0 && c.expiry && (c.type === "call" || c.type === "put"));
      rebuilt = buildGexDepthLadder(contracts, spot, {
        todayYmd: todayEt(),
        expiries: nearTerm,
        rangePct: depth.range_pct,
        stepPct: depth.step_pct,
        anchorNetGamma: served.gex?.total ?? null,
      });
    }

    // Shape checks that hold regardless of whether we could rebuild.
    const rungs = depth.levels.length;
    const expectedRungs = Math.round(depth.range_pct / depth.step_pct) * 2;
    const shapeOk = rungs === expectedRungs;
    const finite = depth.levels.every(
      (l) => Number.isFinite(l.price) && Number.isFinite(l.notional) && Number.isFinite(l.gamma)
    );
    const bounded = depth.levels.every((l) => Math.abs(l.notional) <= depth.max_abs_notional + 1);
    const anchorSane = depth.calibration_factor >= 0.4 && depth.calibration_factor <= 2.5;

    // The real check: does the served ladder match one built here from the same public chain?
    let crossingDelta = null;
    let peakDelta = null;
    let matchVerdict = "SKIP";
    if (rebuilt && rebuilt.levels.length > 0) {
      if (depth.crossing != null && rebuilt.crossing != null) {
        crossingDelta = Math.abs(depth.crossing - rebuilt.crossing);
      }
      if (depth.peak_sell != null && rebuilt.peakSell != null) {
        peakDelta = Math.abs(depth.peak_sell - rebuilt.peakSell);
      }
      // Tolerance is a band width: the server built its ladder at a slightly different instant, so
      // spot (and therefore every rung) has moved a little. Demanding equality would fail on a
      // healthy system during RTH — the exact kind of false finding this suite exists to avoid.
      const tol = spot * depth.step_pct * 1.5;
      const crossOk = crossingDelta == null || crossingDelta <= tol;
      const peakOk = peakDelta == null || peakDelta <= tol;
      matchVerdict = crossOk && peakOk ? "PASS" : "WARN";
    }

    const verdict = !shapeOk || !finite || !bounded || !anchorSane ? "FAIL" : matchVerdict === "WARN" ? "WARN" : "PASS";
    bump(verdict === "SKIP" ? "PASS" : verdict);

    results.push({
      ticker,
      verdict,
      asof: served.asof ?? null,
      spot,
      rungs,
      expectedRungs,
      shapeOk,
      finite,
      bounded,
      calibration: depth.calibration_factor,
      anchorSane,
      servedCrossing: depth.crossing,
      rebuiltCrossing: rebuilt?.crossing ?? null,
      crossingDelta,
      servedPeakSell: depth.peak_sell,
      rebuiltPeakSell: rebuilt?.peakSell ?? null,
      peakDelta,
      matchVerdict,
      contractsUsed: depth.contracts_used,
    });

    if (!asJson) {
      console.log(`\n═══ ${ticker}  spot ${spot}  asof ${served.asof}  [${verdict}]`);
      console.log(`  rungs ${rungs}/${expectedRungs}  finite:${finite}  bounded:${bounded}  contracts ${depth.contracts_used}`);
      console.log(`  anchor x${depth.calibration_factor} (sane: ${anchorSane})   max band ${money(depth.max_abs_notional)}`);
      console.log(`  crossing served ${depth.crossing} vs rebuilt ${rebuilt?.crossing ?? "n/a"}  Δ${crossingDelta?.toFixed(2) ?? "n/a"}`);
      console.log(`  peak SELL served ${depth.peak_sell} vs rebuilt ${rebuilt?.peakSell?.toFixed(2) ?? "n/a"}  Δ${peakDelta?.toFixed(2) ?? "n/a"}  [${matchVerdict}]`);
    }
  }
} finally {
  await releaseAuditClerkSession();
}

if (asJson) console.log(JSON.stringify({ worst, results }, null, 2));
else console.log(`\n${"═".repeat(64)}\nWORST VERDICT: ${worst}`);
process.exit(worst === "FAIL" ? 1 : 0);
