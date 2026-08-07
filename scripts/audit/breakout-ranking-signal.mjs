#!/usr/bin/env node
/**
 * BREAKOUT ranking-signal probe — does ANY candidate ordering beat chance?
 *
 * WHY (FINDINGS 2026-08-06, corrected recall/dynamic-N evidence): after fixing the harnesses to
 * split cohorts the way production actually does (momentum rank, not $-volume), the 13-session
 * re-run showed win rate does NOT decay with momentum rank — STATIC-40 43.1%, ranks 41…N 44.9%,
 * the DROPPED tail 50.0%. That says production's ranker (`rankMoversForChainFetch`, ordering by
 * `gain × close_strength`) is not concentrating winners at the top of the pool. It does NOT say
 * whether some OTHER orderable property of the same pool would.
 *
 * That is the question this answers, and it is the one that matters: the cap only helps if the
 * ordering it cuts against is informative. Raising or lowering a cap over a signal-free ranking
 * changes how many shots you take, never their quality.
 *
 * METHOD — grade once, rank many.
 *   1. Screen each session's grouped-daily bars with the REAL production `screenBreakoutMovers`.
 *   2. Grade EVERY surviving name once on REAL Polygon minute bars (same favorable-first long-call
 *      proxy `discovery-recall-probe.mjs` uses, so numbers are comparable to the recall evidence).
 *   3. Re-sort that ONE graded pool under each candidate ranking and measure whether rank predicts
 *      outcome. Grading once instead of per-ranking is what makes ~9 rankings affordable — the API
 *      cost is fixed by pool size, not by how many hypotheses are tested.
 *
 * METRIC — top-quintile win rate minus bottom-quintile win rate (`spread`). A ranking with signal
 * concentrates winners at the top: spread > 0. A signal-free ranking scores ~0. `top_cap` (the
 * production cap slice) is reported too because that is the cut actually shipped.
 *
 * SIGNIFICANCE — a PERMUTATION TEST, not a single control. The same graded pool is shuffled
 * `--null-draws` times (default 200) and each shuffle's spread recorded; a ranking's p-value is the
 * fraction of shuffles that matched or beat it. This matters: an earlier version of this script used
 * ONE random ordering as "the noise floor", which is just one sample of the null — on a 3-session
 * smoke run that single draw scored −11.1pt, which would have made a genuinely null ranking look
 * meaningful (or vice versa) purely by luck. Shuffling is pure arithmetic over an already-graded
 * pool, so 200 draws cost no extra API calls.
 *
 * READING THE RESULT. Nine orderings are tested, so at p<=0.05 roughly one false positive is
 * expected by chance — a "winner" here is a candidate to CONFIRM on a held-out window, never a
 * result to ship. And a null result is evidence of absence only to the power the sample supports:
 * it constrains the ordering, it does not prove the pool is unrankable.
 *
 * Read-only. Polygon only (grouped-daily + minute bars — no UW, no DB, no Clerk).
 * Run with `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.
 * Flags: --dates=A,B,C | --days=N  --fav=0.015  --entry=10:00  --pool=N  --concurrency=16  --json
 */

const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

const { screenBreakoutMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const { BREAKOUT_MAX_CANDIDATES, BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL } =
  await import(`${SRC}lib/zerodte/breakout-discovery.ts`);
const { productionScreenPool } = await import("./lib/breakout-cohort-split.mjs");

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const POOL = Math.max(1, Number(argv.pool ?? productionScreenPool(BREAKOUT_MAX_CANDIDATES_CEILING, BREAKOUT_SCREEN_POOL)));
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const CONCURRENCY = Math.max(1, Number(argv.concurrency ?? 16));
const DAYS = Math.max(1, Number(argv.days ?? 10));
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const ET_OFFSET = -4;
const ENTRY_UTC_MIN = (entH - ET_OFFSET) * 60 + (entM || 0);
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60;

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
const utcMinOf = (tMs) => {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

/** Byte-identical to discovery-recall-probe.mjs's grader so the two are directly comparable. */
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
  const j = await jget(
    `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${date}/${date}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`
  );
  return (j?.results ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

async function gradePool(movers, date) {
  const graded = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= movers.length) return;
      const m = movers[i];
      const bars = await fetchMinuteBars(m.ticker, date);
      const g = gradeContinuation(bars);
      if (g) graded.push({ ...m, ...g });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, movers.length) }, worker));
  return graded;
}

/**
 * Candidate orderings. Each returns a score; the pool is sorted DESC by it.
 * `bar` carries the raw grouped-daily o/h/l/c/v so features beyond BreakoutMover are derivable.
 */
const RANKINGS = {
  // PRODUCTION: rankMoversForChainFetch's long-side key.
  momentum: (m) => m.gain * m.close_strength,
  dollar: (m) => m.dollar, // the screen's own order — what the harnesses wrongly measured before
  gain: (m) => m.gain,
  close_strength: (m) => m.close_strength,
  volume: (m) => m.volume,
  // Day's range as a fraction of the open — raw volatility, not direction.
  range_pct: (m) => (m.bar.h - m.bar.l) / m.bar.o,
  // Move relative to the name's OWN range: a "clean" breakout that spent little time retracing.
  gain_over_range: (m) => (m.bar.h - m.bar.l > 0 ? m.gain / ((m.bar.h - m.bar.l) / m.bar.o) : 0),
  // Cheaper underlyings buy more gamma per dollar — tests the option-mechanics angle, not the tape.
  cheap_price: (m) => -m.bar.c,
};

/** Deterministic hash-based pseudo-score. Same (ticker,date,seed) always yields the same value, so
 *  a re-run reproduces the null distribution exactly — no Math.random(), which would make the
 *  significance claim unrepeatable. */
function seededScore(m, seed) {
  let h = 2166136261 ^ seed;
  const s = `${m.ticker}|${m.date}|${seed}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** How many random orderings define the null. 200 gives a usable 95th percentile without the
 *  cost mattering — permuting is pure arithmetic over an already-graded pool, no extra API calls. */
const NULL_DRAWS = Math.max(20, Number(argv["null-draws"] ?? 200));

const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);
const pct = (x) => (x == null ? "  n/a" : `${(x * 100).toFixed(1)}%`);

async function resolveSessions() {
  if (argv.dates && argv.dates !== true) {
    return String(argv.dates).split(",").map((s) => s.trim()).filter(Boolean);
  }
  const out = [];
  const d = new Date();
  for (let i = 0; i < 40 && out.length < DAYS; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = ymd(d);
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${KEY}`);
    if (g?.results?.length) out.push(day);
  }
  return out.reverse();
}

async function main() {
  const sessions = await resolveSessions();
  if (!sessions.length) {
    console.error("no sessions resolved");
    process.exit(2);
  }
  if (!JSON_OUT) {
    console.log(`\n=== BREAKOUT RANKING-SIGNAL PROBE ===`);
    console.log(`sessions: ${sessions.length} (${sessions[0]} … ${sessions[sessions.length - 1]})`);
    console.log(`pool/session: up to ${POOL} (production screen pool) · cap slice: ${BREAKOUT_MAX_CANDIDATES}`);
    console.log(`grade: long-call favorable-first proxy — +${(FAV * 100).toFixed(1)}% before −${(ADV * 100).toFixed(1)}%, entry ${argv.entry ?? "10:00"} ET\n`);
  }

  const all = [];
  for (const date of sessions) {
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true&apiKey=${KEY}`);
    if (!g?.results?.length) continue;
    const byTicker = new Map(g.results.map((r) => [String(r.T ?? "").toUpperCase(), r]));
    const movers = screenBreakoutMovers(g.results, POOL).map((m) => ({
      ...m,
      date,
      bar: byTicker.get(m.ticker) ?? {},
    }));
    const graded = await gradePool(movers, date);
    all.push(...graded);
    if (!JSON_OUT) console.log(`  ${date}: screened ${movers.length} · graded ${graded.length} · WR ${pct(rate(graded))}`);
  }

  if (all.length < 20) {
    console.error(`\nINSUFFICIENT DATA — only ${all.length} graded names.`);
    process.exit(2);
  }

  // Rank WITHIN each session, then pool the ranked positions — ranking is a per-scan decision, so
  // pooling raw scores across sessions would let one hot day's absolute values dominate the order.
  const bySession = new Map();
  for (const g of all) {
    if (!bySession.has(g.date)) bySession.set(g.date, []);
    bySession.get(g.date).push(g);
  }

  /** Score one ordering: per-session quintile split, pooled, plus the shipped cap slice. */
  function evaluate(keyFn) {
    const topQ = [];
    const botQ = [];
    const topCap = [];
    for (const pool of bySession.values()) {
      const sorted = [...pool].sort((a, b) => keyFn(b) - keyFn(a));
      const q = Math.max(1, Math.floor(sorted.length / 5));
      topQ.push(...sorted.slice(0, q));
      botQ.push(...sorted.slice(-q));
      topCap.push(...sorted.slice(0, BREAKOUT_MAX_CANDIDATES));
    }
    const t = rate(topQ);
    const b = rate(botQ);
    return {
      top_quintile_wr: t,
      bottom_quintile_wr: b,
      spread: t != null && b != null ? t - b : null,
      top_cap_wr: rate(topCap),
      n_top: topQ.length,
      n_bot: botQ.length,
    };
  }

  // NULL DISTRIBUTION. Permute the SAME graded pool NULL_DRAWS times and record each draw's spread.
  // This is the honest noise floor: any real ranking has to beat what shuffling achieves on
  // identical data through identical code. One control draw (the earlier design) could not do this
  // — it reported a single sample of the null and called it the floor.
  const nullSpreads = [];
  for (let seed = 1; seed <= NULL_DRAWS; seed++) {
    const r = evaluate((m) => seededScore(m, seed));
    if (r.spread != null) nullSpreads.push(r.spread);
  }
  nullSpreads.sort((a, b) => a - b);
  const q = (p) => nullSpreads[Math.min(nullSpreads.length - 1, Math.max(0, Math.floor(p * nullSpreads.length)))];
  const null95 = q(0.95);
  const null05 = q(0.05);
  /** Fraction of null draws at least as extreme — a one-sided empirical p-value. */
  const pValue = (spread) => (spread == null ? null : nullSpreads.filter((x) => x >= spread).length / nullSpreads.length);

  const rows = Object.entries(RANKINGS).map(([name, keyFn]) => {
    const r = evaluate(keyFn);
    return { ranking: name, ...r, p_value: pValue(r.spread) };
  });
  rows.sort((a, b) => (b.spread ?? -Infinity) - (a.spread ?? -Infinity));

  const poolWr = rate(all);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { sessions, pool_wr: poolWr, graded: all.length, null_draws: nullSpreads.length, null_p05: null05, null_p95: null95, rankings: rows },
        null,
        2
      )
    );
    return;
  }

  console.log(`\n  pooled: ${all.length} graded names · baseline WR ${pct(poolWr)}`);
  console.log(`  null: ${nullSpreads.length} permutations of the SAME pool · 5th..95th pct spread = ${(null05 * 100).toFixed(1)}pt .. ${(null95 * 100).toFixed(1)}pt\n`);
  console.log(`  ranking            topQ     botQ    spread   top-${BREAKOUT_MAX_CANDIDATES}     p`);
  console.log(`  ${"-".repeat(64)}`);
  for (const r of rows) {
    const mark = r.ranking === "momentum" ? "  <- PRODUCTION" : "";
    console.log(
      `  ${r.ranking.padEnd(16)} ${pct(r.top_quintile_wr)}   ${pct(r.bottom_quintile_wr)}   ${
        r.spread == null ? "  n/a" : `${r.spread >= 0 ? "+" : ""}${(r.spread * 100).toFixed(1)}pt`
      }   ${pct(r.top_cap_wr)}   ${r.p_value == null ? " n/a" : r.p_value.toFixed(3)}${mark}`
    );
  }

  const sig = rows.filter((r) => (r.p_value ?? 1) <= 0.05);
  const prod = rows.find((r) => r.ranking === "momentum");
  console.log(`\n  PRODUCTION (momentum = gain x close_strength): spread ${prod?.spread == null ? "n/a" : `${(prod.spread * 100).toFixed(1)}pt`}, p = ${prod?.p_value?.toFixed(3) ?? "n/a"}`);
  if (!sig.length) {
    console.log(`  RESULT: NO ranking beats shuffling at p<=0.05 on this window. The ordering carries`);
    console.log(`          no measurable signal, so cap size changes the NUMBER of shots, not their`);
    console.log(`          quality. Note what this does and does NOT say: it is evidence of absence`);
    console.log(`          only to the power this sample supports — widen --days before treating it`);
    console.log(`          as settled, and re-check on a held-out window either way.`);
  } else {
    console.log(`  RESULT: ${sig.length} ranking(s) beat shuffling at p<=0.05:`);
    for (const r of sig) console.log(`          ${r.ranking.padEnd(16)} spread ${r.spread >= 0 ? "+" : ""}${(r.spread * 100).toFixed(1)}pt  p=${r.p_value.toFixed(3)}  topQ ${pct(r.top_quintile_wr)}`);
    console.log(`          Candidate replacement(s) for the momentum key. Nine orderings were tested,`);
    console.log(`          so at p<=0.05 roughly one false positive is expected by chance — CONFIRM ON`);
    console.log(`          A HELD-OUT WINDOW before shipping any of these.`);
  }
  console.log();
}

await main();
