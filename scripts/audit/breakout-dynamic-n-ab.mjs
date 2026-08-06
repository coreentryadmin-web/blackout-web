/**
 * BREAKOUT dynamic-N A/B (INTENTIONAL-DESIGN item #4 follow-up — "dynamic-N rule").
 *
 * `discovery-recall-probe.mjs` (fixed 2026-08-04) proved the STATIC `BREAKOUT_MAX_CANDIDATES=40`
 * cap is leaky: whole-market qualifying pools run 100-390/day and the dropped (rank 41+) cohort
 * matched or beat the kept top-40 cohort's win rate on 3 of 5 sampled sessions. This script grades
 * the DYNAMIC-N replacement (`resolveBreakoutCandidateCap` in `src/lib/zerodte/breakout-cap.ts`:
 * `max(floor, min(ceiling, ceil(qualifying * 0.30)))`, floor=40/ceiling=100) against the SAME static-40
 * baseline, on the SAME 5 sessions already validated by the recall-probe fix, using the identical
 * favorable-first grading methodology (apples-to-apples with the existing probe).
 *
 * For each session this reports:
 *   - qualifying pool size (breakout/long side only, matching the existing probe's scope)
 *   - N_dynamic actually resolved by the shipped formula
 *   - STATIC-40 cohort: n / win-rate / avg maxRet
 *   - DYNAMIC-N cohort (superset of static): n / win-rate / avg maxRet
 *   - the EXTRA slice (rank 41..N_dynamic) that dynamic-N recovers over static: n / win-rate / avg maxRet
 * Then an aggregate rollup across all 5 sessions, plus a sanity check that N_dynamic never explodes
 * past the ceiling (bounded chain-fetch/API load).
 *
 * Read-only. Polygon only (grouped-daily + minute bars — no UW, no DB, no Clerk). Self-defaults
 * POLYGON_API_BASE. Imports the REAL production `screenBreakoutMovers` and
 * `resolveBreakoutCandidateCap` — this measures exactly what shipping the change would do. Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/breakout-dynamic-n-ab.mjs \
 *     --dates=2026-07-20,2026-07-21,2026-07-24,2026-07-30,2026-07-31 [--scan-top=500] [--fav=0.015] [--entry=10:00] [--json]
 */
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

// REAL production ranking + REAL production dynamic-cap formula — what we measure is exactly what
// shipping the change would do to the live board's candidate count.
const { screenBreakoutMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const { BREAKOUT_MAX_CANDIDATES, BREAKOUT_MAX_CANDIDATES_CEILING } = await import(
  `${SRC}lib/zerodte/breakout-discovery.ts`
);
const { resolveBreakoutCandidateCap } = await import(`${SRC}lib/zerodte/breakout-cap.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const STATIC_KEEP = BREAKOUT_MAX_CANDIDATES;
const SCAN_TOP = Math.max(BREAKOUT_MAX_CANDIDATES_CEILING + 1, Number(argv["scan-top"] ?? 500));
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

async function gradeCohort(movers, date) {
  const graded = [];
  for (const m of movers) {
    const bars = await fetchMinuteBars(m.ticker.toUpperCase(), date);
    const g = gradeContinuation(bars);
    if (g) graded.push({ ...m, ...g });
  }
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
  // EXACT production ranking, wide scan window so we see the true qualifying pool (not truncated
  // by either cap) — this is what discovery-recall-probe.mjs's 2026-08-04 fix corrected.
  const movers = screenBreakoutMovers(results, SCAN_TOP);
  const qualifying = movers.length;

  // EXACT production dynamic-cap formula: what the shipped code would resolve for this day's
  // breadth. Uses the SAME floor/ceiling constants the live board uses.
  const nDynamic = resolveBreakoutCandidateCap({
    qualifyingMovers: qualifying,
    floor: BREAKOUT_MAX_CANDIDATES,
    ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
  });

  const staticCohort = movers.slice(0, STATIC_KEEP);
  const dynamicCohort = movers.slice(0, nDynamic);
  const extraCohort = movers.slice(STATIC_KEEP, nDynamic); // what dynamic-N recovers over static-40

  const [staticGraded, dynamicGraded, extraGraded] = await Promise.all([
    gradeCohort(staticCohort, date),
    gradeCohort(dynamicCohort, date),
    gradeCohort(extraCohort, date),
  ]);

  return {
    date,
    qualifying,
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
console.log(`static keep=${STATIC_KEEP} · dynamic floor=${BREAKOUT_MAX_CANDIDATES} ceiling=${BREAKOUT_MAX_CANDIDATES_CEILING} (30% of qualifying pool)\n`);
for (const s of sessions) {
  if (s.error) {
    console.log(`${s.date}: ${s.error}`);
    continue;
  }
  console.log(
    `${s.date}: qualifying=${s.qualifying}  N_dynamic=${s.n_dynamic}  ` +
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
