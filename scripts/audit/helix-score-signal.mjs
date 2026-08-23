#!/usr/bin/env node
/**
 * HELIX conviction-score probe — does `score` separate outcomes at all? (HELIX-MAP.md §9.7)
 *
 * ── THE QUESTION, AND WHY IT WAS STUCK ──────────────────────────────────────────────────────────
 *
 * `score` is `min(60, premium/$1M × 60) + sweep(25) + 0dte(15)`, so every print at or above $1M
 * contributes the same 60 premium points: a $50M block and a $1.1M print are separated only by the
 * two flags. MEASURED off-hours: 24.1% of the tape is pinned at exactly 60. Whether that
 * compression is intended or accidental is UNKNOWN — the score predates this lane's records and no
 * design note explains its shape. The map is explicit: **do not retune it on intuition.**
 *
 * The map names the signal ledger as the only instrument that could answer it. That instrument is
 * currently UN-RUNNABLE: `helix-signal-outcomes` is fully registered in `cron-registry.ts` but
 * absent from the deployed cron manifest (verified 2026-08-23 against blackout-infra), so nothing
 * writes the ledger. This probe takes the other route open to an offline audit — grade each print's
 * own underlying forward on REAL Polygon minute bars.
 *
 * ── WHAT IT MEASURES, AND WHAT IT DOES NOT ──────────────────────────────────────────────────────
 *
 * It asks whether score ranks DIRECTIONAL follow-through in the underlying. Direction comes from
 * option type × aggressor side — the rule `helix-flow-aggression.ts` states and the drilldown
 * already ships — so a sold call counts bearish.
 *
 * It does NOT measure option P&L: no strike, no premium decay, no exit rule. **A flat result is
 * evidence that score does not rank direction; it is NOT proof that score is useless for sizing.**
 * Stated here because the tempting next step after a flat result is to retune the score, and that
 * would be exactly the intuition-driven change the map forbids.
 *
 * Only Group A prints carry a real `event_at`, so only they can be placed in time and graded —
 * ~30% of the tape (§9.0). The probe reports that denominator rather than quietly grading 30% and
 * calling it "the tape".
 *
 * READ-ONLY. One temp Clerk user, deleted before exit. Polygon reads only.
 *
 * Usage:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/helix-score-signal.mjs [--horizon=30] [--max=800] [--json]
 */
// SELF-DEFAULT THE PROVIDER BASE, with the /^https?:/ guard every other harness here carries.
// This sandbox ships `POLYGON_API_BASE` as the literal, unresolved string "POLYGON_API_BASE" — a
// `${{shared.*}}` ref that never expanded (CLAUDE.md, "Environment realities"). A truthiness check
// alone passes it straight through and every bar fetch 404s, which surfaces as "0 rows graded" and
// reads as a data problem rather than a config one. It cost this probe its first run.
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { flowDirection } = await import(`${SRC}features/helix/lib/helix-flow-aggression.ts`);
const { gradeForward, summarizeByBucket, scoreSeparation, partitionGradeable, ungradedTickers } =
  await import("./lib/helix-score-eval.mjs");
const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");

const args = new Map(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? "true"];
}));
const HORIZON_MIN = Number(args.get("horizon") ?? 30);
const MAX_ROWS = Number(args.get("max") ?? 800);
const AS_JSON = args.get("json") === "true";
const BASE = args.get("base") ?? "https://blackouttrades.com";
const CONCURRENCY = 8;

// Index roots do not live in the equity namespace — the tape carries the option root, so SPX/SPXW/
// NDX/RUT/VIX arrive as bare symbols the equity aggs endpoint will not answer.
//
// This used to continue: "in practice they are also Group B (no `event_at`), so they are already
// excluded from the gradeable set before this matters." BOTH HALVES WERE WRONG. SPXW, SPX and RUT
// prints arrive through the `flow_alerts` channel — they are GROUP A and always carried an
// `event_at` — and #2723 retired the `event_at` reasoning outright by giving every row one.
// Measured on the live tape: 160 index-root prints reached the candidate set (SPXW 61, SPY 79,
// SPX 18, RUT 2), of which 81 can never be graded. They inflated the reported `gradeable`
// denominator and spent slots out of the 800-row sample budget on fetches that return nothing.
// They are now excluded UP FRONT and REPORTED — see NON_EQUITY_ROOTS / partitionGradeable.
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

const barCache = new Map();
async function barsFor(ticker, dayYmd) {
  const key = `${ticker}:${dayYmd}`;
  if (barCache.has(key)) return barCache.get(key);
  const p = (async () => {
    try {
      // `fetchAggBars` is the shared reader every other offline grader here uses — same endpoint,
      // same auth, one code path to keep working.
      return await fetchAggBars(ticker, 1, "minute", dayYmd, dayYmd, "5000");
    } catch {
      return null; // an unfetchable ticker is UNGRADED, never a zero-return row
    }
  })();
  barCache.set(key, p);
  return p;
}

/** Closest bar at or after `ms`, within `toleranceMin`. Null rather than the nearest-at-any-distance
 *  bar: a "price" taken 90 minutes from the timestamp it claims is not a measurement. */
function barAt(bars, ms, toleranceMin = 10) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const tol = toleranceMin * 60_000;
  let best = null, bestGap = Infinity;
  for (const b of bars) {
    const t = Number(b.t ?? b.timestamp);
    if (!Number.isFinite(t)) continue;
    const gap = Math.abs(t - ms);
    if (gap < bestGap) { bestGap = gap; best = b; }
  }
  if (!best || bestGap > tol) return null;
  const c = Number(best.c ?? best.close);
  return Number.isFinite(c) && c > 0 ? c : null;
}

/** Bounded-concurrency map, preserving input order. `fn` takes the ITEM only — the index was passed
 *  too and no caller ever used it, which CodeQL correctly flagged as a superfluous argument
 *  (alert 759). Speculative generality in a one-call-site helper is just an unused parameter. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

(async () => {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  try {
    const res = await fetch(`${BASE}/api/market/flows?limit=5000&hours=168`, {
      headers: { Cookie: session.cookieHeader },
    });
    const body = await res.json();
    const all = Array.isArray(body) ? body : (body.flows ?? body.alerts ?? body.data ?? []);

    // Gradeable = has a REAL print time (Group A) AND a direction we can read AND a numeric score.
    const candidates = all.filter((r) => {
      if (!r.event_at) return false;
      const t = Date.parse(r.event_at);
      if (!Number.isFinite(t)) return false;
      if (typeof r.score !== "number" || !Number.isFinite(r.score)) return false;
      return flowDirection(r) !== "undetermined";
    });

    // Drop what the equity aggs endpoint structurally cannot price, BEFORE the sample is taken.
    // Doing it here rather than letting the fetch fail is what keeps the reported denominator
    // honest: an ungradeable row in `candidates` is a row counted as gradeable, and it also eats a
    // slot out of MAX_ROWS that a gradeable print could have used.
    const part = partitionGradeable(candidates);
    const sample = part.gradeable.slice(0, MAX_ROWS);
    const graded = await mapLimit(sample, CONCURRENCY, async (r) => {
      const t = Date.parse(r.event_at);
      const bars = await barsFor(r.ticker, ymd(t));
      const entry = barAt(bars, t);
      const exit = barAt(bars, t + HORIZON_MIN * 60_000);
      return {
        ticker: r.ticker, score: r.score, premium: r.premium,
        direction: flowDirection(r),
        graded: entry != null && exit != null ? gradeForward(flowDirection(r), entry, exit) : null,
      };
    });

    const gradedCount = graded.filter((g) => g.graded).length;
    const summary = summarizeByBucket(graded);
    const sep = scoreSeparation(summary);

    if (AS_JSON) {
      console.log(JSON.stringify({
        horizon_min: HORIZON_MIN, tape: all.length,
        candidates: candidates.length,
        excluded_non_equity: part.excludedCount,
        excluded_by_ticker: part.excludedByTicker,
        gradeable: part.gradeable.length,
        sampled: sample.length, graded: gradedCount,
        ungraded_tickers: ungradedTickers(graded),
        summary, separation: sep,
      }, null, 2));
    } else {
      console.log(`\n=== HELIX SCORE vs FORWARD MOVE — §9.7 ===`);
      console.log(`horizon +${HORIZON_MIN}min · tape ${all.length} rows`);
      console.log(`candidates (real event_at + readable direction + numeric score): ${candidates.length} (${(candidates.length / all.length * 100).toFixed(1)}%)`);
      if (part.excludedCount > 0) {
        // Named, never a bare count: "81 excluded" invites the reader to assume noise.
        const names = part.excludedByTicker.map(([t, n]) => `${t} ${n}`).join(", ");
        console.log(`  minus ${part.excludedCount} on roots the equity aggs endpoint cannot price (${names})`);
      }
      console.log(`gradeable: ${part.gradeable.length} · sampled ${sample.length} · actually graded on bars ${gradedCount}`);
      // Backstop for NON_EQUITY_ROOTS being incomplete: a root nobody listed still fetches nothing,
      // and would otherwise just shrink the graded count in a way that reads as thin data.
      const dead = ungradedTickers(graded);
      if (dead.length) {
        console.log(`  !! ${dead.length} ticker(s) graded ZERO of their prints — ${dead.map((d) => `${d.ticker} (${d.prints})`).join(", ")}`);
        console.log(`     an unlisted non-equity root looks exactly like this; check before reading the buckets.`);
      }
      console.log(`\n  bucket             n     win%    avg fav%   avg premium`);
      for (const b of summary) {
        console.log(`  ${b.bucket.padEnd(16)} ${String(b.n).padStart(4)}   ${b.winRate.toFixed(1).padStart(5)}%  ${b.avgFavorablePct.toFixed(3).padStart(8)}%   $${Math.round(b.avgPremium).toLocaleString().padStart(12)}`);
      }
      console.log(`\nVERDICT: ${sep.verdict}` + (sep.spreadPp != null
        ? ` — spread ${sep.spreadPp.toFixed(1)}pp (best ${sep.best.bucket} ${sep.best.winRate.toFixed(1)}% vs worst ${sep.worst.bucket} ${sep.worst.winRate.toFixed(1)}%), rank correlation rho=${sep.rho.toFixed(2)}`
        : ""));
      if (sep.verdict === "SPREAD WITHOUT ORDER") {
        console.log(`  Buckets DIFFER but do not TREND with the score — a mid or low bucket outperforms`);
        console.log(`  a high one. That is what noise looks like, not a ranking.`);
      }
      if (sep.excluded?.length) console.log(`buckets excluded as too thin (n<30): ${sep.excluded.join(", ")}`);
      console.log(`\nScope: measures whether score ranks DIRECTIONAL follow-through in the underlying.`);
      console.log(`It does NOT measure option P&L — no strike, no decay, no exit rule. A flat result`);
      console.log(`is evidence score does not rank direction, NOT proof it is useless for sizing.`);
    }
  } finally {
    await session.cleanup?.();
    console.log("temp Clerk user released");
  }
})().catch((e) => { console.error("PROBE ERROR:", e.message); process.exitCode = 1; });
