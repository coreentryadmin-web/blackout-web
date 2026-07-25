/**
 * WALL-TEMPORAL-STABILITY MEASUREMENT (design item #3 — PIN "defended wall" is a single-snapshot test).
 *
 * `evaluatePinRegime` (pin-source.ts) decides whether a name is a genuine dealer-defended, long-gamma,
 * spot-mid-range pin from ONE GEX snapshot — there is no requirement that the bracket PERSISTED across
 * time. A wall that only exists for a single snapshot (a transient gamma blip) is treated identically
 * to a wall that held for hours. That is a deliberate simplicity choice, but it invites a measurable
 * question: do PINs whose defended bracket is STABLE across multiple snapshots actually grade better
 * (revert to the pin) than pins that qualified in only ONE snapshot? If yes, a temporal-stability
 * requirement is warranted; if not, the single-snapshot test is fine as-is.
 *
 * This harness answers it OFFLINE + READ-ONLY, using the REAL production `evaluatePinRegime` /
 * `pinScore` on each snapshot — it changes NO production behavior. It re-runs the SAME pure regime read
 * the live source uses, per snapshot, then grades the fade on real Polygon minute bars.
 *
 * METHOD. Input is a series of per-ticker GEX-wall snapshots across a session. For each ticker:
 *   • run `evaluatePinRegime` on EVERY snapshot → the passes are the snapshots where it was a real pin;
 *   • STABLE  = qualified as a pin in ≥ --min-snaps snapshots with the SAME fade direction AND both
 *     walls within --wall-tol of their median across those snapshots (a bracket that genuinely held);
 *   • SINGLE  = qualified in exactly ONE snapshot (a transient);
 *   • grade the fade direction (long = revert UP toward pin, short = DOWN) on real minute bars from
 *     --entry with the same favorable-first proxy the recall probe uses, applied identically to both
 *     cohorts → compare STABLE win-rate vs SINGLE win-rate.
 *
 * GRADING is an underlying-continuation proxy (fade toward the pin), NOT exact option P&L — evidence for
 * a temporal-stability decision, not a gate. Applied identically to both cohorts, so the comparison is fair.
 *
 * DATA. Intraday GEX-wall snapshots are a server-side UW product; historical intraday snapshots are NOT
 * reachable offline from this sandbox, so this harness reads them from a JSON export you pass with
 * --snapshots=<path>: an array of { snapshot_at, ticker, spot, callWall, putWall, callWallPct,
 * putWallPct, gammaPosture } (the exact numeric shape pin-source PinRegimeInput consumes, plus a
 * timestamp + ticker + session date). A live intraday poller could gather this going forward (poll the
 * GEX heatmap on an interval, append a row per ticker). With no snapshots it prints INSUFFICIENT DATA
 * and exactly what it needs — it never fabricates a wall. Minute bars come from Polygon directly.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx scripts/audit/wall-temporal-stability.mjs --snapshots=export.json [--min-snaps=2] [--wall-tol=0.005] [--fav=0.008] [--entry=11:00] [--json]
 */
const rawBase = process.env.POLYGON_API_BASE;
const RESOLVED_BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.massive.com";
process.env.POLYGON_API_BASE = RESOLVED_BASE;
const SRC = new URL("../../src/", import.meta.url).pathname;

// Import the REAL production pin regime + score — the whole point is to measure the SHIPPED test's
// single-snapshot behavior against the same read run per snapshot.
const { evaluatePinRegime, pinScore } = await import(`${SRC}lib/zerodte/pin-source.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const MIN_SNAPS = Math.max(2, Number(argv["min-snaps"] ?? 2));
const WALL_TOL = Number(argv["wall-tol"] ?? 0.005); // 0.5% of median wall level
const FAV = Number(argv.fav ?? 0.008); // fades are smaller reversions than breakout continuation
const ADV = FAV / 2;
const [entH, entM] = String(argv.entry ?? "11:00").split(":").map(Number);
const JSON_OUT = argv.json === true || argv.json === "true";
const ET_OFFSET = -4;
const ENTRY_UTC_MIN = (entH - ET_OFFSET) * 60 + (entM || 0);
const CLOSE_UTC_MIN = (16 - ET_OFFSET) * 60;

const KEY = process.env.POLYGON_API_KEY;
const BASE = process.env.POLYGON_API_BASE;

function insufficient(reason) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  } else {
    console.log(`\n=== wall-temporal-stability — INSUFFICIENT DATA ===`);
    console.log(reason);
    console.log(
      "\nProvide --snapshots=<path.json>: an array of GEX-wall snapshots across a session —\n" +
        "  { session_date, snapshot_at, ticker, spot, callWall, putWall, callWallPct, putWallPct, gammaPosture }\n" +
        "(gammaPosture ∈ 'long'|'short'). At least 2 snapshots per ticker are needed to test stability.\n" +
        "Historical intraday GEX snapshots are a server-side UW product not reachable from this sandbox —\n" +
        "gather them with a live intraday poller (append one row per ticker per interval), then re-run here."
    );
  }
  process.exit(0);
}

if (!KEY) {
  console.error("POLYGON_API_KEY required");
  process.exit(2);
}
if (typeof argv.snapshots !== "string") {
  insufficient("No --snapshots export was provided, so there are no GEX-wall snapshots to evaluate.");
}

let snaps;
try {
  const fs = await import("node:fs/promises");
  const parsed = JSON.parse(await fs.readFile(argv.snapshots, "utf8"));
  snaps = Array.isArray(parsed) ? parsed : (parsed.snapshots ?? parsed.rows ?? []);
} catch (e) {
  console.error(`Could not read/parse --snapshots=${argv.snapshots}: ${e?.message ?? e}`);
  process.exit(2);
}
if (!Array.isArray(snaps) || snaps.length === 0) insufficient(`--snapshots=${argv.snapshots} contained no rows.`);

const utcMinOf = (tMs) => {
  const d = new Date(tMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const rate = (arr) => (arr.length ? arr.filter((x) => x.win).length / arr.length : null);
const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function jget(url) {
  const r = await fetch(url).catch(() => null);
  if (!r || !r.ok) return null;
  return r.json().catch(() => null);
}
async function fetchMinuteBars(ticker, date) {
  // CodeQL / SSRF hardening: ticker+date come from the operator's --snapshots export (file data).
  // Validate both against strict allowlists BEFORE they reach the outbound URL — a regex guard
  // against a constant pattern breaks the taint flow and rejects any malformed/hostile row.
  const t = String(ticker).toUpperCase();
  const d = String(date);
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(t) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return [];
  const url = `${BASE}/v2/aggs/ticker/${t}/range/1/minute/${d}/${d}?adjusted=true&sort=asc&limit=50000&apiKey=${KEY}`;
  const j = await jget(url);
  return (j?.results ?? []).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

/** Favorable-first proxy, direction-generalized (same convention as merge-precedence-ab.mjs). */
function gradeDirection(bars, direction) {
  const rth = bars
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c))
    .sort((a, b) => a.t - b.t)
    .filter((b) => utcMinOf(b.t) >= ENTRY_UTC_MIN && utcMinOf(b.t) <= CLOSE_UTC_MIN);
  if (rth.length < 2) return null;
  const entry = rth[0].c;
  if (!(entry > 0)) return null;
  const long = direction === "long";
  const favLevel = long ? entry * (1 + FAV) : entry * (1 - FAV);
  const advLevel = long ? entry * (1 - ADV) : entry * (1 + ADV);
  let maxRet = 0;
  for (let i = 1; i < rth.length; i++) {
    const b = rth[i];
    const fav = long ? (b.h - entry) / entry : (entry - b.l) / entry;
    maxRet = Math.max(maxRet, fav);
    const hitFav = long ? b.h >= favLevel : b.l <= favLevel;
    const hitAdv = long ? b.l <= advLevel : b.h >= advLevel;
    if (hitFav && !hitAdv) return { win: true, maxRet };
    if (hitAdv && !hitFav) return { win: false, maxRet };
    if (hitFav && hitAdv) return { win: false, maxRet };
  }
  return { win: false, maxRet };
}

// ── Group snapshots by ticker, run the REAL regime read per snapshot ──────────────────────
const byTicker = new Map();
for (const s of snaps) {
  const t = String(s.ticker ?? "").toUpperCase();
  if (!t) continue;
  if (!byTicker.has(t)) byTicker.set(t, []);
  byTicker.get(t).push(s);
}

const cohorts = []; // { ticker, date, cohort: 'stable'|'single', fade, qualifiedSnaps, walls }
for (const [ticker, rowsRaw] of byTicker) {
  const rows = [...rowsRaw].sort((a, b) =>
    String(a.snapshot_at ?? a.ts ?? "").localeCompare(String(b.snapshot_at ?? b.ts ?? ""))
  );
  const passes = [];
  for (const r of rows) {
    const regime = evaluatePinRegime({
      spot: Number(r.spot),
      callWall: r.callWall == null ? null : Number(r.callWall),
      putWall: r.putWall == null ? null : Number(r.putWall),
      callWallPct: r.callWallPct == null ? null : Number(r.callWallPct),
      putWallPct: r.putWallPct == null ? null : Number(r.putWallPct),
      gammaPosture: r.gammaPosture ?? null,
    });
    if (regime) passes.push({ r, regime, score: pinScore(regime) });
  }
  if (passes.length === 0) continue;
  const date = String(rows[0].session_date ?? rows[0].date ?? String(rows[0].snapshot_at ?? "").slice(0, 10));
  // Same fade direction across passes?
  const dir = passes[0].regime.fadeDirection;
  const sameDir = passes.every((p) => p.regime.fadeDirection === dir);
  // Walls stable within tolerance across passes (median-relative)?
  const callWalls = passes.map((p) => Number(p.r.callWall));
  const putWalls = passes.map((p) => Number(p.r.putWall));
  const cMed = median(callWalls);
  const pMed = median(putWalls);
  const wallsStable =
    cMed != null &&
    pMed != null &&
    callWalls.every((w) => Math.abs(w - cMed) <= WALL_TOL * cMed) &&
    putWalls.every((w) => Math.abs(w - pMed) <= WALL_TOL * pMed);
  const isStable = passes.length >= MIN_SNAPS && sameDir && wallsStable;
  cohorts.push({
    ticker,
    date,
    cohort: isStable ? "stable" : passes.length === 1 ? "single" : "mixed",
    fade: dir,
    qualifiedSnaps: passes.length,
    avgScore: passes.reduce((s, p) => s + p.score, 0) / passes.length,
  });
}

if (cohorts.length === 0) {
  insufficient(
    `Read ${snaps.length} snapshot(s) across ${byTicker.size} ticker(s), but evaluatePinRegime qualified\n` +
      `ZERO of them as genuine dealer-defended pins — nothing to grade. (The regime filter is strict by\n` +
      `design: long-gamma + two-sided bracket + contained band + dominant walls + off-center spot.)`
  );
}

const stable = cohorts.filter((c) => c.cohort === "stable");
const single = cohorts.filter((c) => c.cohort === "single");

if (stable.length === 0 || single.length === 0) {
  insufficient(
    `Qualified pins: ${stable.length} STABLE (≥${MIN_SNAPS} snaps, same fade, walls within ${pct(WALL_TOL)}), ` +
      `${single.length} SINGLE-snapshot, ${cohorts.length - stable.length - single.length} mixed.\n` +
      `Need at least one of EACH cohort to compare — feed a longer/denser snapshot export (more intraday polls).`
  );
}

async function gradeCohort(cs) {
  const out = [];
  for (const c of cs) {
    if (!c.date || c.date.length !== 10) continue;
    const bars = await fetchMinuteBars(c.ticker, c.date);
    const g = gradeDirection(bars, c.fade);
    if (g) out.push({ ...c, ...g });
  }
  return out;
}

const stableGraded = await gradeCohort(stable);
const singleGraded = await gradeCohort(single);

if (stableGraded.length === 0 || singleGraded.length === 0) {
  insufficient(
    `Could not grade both cohorts on minute bars (stable graded ${stableGraded.length}, single graded ${singleGraded.length}).\n` +
      `Check the snapshot export's session_date/ticker resolve to real RTH sessions with Polygon bars.`
  );
}

const stableWR = rate(stableGraded);
const singleWR = rate(singleGraded);

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        min_snaps: MIN_SNAPS,
        wall_tol: WALL_TOL,
        fav: FAV,
        tickers: byTicker.size,
        stable: { n: stableGraded.length, win_rate: stableWR },
        single: { n: singleGraded.length, win_rate: singleWR },
        detail: cohorts.map((c) => ({ ticker: c.ticker, date: c.date, cohort: c.cohort, fade: c.fade, qualified_snaps: c.qualifiedSnaps, avg_score: Math.round(c.avgScore) })),
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`\n=== PIN WALL TEMPORAL-STABILITY — stable-bracket vs single-snapshot pins ===`);
console.log(`snapshots ${snaps.length} · tickers ${byTicker.size} · qualified pins ${cohorts.length} (stable ${stable.length}, single ${single.length}, mixed ${cohorts.length - stable.length - single.length})`);
console.log(`STABLE = pin qualified in ≥${MIN_SNAPS} snaps, same fade dir, both walls within ${pct(WALL_TOL)} of median`);
console.log(`grade: fade toward pin, favorable-first ±${pct(FAV)}/∓${pct(ADV)}, entry ${String(argv.entry ?? "11:00")} ET, real minute bars\n`);
console.log(`STABLE  pins: n=${stableGraded.length}  win-rate=${pct(stableWR)}`);
console.log(`SINGLE  pins: n=${singleGraded.length}  win-rate=${pct(singleWR)}`);
if (stableWR != null && singleWR != null) {
  const verdict =
    stableWR > singleWR
      ? "⚠ multi-snapshot-stable walls graded BETTER than single-snapshot ones — a temporal-stability requirement is worth a calibrated trial."
      : stableWR < singleWR
        ? "single-snapshot pins graded at least as well — no evidence a stability requirement helps on this sample."
        : "dead heat — no measured edge from stability on this sample.";
  console.log(`\nVerdict: ${verdict}`);
}
console.log(`\n(STABILITY PROBE — real evaluatePinRegime per snapshot, underlying-fade proxy, not exact option P&L. Evidence for a stability-requirement decision, not a gate. No production behavior touched.)`);
