#!/usr/bin/env node
/**
 * BREAKOUT `gain_over_range` ranking — REAL COMMITTED OPTION P&L validation, at last runnable
 * against live data.
 *
 * WHY THIS EXISTS (docs/audit/findings-staging/2026-09-08-breakout-ranking-gain-over-range-
 * shipped-status-correction.md; original measurement FINDINGS.md 2026-08-07). The 2026-08-07
 * finding measured `gain_over_range` beating the shipped `momentum` ranking on an UNDERLYING-
 * CONTINUATION PROXY (+11.3pt discovery / +15.7pt held-out, Bonferroni-surviving over 8 orderings,
 * 5,843 graded names across two disjoint windows) and explicitly recommended, before shipping
 * unconditionally: "Re-rank with gain_over_range behind a flag and A/B it on real committed 0DTE
 * plays over >=20 sessions, measuring realised option P&L rather than the underlying proxy" —
 * because the proxy grades the UNDERLYING's favorable-first continuation, not option P&L, and
 * does not model contract-build failure, spread, or the gates downstream of ranking.
 *
 * What shipped (PR #2846, merged 2026-08-25, commit 8be0a45c7) was a direct, unconditional
 * replacement of `rankMoversForChainFetch`'s ordering key — no flag, no A/B scaffold. So the
 * originally-recommended validation never ran. It has now been live 15+ trading days, so this
 * script runs it retrospectively against real committed plays instead of a live flag.
 *
 * METHOD — two parts, both against REAL data, neither against the underlying proxy:
 *
 * PART A (directly observed). Pull every real committed BREAKOUT-origin 0DTE play since
 * 2026-08-25 via `GET /api/admin/zerodte/tier-export` (this route's `discovery_origin` field is
 * new — see the PR this ships alongside — added the same way `entry_premium`/`top_strike`/
 * `expiry` were added for the C-tier/untiered exit-mode A/B: the public `/record` route only
 * returns aggregates, and the field already lives in `entry_context` but nothing forwarded it).
 * Report the REAL, already-graded option P&L (`stored_executable_pnl_pct`/`stored_executable_
 * outcome` — the official WS-10/WS-11 executable grade — preferred over the raw mechanical
 * `plan_pnl_pct`/`plan_outcome` when present, same "official overrides mid" precedent as
 * `outcome-grading-audit.mjs`). This alone answers "how has the ranking that's actually live
 * performed on real money" — no reconstruction needed, because production already grades every
 * committed play against the option's own historical minute bars.
 *
 * PART B (counterfactual split — did the SPECIFIC picks gain_over_range makes that momentum
 * would not have, help or hurt?). For each committed play's session date, re-screen that
 * historical day with the REAL `screenBreakoutMovers`/`screenBreakdownMovers` (grouped-daily bars
 * are permanent Polygon history, so this reproduces exactly what the live screen saw that day),
 * compute the REAL per-day dynamic cap (`resolveBreakoutCandidateCap`, same qualifying-pool
 * formula production uses), then run the shared, already-tested `splitBreakoutCohorts` helper
 * (`lib/breakout-cohort-split.mjs`, built for the 2026-08-06 recall/dynamic-N corrections) TWICE
 * over the identical pool: once with the REAL, imported, currently-shipped `rankMoversForChainFetch`
 * (gain_over_range) and once with a locally-defined `momentumRank` that replicates the ranking IT
 * REPLACED (`gain * close_strength`, tie-break $-volume — byte-identical to the `momentum` key in
 * `breakout-ranking-signal.mjs`, the tool that produced the original 2026-08-07 numbers). A
 * committed ticker that clears BOTH orderings' cap slice would have been picked either way — the
 * ranking swap is not what put it on the board. A ticker that clears ONLY gain_over_range's cap
 * is a play that EXISTS ONLY BECAUSE OF THE SWAP: split real graded P&L by this partition and the
 * comparison is exactly "did production's actual, unconditional ranking change help or hurt, in
 * real option P&L, for the specific plays it is responsible for."
 *
 * WHAT'S REAL vs WHAT'S APPROXIMATED (honesty, per repo convention):
 *   REAL: screenBreakoutMovers/screenBreakdownMovers, resolveBreakoutCandidateCap, the shipped
 *     rankMoversForChainFetch, splitBreakoutCohorts (all imported/used verbatim, never
 *     reimplemented) — fed REAL historical Polygon grouped-daily bars for the exact session date.
 *     Every committed play's own REAL, already-graded option P&L (production's own grader, run
 *     against the contract's own historical minute bars at commit time — not reproduced here).
 *   APPROXIMATED / RE-IMPLEMENTED (deliberately, disclosed): `momentumRank` — the ranking PR #2846
 *     replaced no longer exists in `src/`, so it is re-implemented here from the original finding's
 *     own recorded formula, not imported. `splitBreakoutCohorts`'s own documented modelling choice
 *     applies to BOTH orderings equally here (it models "every ranked name successfully builds a
 *     contract", i.e. rank-vs-cap as the KEPT/DROPPED line, not a real chain-fetch walk — see that
 *     module's header) — this is the SAME simplification `discovery-recall-probe.mjs` and
 *     `breakout-dynamic-n-ab.mjs` already use as their standard split, so this is methodologically
 *     consistent with prior art in this repo, not a new approximation invented for this script.
 *     Cap sizing uses TODAY's `BREAKOUT_MAX_CANDIDATES_CEILING`/`BREAKOUT_SCREEN_POOL` constants for
 *     every historical date in the window, even though both were raised again on 2026-09-08 (150->
 *     220, 200->280) partway through the 2026-08-25-to-now window this script covers — disclosed,
 *     not hidden; it can only make the reconstructed cap slightly WIDER than the live cap was on
 *     dates before 2026-09-08, i.e. slightly MORE names read as "would have cleared under momentum
 *     too" than the historical live cap actually admitted, which understates rather than overstates
 *     gain_over_range's exclusive contribution.
 *   NOT MEASURED: whether a GAIN_OVER_RANGE_EXCLUSIVE ticker would have actually BUILT a contract
 *     under the OLD ranking's chain-fetch order on that historical day (needs a historical option
 *     chain with historical liquidity, which isn't reliably reconstructable offline) — this script
 *     answers "would the old ranking have prioritized fetching a chain for this name at all", not
 *     "would it have definitely built one". A ticker landing in MOMENTUM_ALSO is the strong claim
 *     (old ranking would rank-order it into the attempt pool too); GAIN_OVER_RANGE_EXCLUSIVE is the
 *     claim that matters for the original question (a play that would NOT have been prioritized
 *     under the old ranking, so its real P&L is the ranking swap's own doing).
 *
 * DATA SOURCE: `GET /api/admin/zerodte/tier-export` via `scripts/audit/lib/audit-auth-fetch.mjs`
 * (cron-bearer first, Clerk admin+premium fallback, temp user always released). READ-ONLY, no
 * writes, no gate touched. Polygon grouped-daily is unauthenticated history (POLYGON_API_KEY only).
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/breakout-gain-over-range-option-pnl-ab.mjs \
 *        [--since=2026-08-25] [--base=https://blackouttrades.com] [--min-n=15] [--json]
 *
 * `--since` defaults to 2026-08-25 (the day PR #2846 merged). Reports the real result honestly —
 * below `--min-n` real plays reconciled, the numbers still print but are flagged THIN SAMPLE rather
 * than refused, per the task's own instruction that an honest "directionally consistent but n too
 * small" beats an overstated conclusion. Changes NO gate/ranking — evidence, not a switch, same
 * discipline as every other A/B in this toolkit.
 */

// ── Env guard: this sandbox ships POLYGON_API_BASE as an unresolved placeholder string; every
//    dynamic import below must see a resolved URL before any provider module evaluates it.
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { splitBreakoutCohorts, productionScreenPool } from "./lib/breakout-cohort-split.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const { screenBreakoutMovers, screenBreakdownMovers } = await import(
  `${SRC}features/nighthawk/lib/candidates.ts`
);
const {
  rankMoversForChainFetch, // REAL, currently-shipped ranking (gain_over_range) — never reimplemented.
  BREAKOUT_MAX_CANDIDATES,
  BREAKOUT_MAX_CANDIDATES_CEILING,
  BREAKOUT_SCREEN_POOL,
} = await import(`${SRC}lib/zerodte/breakout-discovery.ts`);
const { resolveBreakoutCandidateCap } = await import(`${SRC}lib/zerodte/breakout-cap.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const BASE = String(argv.base ?? process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const SINCE = String(argv.since ?? "2026-08-25"); // PR #2846 merge date
const MIN_N = Math.max(1, Number(argv["min-n"] ?? 15));
const JSON_OUT = argv.json === true || argv.json === "true";

const MAX_ROUTE_DAYS = 90; // tier-export's own MAX_DAYS clamp
const sinceMs = Date.parse(`${SINCE}T00:00:00Z`);
if (!Number.isFinite(sinceMs)) {
  console.error(`--since must be YYYY-MM-DD, got "${SINCE}"`);
  process.exit(2);
}
const daysSinceSince = Math.ceil((Date.now() - sinceMs) / 86400000) + 2; // +2 buffer for tz/partial-day rounding
const DAYS = Math.max(1, Math.min(MAX_ROUTE_DAYS, daysSinceSince));

const POLY_KEY = process.env.POLYGON_API_KEY;
const POLY_BASE = process.env.POLYGON_API_BASE;
if (!POLY_KEY) {
  console.error("POLYGON_API_KEY required (for historical grouped-daily re-screening)");
  process.exit(2);
}

async function jget(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

/**
 * OLD (pre-PR-#2846) production ranking, re-implemented for the counterfactual — it no longer
 * exists in src/ (the swap replaced it in place), so this reproduces it from the original
 * 2026-08-07 finding's own recorded formula (`breakout-ranking-signal.mjs`'s `RANKINGS.momentum`):
 * `gain * close_strength`, tie-broken by $-volume — the exact composite the finding showed was
 * WORSE than random (−5.2pt discovery / −6.4pt held-out) and gain_over_range replaced. Same
 * (movers, maxKeep, side) signature as the real `rankMoversForChainFetch` so `splitBreakoutCohorts`
 * can inject either interchangeably.
 */
function momentumRank(movers, maxKeep) {
  return [...movers]
    .sort((a, b) => {
      const dq = b.gain * b.close_strength - a.gain * a.close_strength;
      if (dq !== 0) return dq;
      return b.dollar - a.dollar;
    })
    .slice(0, maxKeep);
}

const dailyBarCache = new Map(); // date -> grouped results[] | null
async function groupedDaily(date) {
  if (dailyBarCache.has(date)) return dailyBarCache.get(date);
  const j = await jget(
    `${POLY_BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${POLY_KEY}`
  );
  const results = Array.isArray(j?.results) ? j.results : null;
  dailyBarCache.set(date, results);
  return results;
}

const pct = (x) => (x == null ? "  n/a" : `${(x * 100).toFixed(1)}%`);
const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);
const avgPnl = (arr) => (arr.length ? arr.reduce((s, x) => s + x.pnl_pct, 0) / arr.length : null);

/** Prefer the OFFICIAL WS-10/WS-11 executable grade over the raw mechanical mid grade when both
 *  exist — same precedent as outcome-grading-audit.mjs (the two CAN disagree once a row is
 *  executable-graded; official is the more-real trade-managed number). */
function realizedGrade(p) {
  if (typeof p.stored_executable_pnl_pct === "number") {
    return { pnl_pct: p.stored_executable_pnl_pct, outcome: p.stored_executable_outcome ?? null, source: "official" };
  }
  if (typeof p.plan_pnl_pct === "number") {
    return { pnl_pct: p.plan_pnl_pct, outcome: p.plan_outcome ?? null, source: "mid" };
  }
  return null;
}

function summarize(rows) {
  const n = rows.length;
  if (!n) return { n: 0, win_rate: null, avg_pnl_pct: null };
  return {
    n,
    win_rate: rate(rows),
    avg_pnl_pct: Math.round(avgPnl(rows) * 10) / 10,
  };
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok || !res.json) {
    const payload = {
      ok: false,
      insufficient_data: true,
      reason: `Could not reach the live admin tier-export route (GET /api/admin/zerodte/tier-export?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}).`,
    };
    console.log(JSON_OUT ? JSON.stringify(payload, null, 2) : `\n=== BREAKOUT gain_over_range option-P&L A/B — INSUFFICIENT DATA ===\n${payload.reason}\n`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const allPlays = Array.isArray(res.json?.plays) ? res.json.plays : [];

  // BREAKOUT-origin, since PR #2846 merged, with a REAL resolved grade (mid or official).
  const candidates = allPlays.filter((p) => {
    const origin = Array.isArray(p.discovery_origin) ? p.discovery_origin : [];
    if (!origin.includes("BREAKOUT")) return false;
    const d = Date.parse(`${p.session_date}T00:00:00Z`);
    if (!Number.isFinite(d) || d < sinceMs) return false;
    return realizedGrade(p) != null;
  });

  // Pure-BREAKOUT (no FLOW/PIN union) is the clean test of the ranking's own causal effect — a
  // ticker FLOW also found would very likely have been committed regardless of BREAKOUT's ranking.
  const breakoutOnly = candidates.filter((p) => {
    const origin = Array.isArray(p.discovery_origin) ? p.discovery_origin : [];
    return origin.length === 1 && origin[0] === "BREAKOUT";
  });
  const anyBreakout = candidates;

  if (!JSON_OUT) {
    console.log(`\n=== BREAKOUT gain_over_range — REAL OPTION P&L validation ===`);
    console.log(`source: ${BASE}/api/admin/zerodte/tier-export?days=${DAYS} (via=${res.via})`);
    console.log(`since: ${SINCE} (PR #2846 merge date) · total plays in window: ${allPlays.length}`);
    console.log(`BREAKOUT-origin, graded, since ${SINCE}: any-origin-union ${anyBreakout.length} · pure-BREAKOUT-only ${breakoutOnly.length}\n`);
  }

  if (breakoutOnly.length === 0) {
    const payload = {
      ok: true,
      insufficient_data: true,
      reason: `Zero pure-BREAKOUT-origin graded plays found since ${SINCE} (${anyBreakout.length} any-origin-union rows, ${allPlays.length} total plays in the ${DAYS}-day window). The originally-recommended validation cannot run against real committed option P&L because the BREAKOUT lane has not produced a standalone committed play in this window — not a flaw in this script's method.`,
      total_plays_in_window: allPlays.length,
      any_breakout_union: anyBreakout.length,
    };
    console.log(JSON_OUT ? JSON.stringify(payload, null, 2) : `${payload.reason}\n`);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  // ── PART A — directly observed real option P&L, no reconstruction. ─────────────────────────
  const observedRows = breakoutOnly.map((p) => {
    const g = realizedGrade(p);
    return { ticker: p.ticker, session_date: p.session_date, direction: p.direction, pnl_pct: g.pnl_pct, outcome: g.outcome, grade_source: g.source, win: g.pnl_pct > 0 };
  });
  const observedSummary = summarize(observedRows);

  // ── PART B — counterfactual split: would the OLD momentum ranking have prioritized this
  //    ticker too (MOMENTUM_ALSO), or does it exist on the board only because of the swap
  //    (GAIN_OVER_RANGE_EXCLUSIVE)? ──────────────────────────────────────────────────────────
  const screenPool = productionScreenPool(BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL);
  const reconciled = [];
  const unreconcilable = []; // committed ticker didn't reappear in today's re-screen of that date

  for (const p of breakoutOnly) {
    const results = await groupedDaily(p.session_date);
    if (!results) {
      unreconcilable.push({ ticker: p.ticker, session_date: p.session_date, reason: "no_grouped_daily_bars" });
      continue;
    }
    const longMovers = screenBreakoutMovers(results, screenPool);
    const shortMovers = screenBreakdownMovers(results, screenPool);
    const qualifyingMovers = longMovers.length + shortMovers.length;
    const cap = resolveBreakoutCandidateCap({
      qualifyingMovers,
      floor: BREAKOUT_MAX_CANDIDATES,
      ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
    });
    const side = p.direction === "short" ? "short" : "long";
    const pool = side === "long" ? longMovers : shortMovers;
    const mover = pool.find((m) => m.ticker.toUpperCase() === p.ticker.toUpperCase());
    if (!mover) {
      unreconcilable.push({ ticker: p.ticker, session_date: p.session_date, reason: "not_in_rescreened_pool" });
      continue;
    }

    const gainOverRangeSplit = splitBreakoutCohorts({ pool, cap, screenPoolCap: BREAKOUT_SCREEN_POOL, rank: rankMoversForChainFetch, side });
    const momentumSplit = splitBreakoutCohorts({ pool, cap, screenPoolCap: BREAKOUT_SCREEN_POOL, rank: momentumRank, side });
    const isKept = (split) => split.kept.some((m) => m.ticker.toUpperCase() === p.ticker.toUpperCase());
    const rankOf = (split) => split.ranked.findIndex((m) => m.ticker.toUpperCase() === p.ticker.toUpperCase()) + 1;

    const g = realizedGrade(p);
    reconciled.push({
      ticker: p.ticker,
      session_date: p.session_date,
      direction: p.direction,
      pnl_pct: g.pnl_pct,
      outcome: g.outcome,
      grade_source: g.source,
      win: g.pnl_pct > 0,
      cap,
      qualifying_movers: qualifyingMovers,
      gain_over_range_rank: rankOf(gainOverRangeSplit),
      momentum_rank: rankOf(momentumSplit),
      gain_over_range_kept: isKept(gainOverRangeSplit),
      momentum_kept: isKept(momentumSplit),
      bucket: isKept(momentumSplit) ? "MOMENTUM_ALSO" : "GAIN_OVER_RANGE_EXCLUSIVE",
    });
  }

  const momentumAlso = reconciled.filter((r) => r.bucket === "MOMENTUM_ALSO");
  const exclusive = reconciled.filter((r) => r.bucket === "GAIN_OVER_RANGE_EXCLUSIVE");
  const momentumAlsoSummary = summarize(momentumAlso);
  const exclusiveSummary = summarize(exclusive);

  const thin = breakoutOnly.length < MIN_N;

  const payload = {
    ok: true,
    source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS} (via=${res.via})`,
    since: SINCE,
    thin_sample: thin,
    min_n: MIN_N,
    total_plays_in_window: allPlays.length,
    any_breakout_union_n: anyBreakout.length,
    pure_breakout_only_n: breakoutOnly.length,
    part_a_directly_observed: observedSummary,
    reconciled_n: reconciled.length,
    unreconcilable_n: unreconcilable.length,
    unreconcilable,
    part_b_momentum_also: momentumAlsoSummary,
    part_b_gain_over_range_exclusive: exclusiveSummary,
    part_b_rows: reconciled,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`PART A — directly observed real option P&L (pure-BREAKOUT-only, ${SINCE}..now):`);
    console.log(`  n=${observedSummary.n} · win rate ${pct(observedSummary.win_rate)} · avg P&L ${observedSummary.avg_pnl_pct ?? "n/a"}%`);
    if (thin) console.log(`  *** THIN SAMPLE — n=${breakoutOnly.length} < --min-n=${MIN_N}. Directional only, not confident. ***`);
    console.log(`\nPART B — counterfactual split (reconciled ${reconciled.length}/${breakoutOnly.length}, ${unreconcilable.length} unreconcilable):`);
    console.log(`  MOMENTUM_ALSO (old ranking would have prioritized it too): n=${momentumAlsoSummary.n} · WR ${pct(momentumAlsoSummary.win_rate)} · avg P&L ${momentumAlsoSummary.avg_pnl_pct ?? "n/a"}%`);
    console.log(`  GAIN_OVER_RANGE_EXCLUSIVE (exists only because of the swap): n=${exclusiveSummary.n} · WR ${pct(exclusiveSummary.win_rate)} · avg P&L ${exclusiveSummary.avg_pnl_pct ?? "n/a"}%`);
    if (unreconcilable.length) {
      console.log(`\n  Unreconcilable rows (committed ticker not found in today's re-screen of its own session date):`);
      for (const u of unreconcilable) console.log(`    ${u.session_date} ${u.ticker}: ${u.reason}`);
    }
    console.log();
  }

  await releaseAuditClerkSession();
}

await main();
