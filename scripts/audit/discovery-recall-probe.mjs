/**
 * DISCOVERY RECALL PROBE (design decision Q10 — "no silent caps").
 *
 * The BREAKOUT origin screens the WHOLE market (~12k grouped-daily names) but only the top
 * `BREAKOUT_MAX_CANDIDATES` (=6) by $-volume become plays — rank 7+ is silently dropped. We grade what
 * COMMITS but never the mover below the cut that would have run. This probe measures that recall cost:
 * it screens a session with the EXACT production ranking (`screenBreakoutMovers`, imported from src,
 * not reimplemented), splits the qualifying movers at the production cap into KEPT (top-6) vs DROPPED
 * (rank 7…N), and grades each name's intraday continuation on REAL Polygon minute bars — then reports
 * whether the DROPPED cohort ran as hard as the KEPT cohort (i.e., whether the cap leaves winners on
 * the table) and names the specific dropped winners.
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
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/discovery-recall-probe.mjs [--grade=YYYY-MM-DD] [--scan-top=60] [--fav=0.015] [--entry=10:00] [--json]
 */
// POLYGON_API_BASE is often the unresolved `${{shared.*}}` placeholder string in this sandbox — accept
// it ONLY when it's a real http(s) URL, else fall back to the code's own default host.
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

// Import ONLY the pure production logic (ranking + cap); grouped-daily and minute bars are fetched
// via direct HTTP below, because the src provider modules resolve their base URL from an
// env-config indirection that doesn't bind in this sandbox (the `${{shared.*}}` issue) — the other
// audit scripts hit Polygon directly for the same reason. The RANKING that defines recall is the real
// production `screenBreakoutMovers`, so what we measure is exactly what the live board would cut.
const { screenBreakoutMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
const { BREAKOUT_MAX_CANDIDATES } = await import(`${SRC}lib/zerodte/breakout-discovery.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const KEEP = BREAKOUT_MAX_CANDIDATES;
const SCAN_TOP = Math.max(KEEP + 1, Number(argv["scan-top"] ?? 60));
const FAV = Number(argv.fav ?? 0.015);
const ADV = FAV / 2;
const [entH, entM] = String(argv.entry ?? "10:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const ET_OFFSET = -4; // EDT (July sessions); RTH window derived from this.
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

/** Resolve the session: --grade/--date, else walk back to the last day with grouped data. */
async function resolveSession() {
  const explicit = argv.grade ?? argv.date;
  if (explicit && explicit !== true) return String(explicit);
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const day = ymd(d);
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${KEY}`);
    if (g?.results?.length) return day;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymd(new Date());
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

async function fetchMinuteBars(ticker) {
  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${DATE}/${DATE}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  const j = await jget(url);
  return (j?.results ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

async function gradeCohort(movers) {
  const graded = [];
  for (const m of movers) {
    const bars = await fetchMinuteBars(m.ticker.toUpperCase());
    const g = gradeContinuation(bars);
    if (g) graded.push({ ...m, ...g });
  }
  return graded;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);
const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);

const DATE = await resolveSession();
const grouped = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${DATE}?adjusted=true&apiKey=${KEY}`);
const results = grouped?.results ?? [];
if (results.length === 0) {
  console.error(`No grouped-daily data for ${DATE} (weekend/holiday, or provider miss).`);
  process.exit(2);
}
// BUG FIX (2026-08-04): screenBreakoutMovers's own signature is (results, maxKeep=40) — calling
// it with no second arg silently truncated to top-40 INSIDE the production function, before this
// probe's own KEEP/DROPPED split ever ran. Every prior multi-session run measured 40 qualifying /
// 0 dropped on every single day because the function never returned rank 41+ in the first place.
// Pass SCAN_TOP explicitly so the probe actually sees the full requested range.
const movers = screenBreakoutMovers(results, SCAN_TOP); // EXACT production ranking (by $-volume desc)
const kept = movers.slice(0, KEEP);
const dropped = movers.slice(KEEP, SCAN_TOP);

const keptGraded = await gradeCohort(kept);
const droppedGraded = await gradeCohort(dropped);

const keptWR = rate(keptGraded);
const droppedWR = rate(droppedGraded);
const droppedWinners = droppedGraded.filter((x) => x.win).sort((a, b) => b.maxRet - a.maxRet);

if (JSON_OUT) {
  console.log(JSON.stringify({
    date: DATE, keep_cap: KEEP, scan_top: SCAN_TOP, fav: FAV,
    total_qualifying_movers: movers.length,
    kept: { n: keptGraded.length, win_rate: keptWR, avg_max_ret: avg(keptGraded, (x) => x.maxRet) },
    dropped: { n: droppedGraded.length, win_rate: droppedWR, avg_max_ret: avg(droppedGraded, (x) => x.maxRet) },
    dropped_winners: droppedWinners.map((x) => ({ ticker: x.ticker, gain: x.gain, dollar: x.dollar, max_ret: x.maxRet })),
  }, null, 2));
  process.exit(0);
}

console.log(`\n=== BREAKOUT discovery recall probe — session ${DATE} ===`);
console.log(`whole-market qualifying movers: ${movers.length} · production keeps the top ${KEEP} by $-volume · scanned rank 1…${SCAN_TOP}`);
console.log(`grade: long-call favorable-first proxy — underlying +${pct(FAV)} before −${pct(ADV)}, entry ${String(argv.entry ?? "10:00")} ET, on real minute bars\n`);
console.log(`KEPT   (rank 1–${KEEP}):   n=${keptGraded.length}  win-rate=${keptWR == null ? "n/a" : pct(keptWR)}  avg maxRet=${pct(avg(keptGraded, (x) => x.maxRet) ?? 0)}`);
console.log(`DROPPED(rank ${KEEP + 1}–${SCAN_TOP}): n=${droppedGraded.length}  win-rate=${droppedWR == null ? "n/a" : pct(droppedWR)}  avg maxRet=${pct(avg(droppedGraded, (x) => x.maxRet) ?? 0)}`);
console.log(`\nRECALL MISS: ${droppedWinners.length} dropped name(s) were favorable-first winners the top-${KEEP} cap never saw.`);
for (const w of droppedWinners.slice(0, 12)) {
  console.log(`  · ${w.ticker.padEnd(6)} gain ${pct(w.gain).padStart(6)}  $-vol ${(w.dollar / 1e6).toFixed(0).padStart(5)}M  maxRet ${pct(w.maxRet)}`);
}
if (droppedWR != null && keptWR != null) {
  const verdict = droppedWR >= keptWR
    ? "⚠ the dropped cohort won at least as often as the kept cohort — the top-N cap is leaving EV on the table."
    : "the cap is defensible on this session — kept names outperformed the dropped tail.";
  console.log(`\nVerdict: ${verdict}`);
}
console.log(`\n(Recall PROBE — underlying-continuation proxy, not exact option P&L. Evidence for a cap decision, not a gate.)`);
