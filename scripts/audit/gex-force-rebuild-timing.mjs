/**
 * GEX matrix `?force=1` REBUILD TIMING — how long a forced recompute actually takes, per ticker.
 *
 * WHY THIS EXISTS: `gexHeatmapForceMaxBlockMs()` (default 55_000, env-overridable via
 * GEX_HEATMAP_FORCE_MAX_BLOCK_MS) is a FAIL-CLOSED deadline — a forced recompute that overruns it
 * gets no stale handoff, it just fails. The 55s figure was chosen against the prod ALB's 120s idle
 * timeout, not against measured rebuild cost, and on 2026-08-13 SPY was observed at 56.7s WARM:
 * over the cap, from a warm cache, on a healthy system. That is a config number set by ceiling
 * rather than by evidence, and a handful of ad-hoc samples is not enough to move it — the tail is
 * the whole question, and it clusters.
 *
 * So: measure. This harness times N forced rebuilds per ticker through ONE long-lived session and
 * reports p50 / p90 / p95 / max plus the fraction that would BREACH a candidate cap, so the env var
 * can be set from a distribution instead of from an anecdote.
 *
 * READ-ONLY w.r.t. member data: `?force=1` triggers a recompute of a cache the product already
 * rebuilds on its own schedule. It writes no ledger, no DB row, no board state.
 *
 * TIMING HONESTY:
 *  - One Clerk temp user for the whole run, deleted in a `finally` (Clerk FAPI rate-limits rapid
 *    sign-in cycles, so re-authenticating per sample would measure the auth path, not the rebuild).
 *  - Requests are SEQUENTIAL. Concurrent forces on the same ticker collapse onto one inflight
 *    rebuild and the second caller measures the first one's tail — which reads as a fast rebuild.
 *  - A `--warmup` pass runs first and is EXCLUDED from the stats: the very first force after a cold
 *    process pays for lazy imports and connection setup that no steady-state request pays.
 *  - Off-hours numbers are a LOWER BOUND, not the RTH p95. The chain is thinner and the upstreams
 *    are idle. The script prints the market phase it ran in so a number can never be quoted as an
 *    RTH measurement when it wasn't one.
 *
 * Usage (from the repo root):
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/gex-force-rebuild-timing.mjs --tickers=SPY,SPX,QQQ,IWM --n=5
 *
 * Flags: --tickers=A,B --n=N --cap=MS --base=URL --warmup / --no-warmup --json
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => args.includes(`--${name}`);

const BASE = (flag("base", "https://blackouttrades.com") || "").replace(/\/$/, "");
const TICKERS = String(flag("tickers", "SPY,SPX,QQQ,IWM"))
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const N = Math.max(1, Number(flag("n", 5)) || 5);
const CAP_MS = Math.max(1000, Number(flag("cap", 55_000)) || 55_000);
const WARMUP = !has("no-warmup");
const JSON_OUT = has("json");

const log = (...a) => {
  if (!JSON_OUT) console.log(...a);
};

/** Percentile by nearest-rank on a sorted ascending array. Returns null for an empty sample. */
function pct(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * Market phase, so an off-hours run can never be quoted as an RTH measurement. Derived from the
 * ET wall clock rather than a provider call — this is a label on the run, not a gate.
 */
function marketPhaseEt(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "weekend";
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins < 4 * 60) return "overnight";
  if (mins < 9 * 60 + 30) return "pre-market";
  if (mins <= 16 * 60) return "RTH";
  if (mins <= 20 * 60) return "after-hours";
  return "overnight";
}

/**
 * Cookie holder that re-mints the session JWT before it dies (~72s), matching the pattern in
 * largo-truth-divergence.mjs.
 *
 * This is not optional bookkeeping. A forced rebuild takes seconds, so a run of any length outlives
 * a single JWT — and the failure is silent in the worst way: the FIRST tickers measure fine and the
 * LAST ones return 401 in ~60ms. Read naively that says "IWM's matrix is broken and fast", when it
 * says nothing about IWM at all. The first version of this script did exactly that and reported
 * QQQ 1/5 and IWM 0/5 on a healthy system.
 */
function makeCookieJar(session) {
  let cookie = session.cookieHeader;
  let mintedAt = Date.now();
  const force = async () => {
    const next = await session.refresh?.().catch(() => null);
    if (next?.cookieHeader) {
      cookie = next.cookieHeader;
      mintedAt = Date.now();
    }
    return cookie;
  };
  return {
    async get() {
      return Date.now() - mintedAt < 45_000 ? cookie : force();
    },
    force,
  };
}

async function timedForce(cookieHeader, ticker) {
  const url = `${BASE}/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}&force=1`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Cookie: cookieHeader, Accept: "application/json" },
    });
    const body = await res.text();
    const ms = Date.now() - started;
    // A 200 that carries no strikes is not a successful rebuild — it is an empty matrix served
    // fast, which would otherwise flatter the distribution with a sub-second "success".
    let strikes = null;
    if (res.ok) {
      try {
        const j = JSON.parse(body);
        strikes = Array.isArray(j?.strikes) ? j.strikes.length : null;
      } catch {
        /* non-JSON body — leave strikes null and let the status speak */
      }
    }
    return { ok: res.ok, status: res.status, ms, strikes };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, strikes: null, error: String(err?.message || err) };
  }
}

async function main() {
  const phase = marketPhaseEt();
  log(`GEX force-rebuild timing — base=${BASE} tickers=${TICKERS.join(",")} n=${N} cap=${CAP_MS}ms`);
  log(`market phase: ${phase}${phase === "RTH" ? "" : "  (LOWER BOUND — not an RTH p95)"}`);

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP — could not mint a session: ${session.reason || "unknown"}`);
    process.exitCode = 1;
    return;
  }

  const jar = makeCookieJar(session);
  const results = {};
  try {
    for (const ticker of TICKERS) {
      if (WARMUP) {
        const w = await timedForce(await jar.get(), ticker);
        log(`  ${ticker} warmup: ${w.ms}ms status=${w.status} (excluded)`);
      }
      const samples = [];
      for (let i = 0; i < N; i++) {
        let r = await timedForce(await jar.get(), ticker);
        // One forced re-mint + retry on a 401: the 45s refresh timer can still lose a race against
        // a token that expired mid-request. A 401 that survives a fresh token is a real auth
        // problem; one that doesn't was never about this endpoint.
        if (r.status === 401 || r.status === 403) {
          const fresh = await jar.force();
          if (fresh) r = { ...(await timedForce(fresh, ticker)), retried_after_auth: true };
        }
        samples.push(r);
        log(
          `  ${ticker} #${i + 1}: ${r.ms}ms status=${r.status}` +
            (r.strikes != null ? ` strikes=${r.strikes}` : "") +
            (r.ms > CAP_MS ? "  ← OVER CAP" : "")
        );
      }
      // Only successful rebuilds carrying real strikes describe rebuild COST. A failure has its
      // own duration (often the cap itself), and averaging it in would report the deadline back
      // as if it were the measurement.
      // AUTH failures are bucketed apart from rebuild failures. A 401 that survives a fresh token
      // says the harness cannot reach the endpoint — it is INCONCLUSIVE about rebuild cost, and
      // counting it as a failed rebuild would blame the product for the probe.
      const authFailed = samples.filter((s) => s.status === 401 || s.status === 403);
      const good = samples.filter((s) => s.ok && (s.strikes ?? 0) > 0);
      const sorted = good.map((s) => s.ms).sort((a, b) => a - b);
      results[ticker] = {
        n: samples.length,
        usable: good.length,
        auth_inconclusive: authFailed.length,
        failed: samples.length - good.length - authFailed.length,
        p50: pct(sorted, 50),
        p90: pct(sorted, 90),
        p95: pct(sorted, 95),
        max: sorted.length ? sorted[sorted.length - 1] : null,
        over_cap: samples.filter((s) => s.ms > CAP_MS).length,
        statuses: samples.map((s) => s.status),
      };
    }
  } finally {
    await session.cleanup?.();
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ base: BASE, phase, cap_ms: CAP_MS, n: N, results }, null, 2));
    return;
  }

  log("");
  log("TICKER   usable  p50      p90      p95      max      over-cap");
  for (const [t, r] of Object.entries(results)) {
    const f = (v) => (v == null ? "     —" : `${String(v).padStart(6)}`);
    log(
      `${t.padEnd(8)} ${String(`${r.usable}/${r.n}`).padEnd(7)}${f(r.p50)}ms ${f(r.p90)}ms ${f(r.p95)}ms ${f(r.max)}ms ${r.over_cap}/${r.n}` +
        (r.auth_inconclusive ? `   (${r.auth_inconclusive} AUTH-inconclusive)` : "")
    );
  }
  log("");
  log(`Cap under test: ${CAP_MS}ms (GEX_HEATMAP_FORCE_MAX_BLOCK_MS). A p95 near or above the cap`);
  log(`means forced recomputes fail closed on a healthy system — raise the cap or shrink the work.`);
  if (phase !== "RTH") {
    log(`NOTE: ran in ${phase}. Re-run during RTH before changing the env var — the chain is`);
    log(`thicker and the upstreams are busy, so these numbers are a floor, not the tail.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
