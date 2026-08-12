/**
 * BEAD CADENCE — live contract check.
 *
 * The contract this asserts, stated once so a failure is unambiguous:
 *   - a ticker in the SHARED UNIVERSE gets a bead bucket every 5s, viewer or not;
 *   - a genuinely on-demand (non-universe) ticker gets one every 15s.
 *
 * Measures the rails production actually served — median inter-sample gap over the session — and
 * compares each ticker to the cadence its membership entitles it to.
 *
 * WHY MEDIAN, NOT MEAN OR MIN. A rail has legitimate holes: a provider blip, a cold start, the
 * recorder's own honest-gap semantics when a lens has no walls. The mean is dragged by those and
 * the min flatters (any one lucky pair of adjacent buckets reads 5s). The median is what a member
 * actually sees across the chart.
 *
 * WHY A TOLERANCE BAND. Demanding exactly 5s would fail a healthy system: the recorder buckets to
 * 5s but a sweep landing a few hundred ms late still lands in the NEXT bucket, so a perfectly
 * healthy rail shows the occasional 10s step. The band accepts one skipped bucket and fails on a
 * sustained multiple — which is the difference between jitter and the ~30s regression that
 * prompted this check.
 *
 * HISTORY THIS EXISTS TO PREVENT. The same defect shipped twice (10s on 2026-08-07, ~30s on
 * 2026-08-12), both times found by a member noticing thin beads rather than by us, both times with
 * zero log lines. `evaluateSweepBudget` is the server-side alarm; this is the outside check that
 * does not trust the server's own opinion of itself.
 *
 * Read-only. One temp Clerk user, always released.
 *
 * Run:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/bead-cadence-validate.mjs \
 *     [--tickers=SPX,SPY,NVDA,TSLA] [--nonuniverse=PLTR] [--session=YYYY-MM-DD] [--json]
 */
import { vectorUniverseTickers } from "../../src/lib/heatmap-allowlist.ts";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const BASE = flag("base", "https://blackouttrades.com");
const SESSION = flag("session", new Date().toISOString().slice(0, 10));
const UNIVERSE = new Set(vectorUniverseTickers());

/** Universe names to check. Defaults span the oracle set AND ordinary universe names, because the
 *  whole point is that those two groups should no longer differ. */
const TICKERS = flag("tickers", "SPX,SPY,QQQ,NVDA,TSLA,AMD,META,AAPL")
  .split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
/** Non-universe names — these SHOULD be 15s; a 5s reading here would mean the tiering is gone. */
const NON_UNIVERSE = flag("nonuniverse", "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

const UNIVERSE_TARGET_SEC = 5;
const NON_UNIVERSE_TARGET_SEC = 15;
/** Accept one skipped bucket; fail on a sustained multiple. Jitter vs regression. */
const TOLERANCE_FACTOR = 2.2;
/** Below this many samples the median is not a measurement — say so instead of grading it. */
const MIN_SAMPLES = 20;

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

function medianGapSec(history) {
  const times = history.map((s) => s.time).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0).sort((a, b) => a - b);
  if (gaps.length === 0) return null;
  return gaps[Math.floor(gaps.length / 2)];
}

async function checkTicker(ticker, targetSec, membership) {
  const r = await fetchAuditJson(
    BASE,
    `/api/market/vector/wall-history?ticker=${ticker}&horizon=all&session=${SESSION}`
  );
  const history = r.json?.history;
  if (!r.ok || !Array.isArray(history) || history.length < MIN_SAMPLES) {
    // NOT a pass. A rail too short to measure is exactly what a fully-broken recorder looks like,
    // so calling it "ok" would be the vacuous pass this check exists to avoid.
    note("WARN", `${ticker} (${membership}): only ${history?.length ?? 0} samples — too few to measure (http ${r.status})`);
    return;
  }
  const med = medianGapSec(history);
  const spanMin = Math.round((Math.max(...history.map((s) => s.time)) - Math.min(...history.map((s) => s.time))) / 60);
  const ok = med != null && med <= targetSec * TOLERANCE_FACTOR;
  note(
    ok ? "PASS" : "FAIL",
    `${ticker} (${membership}): median gap ${med}s vs ${targetSec}s target — ${history.length} samples over ${spanMin}min`,
    ok ? undefined : { target: targetSec, measured: med, allowed: targetSec * TOLERANCE_FACTOR }
  );
}

try {
  if (!asJson) console.log(`\nSession ${SESSION} — universe target ${UNIVERSE_TARGET_SEC}s, non-universe ${NON_UNIVERSE_TARGET_SEC}s\n`);
  for (const t of TICKERS) {
    // Grade against what this ticker is ENTITLED to, not against a flat number: a non-universe
    // name in the --tickers list must not be failed for being 15s, which is correct for it.
    const inUniverse = UNIVERSE.has(t);
    await checkTicker(t, inUniverse ? UNIVERSE_TARGET_SEC : NON_UNIVERSE_TARGET_SEC, inUniverse ? "universe" : "on-demand");
  }
  for (const t of NON_UNIVERSE) {
    if (UNIVERSE.has(t)) {
      note("WARN", `${t}: asked to check as non-universe but it IS in the static universe — skipped`);
      continue;
    }
    await checkTicker(t, NON_UNIVERSE_TARGET_SEC, "on-demand");
  }
} finally {
  await releaseAuditClerkSession();
}

const fails = findings.filter((f) => f.level === "FAIL");
const measured = findings.some((f) => /median gap/.test(f.msg));
const verdict = fails.length > 0
  ? `${fails.length} TICKERS OFF CADENCE`
  : measured
    ? "ALL CHECKED TICKERS ON CADENCE"
    : "NO EVIDENCE GATHERED — no rail was long enough to measure; this run proves nothing";
if (asJson) console.log(JSON.stringify({ verdict, fails: fails.length, findings }, null, 2));
else console.log(`\n${"═".repeat(70)}\n${verdict}`);
process.exit(fails.length > 0 || !measured ? 1 : 0);
