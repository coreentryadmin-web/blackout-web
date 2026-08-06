/**
 * DISCOVERY RECALL PROBE (design decision Q10 — "no silent caps").
 *
 * The BREAKOUT origin screens the WHOLE market (~12k grouped-daily names) but only a capped number
 * become plays — everything below the cut is silently dropped. We grade what COMMITS but never the
 * mover below the cut that would have run. This probe measures that recall cost: it screens a
 * session with the EXACT production screen + the EXACT production ordering, splits the qualifying
 * pool at the EXACT production cap into KEPT vs DROPPED, and grades each name's intraday
 * continuation on REAL Polygon minute bars — then reports whether the DROPPED cohort ran as hard as
 * the KEPT cohort (i.e., whether the cap leaves winners on the table) and names the dropped winners.
 *
 * CORRECTED 2026-08-06 — the cohort split was measuring an ordering production does not use.
 * Previously: `screenBreakoutMovers(results, SCAN_TOP).slice(0, BREAKOUT_MAX_CANDIDATES)` — i.e.
 * top-N by **$-VOLUME** against the **static floor** (40). Production is neither:
 *   · the pool is re-ranked by MOMENTUM QUALITY (`rankMoversForChainFetch`, gain × close_strength)
 *     before the cap is applied (`breakout-discovery.ts:378-379`), and
 *   · the cap is DYNAMIC — `resolveBreakoutCandidateCap` = clamp(ceil(qualifying × 0.30), 40, 100),
 *     sized per scan from the LONG + SHORT qualifying pools together (`breakout-discovery.ts:306`).
 * Both cohorts were therefore drawn from a split the live board never makes, so every recall number
 * derived from this probe before 2026-08-06 is INVALID (it does not refute or support the cap — it
 * measured a different question). The split now lives in `lib/breakout-cohort-split.mjs`, shared
 * with `breakout-dynamic-n-ab.mjs` so the two cannot drift apart again.
 *
 * SCOPE: grading stays LONG/breakout-side only (as before), but the SHORT/breakdown pool is still
 * screened because production sizes the dynamic cap from `long + short` qualifying counts — leaving
 * it out under-sizes N and would re-introduce a fake split.
 *
 * GRADING (honest proxy, labeled as such): a long ATM-0DTE-call "wins" when, from the entry bar (first
 * minute bar at/after --entry ET), the underlying's HIGH reaches entry·(1+fav) BEFORE its LOW reaches
 * entry·(1−fav/2) — the favorable-first move a high-gamma 0DTE call feeds on (+fav underlying ≈ the
 * call doubling; −fav/2 ≈ the −50% stop). This is an UNDERLYING-continuation proxy, not an exact option
 * P&L path (that needs each name's 0DTE chain); it is applied IDENTICALLY to both cohorts, so the
 * KEPT-vs-DROPPED RECALL comparison is apples-to-apples. maxRet is the raw max-favorable-excursion.
 *
 * Read-only. Polygon only (grouped-daily + minute bars — no UW, no DB, no Clerk). Self-defaults
 * POLYGON_API_BASE. Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/discovery-recall-probe.mjs \
 *     [--grade=YYYY-MM-DD] [--dates=A,B,C] [--fav=0.015] [--entry=10:00] [--concurrency=12] [--json]
 */
// POLYGON_API_BASE is often the unresolved `${{shared.*}}` placeholder string in this sandbox — accept
// it ONLY when it's a real http(s) URL, else fall back to the code's own default host.
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

// Import ONLY the pure production logic (screens + ranking + cap formula); grouped-daily and minute
// bars are fetched via direct HTTP below, because the src provider modules resolve their base URL
// from an env-config indirection that doesn't bind in this sandbox (the `${{shared.*}}` issue) — the
// other audit scripts hit Polygon directly for the same reason. Everything that DEFINES the cohort
// split is the real production code, so what we measure is exactly what the live board cuts.
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
// Production's own upstream screen pool — NOT an arbitrary --scan-top. `--scan-top` is still
// accepted (it can only WIDEN the screen, never narrow it below production) for ad-hoc breadth
// exploration; the cohort split itself always uses the production pool.
const SCREEN_POOL = Math.max(
  productionScreenPool(BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL),
  Number(argv["scan-top"] ?? 0) || 0
);
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 12));
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const ET_OFFSET = -4; // EDT (summer sessions); RTH window derived from this.
const ENTRY_UTC_MIN = (entH - ET_OFFSET) * 60 + (entM || 0); // 10:00 ET → 14:00 UTC
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60; // 16:00 ET → 20:00 UTC

const KEY = process.env.POLYGON_API_KEY;
const BASE = process.env.POLYGON_API_BASE;
if (!KEY) {
  console.error("POLYGON_API_KEY required");
  process.exit(2);
}

const ymd = (d) => d.toISOString().slice(0, 10);
async function jget(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}

/** Resolve the session list: --dates, else --grade/--date, else the last day with grouped data. */
async function resolveSessions() {
  if (argv.dates && argv.dates !== true) {
    return String(argv.dates).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const explicit = argv.grade ?? argv.date;
  if (explicit && explicit !== true) return [String(explicit)];
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const day = ymd(d);
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${KEY}`);
    if (g?.results?.length) return [day];
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return [ymd(new Date())];
}

const utcMinOf = (tMs) => {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Grade one name's intraday continuation from the entry bar. Favorable-first proxy for a long call. */
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
    if (hitFav && hitAdv) return { win: false, maxRet, entry }; // same-bar ambiguity → pessimistic
  }
  return { win: false, maxRet, entry }; // never reached favorable → time-stop loss
}

async function fetchMinuteBars(ticker, date) {
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  const j = await jget(url);
  return (j?.results ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

/** Bounded-concurrency grading — the production pool is now up to 400 names/side, so a sequential
 *  walk would make a multi-session run take tens of minutes. Order of results does not matter
 *  (every consumer aggregates), so a simple worker pool is enough. */
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

  // PRODUCTION STEP 2 — both sides screened from the SAME pool size the live scan uses.
  const longMovers = screenBreakoutMovers(results, SCREEN_POOL);
  const shortMovers = screenBreakdownMovers(results, SCREEN_POOL);

  // PRODUCTION STEP 3-4 — the dynamic cap is sized from LONG + SHORT qualifying breadth together.
  const qualifying = longMovers.length + shortMovers.length;
  const cap = resolveBreakoutCandidateCap({
    qualifyingMovers: qualifying,
    floor: BREAKOUT_MAX_CANDIDATES,
    ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
  });

  // PRODUCTION STEP 5-7 — momentum re-rank, then the cap. THIS is the split the board makes.
  const split = splitBreakoutCohorts({
    pool: longMovers,
    cap,
    screenPoolCap: BREAKOUT_SCREEN_POOL,
    rank: rankMoversForChainFetch,
    side: "long",
  });

  const [keptGraded, droppedGraded] = await Promise.all([
    gradeCohort(split.kept, date),
    gradeCohort(split.dropped, date),
  ]);
  const droppedWinners = droppedGraded.filter((x) => x.win).sort((a, b) => b.maxRet - a.maxRet);

  return {
    date,
    qualifying_long: longMovers.length,
    qualifying_short: shortMovers.length,
    qualifying_total: qualifying,
    cap,
    fetch_budget: split.fetch_budget,
    kept: { n: keptGraded.length, win_rate: rate(keptGraded), avg_max_ret: avg(keptGraded, (x) => x.maxRet) },
    dropped: {
      n: droppedGraded.length,
      win_rate: rate(droppedGraded),
      avg_max_ret: avg(droppedGraded, (x) => x.maxRet),
    },
    dropped_winners: droppedWinners.map((x) => ({
      ticker: x.ticker,
      gain: x.gain,
      dollar: x.dollar,
      max_ret: x.maxRet,
    })),
  };
}

const DATES = await resolveSessions();
const sessions = [];
for (const date of DATES) sessions.push(await runSession(date));
const valid = sessions.filter((s) => !s.error);

/** n-weighted rollup so a big-breadth day isn't diluted by a thin one. */
function aggregate(pick) {
  const n = valid.reduce((s, x) => s + (pick(x)?.n ?? 0), 0);
  const wins = valid.reduce((s, x) => s + Math.round((pick(x)?.win_rate ?? 0) * (pick(x)?.n ?? 0)), 0);
  const sumRet = valid.reduce((s, x) => s + (pick(x)?.avg_max_ret ?? 0) * (pick(x)?.n ?? 0), 0);
  return { n, win_rate: n ? wins / n : null, avg_max_ret: n ? sumRet / n : null };
}
const aggKept = aggregate((s) => s.kept);
const aggDropped = aggregate((s) => s.dropped);
const daysDroppedWon = valid.filter(
  (s) => s.dropped.win_rate != null && s.kept.win_rate != null && s.dropped.win_rate >= s.kept.win_rate
).length;

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        split: "production (momentum rank via rankMoversForChainFetch, dynamic cap)",
        floor: BREAKOUT_MAX_CANDIDATES,
        ceiling: BREAKOUT_MAX_CANDIDATES_CEILING,
        screen_pool: SCREEN_POOL,
        fav: FAV,
        sessions,
        aggregate: { kept: aggKept, dropped: aggDropped, sessions_dropped_won: daysDroppedWon, sessions_valid: valid.length },
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`\n=== BREAKOUT discovery recall probe — ${valid.length}/${DATES.length} session(s) ===`);
console.log(
  `split: PRODUCTION — screen pool ${SCREEN_POOL}/side, momentum rank (gain × close_strength), ` +
    `dynamic cap clamp(ceil(qualifying × 0.30), ${BREAKOUT_MAX_CANDIDATES}, ${BREAKOUT_MAX_CANDIDATES_CEILING})`
);
console.log(
  `grade: long-call favorable-first proxy — underlying +${pct(FAV)} before −${pct(ADV)}, entry ${String(argv.entry ?? "10:00")} ET, real minute bars\n`
);
for (const s of sessions) {
  if (s.error) {
    console.log(`${s.date}: ${s.error}`);
    continue;
  }
  console.log(
    `${s.date}: qualifying=${s.qualifying_total} (${s.qualifying_long}L+${s.qualifying_short}S)  cap=${s.cap}  fetchBudget=${s.fetch_budget}`
  );
  console.log(
    `   KEPT   (momentum rank 1–${s.cap}):  n=${s.kept.n}  WR=${pct(s.kept.win_rate)}  avgMaxRet=${pct(s.kept.avg_max_ret)}`
  );
  console.log(
    `   DROPPED(momentum rank ${s.cap + 1}+):  n=${s.dropped.n}  WR=${pct(s.dropped.win_rate)}  avgMaxRet=${pct(s.dropped.avg_max_ret)}  winners=${s.dropped_winners.length}`
  );
  for (const w of s.dropped_winners.slice(0, 6)) {
    console.log(
      `      · ${w.ticker.padEnd(6)} gain ${pct(w.gain).padStart(7)}  $-vol ${(w.dollar / 1e6).toFixed(0).padStart(5)}M  maxRet ${pct(w.max_ret)}`
    );
  }
}
console.log(`\n--- Aggregate (n-weighted across ${valid.length} session(s)) ---`);
console.log(`KEPT:    n=${aggKept.n}  WR=${pct(aggKept.win_rate)}  avgMaxRet=${pct(aggKept.avg_max_ret)}`);
console.log(`DROPPED: n=${aggDropped.n}  WR=${pct(aggDropped.win_rate)}  avgMaxRet=${pct(aggDropped.avg_max_ret)}`);
console.log(`Sessions where the DROPPED tail won ≥ the KEPT cohort: ${daysDroppedWon}/${valid.length}`);
if (aggKept.win_rate != null && aggDropped.win_rate != null) {
  console.log(
    `\nVerdict: ${
      aggDropped.win_rate >= aggKept.win_rate
        ? "⚠ the dropped tail won at least as often as the kept cohort in aggregate — the cap/ranking is leaving EV on the table."
        : "the kept cohort out-performed the dropped tail in aggregate — the momentum ranking is selecting the better names and the cap is defensible."
    }`
  );
}
console.log(
  `\n(Recall PROBE — underlying-continuation proxy, not exact option P&L; models the BEST CASE for the cap` +
    ` (every kept name builds a contract). Evidence for a cap decision, not a gate.)`
);
