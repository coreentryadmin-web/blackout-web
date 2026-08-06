/**
 * BREAKOUT dynamic-N A/B (INTENTIONAL-DESIGN item #4 follow-up — "dynamic-N rule").
 *
 * Grades the SHIPPED dynamic cap (`resolveBreakoutCandidateCap` in `src/lib/zerodte/breakout-cap.ts`:
 * `max(floor, min(ceiling, ceil(qualifying * 0.30)))`, floor=40/ceiling=100) against the STATIC-40
 * baseline it replaced, using the favorable-first grading methodology shared with
 * `discovery-recall-probe.mjs` (apples-to-apples with that probe).
 *
 * CORRECTED 2026-08-06 — the cohort split was measuring an ordering production does not use.
 * Previously both cohorts were `screenBreakoutMovers(results, SCAN_TOP).slice(0, N)` — top-N by
 * **$-VOLUME**, the order `screenBreakoutMovers` happens to return. Production re-ranks the pool by
 * MOMENTUM QUALITY (`rankMoversForChainFetch`, gain × close_strength) and only then applies the cap
 * (`breakout-discovery.ts:378-379`), so the "EXTRA slice rank 41..N" this script reported was not
 * the slice dynamic-N actually adds. It also sized `qualifyingMovers` from the LONG pool alone,
 * whereas production sizes the cap from LONG + SHORT together (`breakout-discovery.ts:306`), which
 * under-stated N_dynamic. **Every number this harness produced before 2026-08-06 is INVALID** —
 * including the evidence quoted in `breakout-cap.ts`'s header. The split now lives in
 * `lib/breakout-cohort-split.mjs`, shared with the recall probe so the two cannot drift again.
 *
 * For each session this reports:
 *   - qualifying pool size, LONG and SHORT (both feed the cap; grading stays long-side only)
 *   - N_dynamic actually resolved by the shipped formula
 *   - STATIC-40 cohort (momentum ranks 1-40):  n / win-rate / avg maxRet
 *   - DYNAMIC-N cohort (momentum ranks 1-N):   n / win-rate / avg maxRet  (superset of static)
 *   - the EXTRA slice (momentum ranks 41..N):  n / win-rate / avg maxRet  — what dynamic-N adds
 * Then an aggregate rollup, plus a sanity check that N_dynamic never exceeds the ceiling.
 *
 * Read-only. Polygon only (grouped-daily + minute bars — no UW, no DB, no Clerk). Self-defaults
 * POLYGON_API_BASE. Imports the REAL production screens, ranker and cap formula — this measures
 * exactly what the shipped code does. Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/breakout-dynamic-n-ab.mjs \
 *     --dates=2026-07-20,2026-07-21,... [--fav=0.015] [--entry=10:00] [--concurrency=12] [--json]
 */
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

// REAL production screens + REAL production ranker + REAL production dynamic-cap formula — what we
// measure is exactly what the shipped code does to the live board's candidate set.
const { screenBreakoutMovers, screenBreakdownMovers } = await import(
  `${SRC}features/nighthawk/lib/candidates.ts`
);
const {
  rankMoversForChainFetch,
  BREAKOUT_MAX_CANDIDATES,
  BREAKOUT_MAX_CANDIDATES_CEILING,
  BREAKOUT_SCREEN_POOL,
} = await import(`${SRC}lib/zerodte/breakout-discovery.ts`);
const { resolveBreakoutCandidateCap } = await import(`${SRC}lib/zerodte/breakout-cap.ts`);
const { splitBreakoutCohorts, productionScreenPool } = await import("./lib/breakout-cohort-split.mjs");

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const STATIC_KEEP = BREAKOUT_MAX_CANDIDATES;
// Production's own upstream screen pool (breakout-discovery.ts:295) — NOT an arbitrary --scan-top.
// `--scan-top` may only WIDEN it (breadth exploration); it can never narrow the pool below what the
// live scan screens, which is what makes the qualifying count (and therefore N_dynamic) real.
const SCREEN_POOL = Math.max(
  productionScreenPool(BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL),
  Number(argv["scan-top"] ?? 0) || 0
);
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 12));
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const ET_OFFSET = -4; // EDT (July sessions); RTH window derived from this.
const ENTRY_UTC_MIN = (entH - ET_OFFSET) * 60 + (entM || 0);
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60;

const KEY = process.env.POLYGON_API_KEY;
const BASE = process.env.POLYGON_API_BASE;
if (!KEY) {
  console.error("POLYGON_API_KEY required");
  process.exit(2);
}

const DATES = String(
  argv.dates ?? "2026-07-20,2026-07-21,2026-07-24,2026-07-30,2026-07-31"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function jget(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

const utcMinOf = (tMs) => {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Identical grading to discovery-recall-probe.mjs: favorable-first long-call proxy. */
function gradeContinuation(bars) {
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .sort((a, b) => a.t - b.t)
    .filter((b) => utcMinOf(b.t) >= ENTRY_UTC_MIN && utcMinOf(b.t) <= CLOSE_UTC_MIN);
  if (rth.length < 2) return null;
  const entry = rth[0].c;
  if (!(entry > 0)) return null;
  const favLevel = entry * (1 + FAV);
  const advLevel = entry * (1 - ADV);
  let maxRet = 0;
  for (let i = 1; i < rth.length; i++) {
    const b = rth[i];
    maxRet = Math.max(maxRet, (b.h - entry) / entry);
    const hitFav = b.h >= favLevel;
    const hitAdv = b.l <= advLevel;
    if (hitFav && !hitAdv) return { win: true, maxRet, entry };
    if (hitAdv && !hitFav) return { win: false, maxRet, entry };
    if (hitFav && hitAdv) return { win: false, maxRet, entry };
  }
  return { win: false, maxRet, entry };
}

async function fetchMinuteBars(ticker, date) {
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  const j = await jget(url);
  return (j?.results ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

/** Bounded-concurrency grading — the production pool is up to 400 names/side, so a sequential walk
 *  would make a multi-session run take tens of minutes. Result order is irrelevant (everything
 *  downstream aggregates), so a simple worker pool suffices. */
async function gradeCohort(movers, date) {
  const graded = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= movers.length) return;
      const m = movers[i];
      const bars = await fetchMinuteBars(m.ticker.toUpperCase(), date);
      const g = gradeContinuation(bars);
      if (g) graded.push({ ...m, ...g });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, movers.length) }, worker));
  return graded;
}

const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);
const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);

async function runSession(date) {
  const grouped = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${KEY}`);
  const results = grouped?.results ?? [];
  if (results.length === 0) {
    return { date, error: "no grouped-daily data (weekend/holiday/provider miss)" };
  }
  // PRODUCTION STEP 2 — both sides, at the production screen-pool size.
  const longMovers = screenBreakoutMovers(results, SCREEN_POOL);
  const shortMovers = screenBreakdownMovers(results, SCREEN_POOL);

  // PRODUCTION STEP 3-4 — the cap is sized from LONG + SHORT qualifying breadth TOGETHER
  // (breakout-discovery.ts:306). Sizing it from the long pool alone under-states N_dynamic, which
  // is one of the two defects corrected on 2026-08-06.
  const qualifying = longMovers.length + shortMovers.length;
  const nDynamic = resolveBreakoutCandidateCap({
    qualifyingMovers: qualifying,
    floor: BREAKOUT_MAX_CANDIDATES,
    ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
  });

  // PRODUCTION STEP 5-7 — the cohorts are slices of the MOMENTUM ordering, not of the $-volume
  // ordering `screenBreakoutMovers` returns. Both A and B are cut from the same ranked list, so the
  // A/B stays apples-to-apples; only the cut point differs (static 40 vs dynamic N).
  const ranked = splitBreakoutCohorts({
    pool: longMovers,
    cap: nDynamic,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "long",
  }).ranked;

  const staticCohort = ranked.slice(0, STATIC_KEEP);
  const dynamicCohort = ranked.slice(0, nDynamic);
  const extraCohort = ranked.slice(STATIC_KEEP, nDynamic); // what dynamic-N recovers over static-40

  const [staticGraded, dynamicGraded, extraGraded] = await Promise.all([
    gradeCohort(staticCohort, date),
    gradeCohort(dynamicCohort, date),
    gradeCohort(extraCohort, date),
  ]);

  return {
    date,
    qualifying,
    qualifying_long: longMovers.length,
    qualifying_short: shortMovers.length,
    n_dynamic: nDynamic,
    static: { n: staticGraded.length, win_rate: rate(staticGraded), avg_max_ret: avg(staticGraded, (x) => x.maxRet) },
    dynamic: { n: dynamicGraded.length, win_rate: rate(dynamicGraded), avg_max_ret: avg(dynamicGraded, (x) => x.maxRet) },
    extra: {
      n: extraGraded.length,
      win_rate: rate(extraGraded),
      avg_max_ret: avg(extraGraded, (x) => x.maxRet),
      winners: extraGraded.filter((x) => x.win).map((x) => x.ticker),
    },
  };
}

const sessions = [];
for (const date of DATES) {
  sessions.push(await runSession(date));
}

// Aggregate rollup across all valid sessions (pools weighted by n, not simple session-average, so a
// big-breadth day's extra recall isn't diluted the same as a thin day's).
const valid = sessions.filter((s) => !s.error);
function aggregate(pick) {
  const all = valid.flatMap((s) => {
    const c = pick(s);
    return c && c.n > 0 ? [{ n: c.n, wins: Math.round((c.win_rate ?? 0) * c.n), sumRet: (c.avg_max_ret ?? 0) * c.n }] : [];
  });
  const n = all.reduce((s, x) => s + x.n, 0);
  const wins = all.reduce((s, x) => s + x.wins, 0);
  const sumRet = all.reduce((s, x) => s + x.sumRet, 0);
  return { n, win_rate: n ? wins / n : null, avg_max_ret: n ? sumRet / n : null };
}
const aggStatic = aggregate((s) => s.static);
const aggDynamic = aggregate((s) => s.dynamic);
const aggExtra = aggregate((s) => s.extra);
const maxNDynamic = valid.length ? Math.max(...valid.map((s) => s.n_dynamic)) : null;

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { static_keep: STATIC_KEEP, ceiling: BREAKOUT_MAX_CANDIDATES_CEILING, sessions, aggregate: { static: aggStatic, dynamic: aggDynamic, extra: aggExtra, max_n_dynamic: maxNDynamic } },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`\n=== BREAKOUT dynamic-N A/B — ${valid.length}/${DATES.length} sessions ===`);
console.log(
  `static keep=${STATIC_KEEP} · dynamic floor=${BREAKOUT_MAX_CANDIDATES} ceiling=${BREAKOUT_MAX_CANDIDATES_CEILING} (30% of qualifying pool)`
);
console.log(
  `split: PRODUCTION — screen pool ${SCREEN_POOL}/side, cohorts cut from the MOMENTUM ranking (rankMoversForChainFetch), qualifying = L+S\n`
);
for (const s of sessions) {
  if (s.error) {
    console.log(`${s.date}: ${s.error}`);
    continue;
  }
  console.log(
    `${s.date}: qualifying=${s.qualifying} (${s.qualifying_long}L+${s.qualifying_short}S)  N_dynamic=${s.n_dynamic}  ` +
      `STATIC-40 n=${s.static.n} WR=${pct(s.static.win_rate)} avgMaxRet=${pct(s.static.avg_max_ret)}  ` +
      `DYNAMIC-${s.n_dynamic} n=${s.dynamic.n} WR=${pct(s.dynamic.win_rate)} avgMaxRet=${pct(s.dynamic.avg_max_ret)}  ` +
      `EXTRA(rank${STATIC_KEEP + 1}-${s.n_dynamic}) n=${s.extra.n} WR=${pct(s.extra.win_rate)} winners=[${s.extra.winners.join(",")}]`
  );
}
console.log(`\n--- Aggregate (n-weighted across ${valid.length} sessions) ---`);
console.log(`STATIC-40:   n=${aggStatic.n}  WR=${pct(aggStatic.win_rate)}  avgMaxRet=${pct(aggStatic.avg_max_ret)}`);
console.log(`DYNAMIC-N:   n=${aggDynamic.n}  WR=${pct(aggDynamic.win_rate)}  avgMaxRet=${pct(aggDynamic.avg_max_ret)}`);
console.log(`EXTRA-only:  n=${aggExtra.n}  WR=${pct(aggExtra.win_rate)}  avgMaxRet=${pct(aggExtra.avg_max_ret)}`);
console.log(`\nMax N_dynamic observed across sessions: ${maxNDynamic} (ceiling=${BREAKOUT_MAX_CANDIDATES_CEILING} — bounds worst-case chain-fetch growth to ${BREAKOUT_MAX_CANDIDATES_CEILING / STATIC_KEEP}x static).`);
console.log(`\n(A/B evidence for shipping resolveBreakoutCandidateCap's dynamic-N formula. Not a live gate.)`);
