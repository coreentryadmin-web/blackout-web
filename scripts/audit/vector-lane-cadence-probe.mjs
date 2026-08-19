/**
 * Which recorder LANE is each ticker actually in, measured rather than assumed.
 *
 * Vector records bead buckets on two lanes: a shared sticky universe at ~5s, and everything else
 * on-demand at ~15s. The roster is dynamic and sticky, so any hard-coded list of "universe tickers"
 * goes stale silently — and comparing a 15s on-demand name against a 5s universe name as if they
 * were the same product is how a working feature gets reported as broken.
 *
 * So this asks the data. For each ticker it reads today's recorded wall-history and reports the
 * MEDIAN gap between consecutive samples, the sample count, the session coverage, and the modeled
 * fraction. The median (not the mean) because a recorder restart or a gap leaves outliers that drag
 * a mean across the 5s/15s boundary and mislabel the lane.
 *
 * A thin trail on an on-demand ticker is NOT a fault — it is the lane working as designed, and this
 * labels it as such instead of flagging it.
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/vector-lane-cadence-probe.mjs \
 *     --tickers=A,B,... [--session=YYYY-MM-DD] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKERS = arg("tickers", "SPX,SPY,NVDA").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const JSON_OUT = argv.includes("--json");

/** ET session date — the chart owns which session it displays, and the API needs it explicitly. */
function etSessionYmd(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
const SESSION = arg("session", etSessionYmd());

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const session = await mintClerkPremiumSession({ appUrl: BASE });
let cookie = session.cookieHeader;
const out = [];

/**
 * Fetch with ONE re-mint on 401.
 *
 * A Clerk session JWT lives ~72s and a 20-ticker sweep runs well past that, so without this the
 * later tickers all return 401 in a few ms — which reads as "those tickers have no rail" when it is
 * purely the harness's own credential expiring. That exact failure produced 12 spurious ERROR rows
 * on the first run of this probe. Re-minting is one FAPI call, well inside the rate limit that
 * makes re-AUTHENTICATING per ticker a bad idea.
 */
async function authedFetch(url) {
  let res = await fetch(url, { headers: { Cookie: cookie } });
  if (res.status === 401) {
    const fresh = await session.refresh?.();
    if (fresh?.cookieHeader) {
      cookie = fresh.cookieHeader;
      res = await fetch(url, { headers: { Cookie: cookie } });
    }
  }
  return res;
}

try {
  for (const ticker of TICKERS) {
    try {
      const res = await authedFetch(
        `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&horizon=all&session=${SESSION}`
      );
      if (!res.ok) { out.push({ ticker, error: `HTTP ${res.status}` }); continue; }
      const history = (await res.json()).history ?? [];
      if (history.length < 2) { out.push({ ticker, samples: history.length, note: "too few samples" }); continue; }

      const times = history.map((h) => h.time).filter(Number.isFinite).sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < times.length; i++) {
        const g = times[i] - times[i - 1];
        if (g > 0) gaps.push(g);
      }
      const medGap = median(gaps);
      const modeled = history.filter((h) => h.modeled).length;
      // Label from the median gap, with a wide band around each nominal cadence: the recorder
      // decimates on read, so the served gap is a floor on the true cadence, not an equality.
      const lane = medGap == null ? "unknown"
        : medGap <= 8 ? "universe(~5s)"
        : medGap <= 25 ? "on-demand(~15s)"
        : `sparse(${medGap}s)`;
      // Rows carried, so a "thin" rail is attributable to the lane rather than to the renderer.
      const strikes = new Set();
      for (const h of history) {
        for (const w of h.walls?.putWalls ?? []) strikes.add(`P${w.strike}`);
        for (const w of h.walls?.callWalls ?? []) strikes.add(`C${w.strike}`);
      }
      out.push({
        ticker, lane, medGapSec: medGap, samples: history.length,
        spanMin: Math.round((times[times.length - 1] - times[0]) / 60),
        modeledPct: history.length ? modeled / history.length : null,
        distinctStrikes: strikes.size,
      });
    } catch (e) {
      out.push({ ticker, error: String(e?.message || e).slice(0, 90) });
    }
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}

if (JSON_OUT) {
  console.log(JSON.stringify({ session: SESSION, rows: out }, null, 2));
} else {
  console.log(`VECTOR RECORDER LANE — session ${SESSION}`);
  console.log("ticker  lane              medGap  samples  spanMin  modeled  strikes");
  for (const r of out) {
    if (r.error) { console.log(`${r.ticker.padEnd(7)} ERROR ${r.error}`); continue; }
    if (r.note) { console.log(`${r.ticker.padEnd(7)} ${r.note} (samples=${r.samples})`); continue; }
    console.log(
      `${r.ticker.padEnd(7)} ${r.lane.padEnd(17)} ${String(r.medGapSec).padStart(5)}s ` +
      `${String(r.samples).padStart(8)} ${String(r.spanMin).padStart(8)} ` +
      `${(r.modeledPct * 100).toFixed(0).padStart(6)}% ${String(r.distinctStrikes).padStart(8)}`
    );
  }
  const lanes = out.filter((r) => r.lane).reduce((m, r) => (m[r.lane] = (m[r.lane] ?? 0) + 1, m), {});
  console.log("");
  console.log(`lane split: ${Object.entries(lanes).map(([k, v]) => `${k}=${v}`).join("  ")}`);
}
