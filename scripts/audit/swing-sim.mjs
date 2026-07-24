/**
 * SWING MULTI-TRUTH GRADER SIM — grade swing positions over REAL forward bars (Polygon).
 * ======================================================================================
 *
 * WHY: PR-8 ships `gradeSwingPosition` — a FIVE-truth grader (execution / path / thesis / management /
 * financial) because a multi-session thesis can't be reduced to one P&L number (a position can fill
 * badly yet print money, or fill perfectly on a thesis that never played out). This harness runs that
 * REAL production grader (imported from src/, never reimplemented) against REAL forward data so we can
 * see the five truths on live names and cut them by archetype + sub-lane — the evidence the graduation
 * ladder will later consume. It sizes NOTHING; it only measures.
 *
 * The financial truth flows through `gradeBangerScaleOut` (via `gradeSwingScaleOut`) — the ONE
 * production scale-out grader — so research and the live ledger can never drift, and a truncated
 * forward series is reported `ungradeable`, never imputed to a fabricated multiple (survivorship guard).
 *
 * MODES
 *   (default, live)      grade each ticker's directional swing on the latest session's forward bars.
 *   --grade=YYYY-MM-DD   BACKTEST: enter at that session's close, hold to the sub-lane's DTE, and grade
 *                        the five truths over the real forward underlying + option bars.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-sim.mjs [--grade=YYYY-MM-DD] [--tickers=SPY,QQQ,NVDA]
 *        [--dte=14] [--direction=LONG] [--json]
 *
 * Secrets from env only (POLYGON_API_KEY). Read-only; nothing written or committed.
 */

// ── Env guard: the sandbox ships POLYGON_API_BASE as an unresolved placeholder. The provider modules
//    read process.env.POLYGON_API_BASE at IMPORT time, so this MUST run before any dynamic import below.
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const BASE = process.env.POLYGON_API_BASE;
const KEY = process.env.POLYGON_API_KEY;
const SRC = new URL("../../src/", import.meta.url).pathname;

// REAL production modules — the grader under test + the sub-lane grader-timeframe pin + the DTE router.
const { gradeSwingPosition, graderTimeframeForSubLane } = await import(`${SRC}lib/swing/grade.ts`);
const { subLaneForDte } = await import(`${SRC}lib/swing/taxonomy.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

// ── CLI args ────────────────────────────────────────────────────────────────────
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const GRADE = argv.grade && argv.grade !== "true" ? String(argv.grade) : null;
const TICKERS = String(argv.tickers ?? "SPY,QQQ,NVDA,AAPL,MSFT").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const INTENDED_DTE = Math.max(2, Math.min(30, Number(argv.dte ?? 14)));
const DIRECTION = String(argv.direction ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
const EMIT_JSON = Boolean(argv.json);

const SUB_LANE = subLaneForDte(INTENDED_DTE); // TACTICAL | STANDARD | EXTENDED | null
const GRADER_TF = graderTimeframeForSubLane(SUB_LANE); // minute | hour | day

const jget = async (u) => {
  const r = await fetch(u);
  return r.ok ? r.json() : null;
};
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, n) => ymd(new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86400000));
const strikeStep = (s) => (s < 25 ? 0.5 : s < 100 ? 1 : s < 250 ? 2.5 : 5);
const occ = (t, exp, k, cp) => `O:${t}${exp.slice(2).replace(/-/g, "")}${cp}${String(Math.round(k * 1000)).padStart(8, "0")}`;
const cleanBars = (b) => (b ?? []).filter((x) => [x.h, x.l, x.c].every(Number.isFinite) && x.c > 0);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const fmt = (n, suf = "") => (n == null ? "—" : `${n}${suf}`);

/** Resolve the session to grade from: explicit --grade, else walk back to the last day with data. */
async function resolveSession() {
  if (GRADE) return GRADE;
  let d = new Date();
  for (let i = 0; i < 6; i++) {
    const day = ymd(d);
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${KEY}`);
    if (g?.results?.length) return day;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymd(new Date());
}

/** Coarse archetype label from the entry-session tape (heuristic — the real classifier lives in
 *  archetype.ts; this harness only needs a partition key for the cuts, not the graded label). */
function coarseArchetype(gapPct, ret10dPct) {
  if (gapPct != null && Math.abs(gapPct) >= 3) return "EVENT_DRIVEN";
  if (ret10dPct != null && ret10dPct >= 6) return "BREAKOUT";
  if (ret10dPct != null && ret10dPct <= -6) return "MEAN_REVERSION";
  return "PULLBACK_CONTINUATION";
}

/** Nearest expiry Friday on/after entry + intended DTE. */
function expiryForDte(entryYmd, dte) {
  const d = new Date(`${entryYmd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dte);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}

/** Grade one ticker's directional swing over real forward bars. */
async function gradeTicker(ticker, session) {
  const cp = DIRECTION === "SHORT" ? "P" : "C";
  // Entry underlying context: daily bars around the session (for entry px, gap, 10d return).
  const daily = cleanBars(await fetchAggBars(ticker, 1, "day", addDays(session, -20), session, "40").catch(() => []));
  if (!daily.length) return null;
  const entryBar = daily.at(-1);
  const entryPx = entryBar.c;
  const gapPct = entryBar.o > 0 ? ((entryBar.c - entryBar.o) / entryBar.o) * 100 : null;
  const ref10 = daily.length >= 11 ? daily[daily.length - 11].c : null;
  const ret10dPct = ref10 ? ((entryPx - ref10) / ref10) * 100 : null;
  const archetype = coarseArchetype(gapPct, ret10dPct);

  // Directional contract: ~ATM/near-ITM (0.50–0.75Δ ≈ slightly ITM). Approximate by one step ITM.
  const step = strikeStep(entryPx);
  const strike = DIRECTION === "SHORT" ? Math.ceil(entryPx / step) * step : Math.floor(entryPx / step) * step;
  const expiry = expiryForDte(session, INTENDED_DTE);
  const holdTo = addDays(session, INTENDED_DTE + 5);

  // Forward bars: underlying on the sub-lane grader timeframe (path/thesis) + option bars (financial/mgmt).
  const under = cleanBars(await fetchAggBars(ticker, 1, GRADER_TF, session, holdTo, "5000").catch(() => []));
  const optSym = occ(ticker, expiry, strike, cp);
  const optBars = cleanBars(await fetchAggBars(optSym, 1, "day", session, holdTo, "500").catch(() => []));
  const entryPremium = optBars.length ? optBars[0].c : null;

  // Thesis levels in UNDERLYING terms (±5% structural band — evidence-only placeholder until entry-model).
  const band = 0.05;
  const target = DIRECTION === "SHORT" ? entryPx * (1 - band) : entryPx * (1 + band);
  const inval = DIRECTION === "SHORT" ? entryPx * (1 + band) : entryPx * (1 - band);

  const grade = gradeSwingPosition({
    subLane: SUB_LANE,
    direction: DIRECTION,
    archetype,
    plannedEntryPx: entryPx,
    actualEntryPx: entryPx, // backtest fills at the session close
    thesisInvalidationPx: inval,
    targetUnderlyingPx: target,
    underlyingBars: under.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })),
    entryPremium,
    optionBars: optBars.map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c })),
    expiryYmd: expiry,
  });
  return { ticker, archetype, strike, expiry, entryPx, grade };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────────
const session = await resolveSession();

console.log("═".repeat(100));
console.log(`  SWING MULTI-TRUTH GRADE — ${session}${GRADE ? " (BACKTEST)" : ""}  ·  ${DIRECTION} ·  intended ${INTENDED_DTE}DTE → ${SUB_LANE} (grader: ${GRADER_TF})`);
console.log("═".repeat(100));

const rows = [];
for (const t of TICKERS) {
  const r = await gradeTicker(t, session).catch(() => null);
  if (r) rows.push(r);
}

console.log(`\n  ${pad("TICKER", 7)}${pad("ARCHETYPE", 22)}${padL("MFE%", 7)}${padL("MAE%", 7)}${padL("THESIS", 13)}${padL("REALIZED", 10)}${padL("HOLD", 8)}${padL("CAPTURE", 9)}`);
console.log("  " + "─".repeat(96));
for (const r of rows) {
  const g = r.grade;
  console.log(
    `  ${pad(r.ticker, 7)}${pad(r.archetype, 22)}` +
      `${padL(fmt(g.path.mfePct), 7)}${padL(fmt(g.path.maePct), 7)}` +
      `${padL(g.thesis.outcome ?? "—", 13)}` +
      `${padL(g.financial.ungradeable ? "ungradeable" : fmt(g.financial.scaleOutRealizedMult, "×"), 10)}` +
      `${padL(g.financial.ungradeable ? "—" : fmt(g.financial.holdMult, "×"), 8)}` +
      `${padL(fmt(g.management.captureRatio), 9)}`
  );
}

// ── Per-archetype + per-sub-lane cuts ──────────────────────────────────────────────
function cut(label, sel) {
  const graded = rows.filter((r) => !r.grade.financial.ungradeable && r.grade.financial.scaleOutRealizedMult != null).filter(sel);
  const n = graded.length;
  if (!n) return;
  const meanReal = graded.reduce((s, r) => s + r.grade.financial.scaleOutRealizedMult, 0) / n;
  const meanHold = graded.reduce((s, r) => s + (r.grade.financial.holdMult ?? 0), 0) / n;
  const confirmed = rows.filter(sel).filter((r) => r.grade.thesis.outcome === "CONFIRMED").length;
  console.log(`  ${pad(label, 26)} n=${n}  realized ${meanReal.toFixed(2)}×  hold ${meanHold.toFixed(2)}×  thesis-confirmed ${confirmed}/${rows.filter(sel).length}`);
}

console.log("\n  PER-ARCHETYPE:");
for (const a of [...new Set(rows.map((r) => r.archetype))]) cut(a, (r) => r.archetype === a);
console.log("\n  PER-SUB-LANE:");
cut(String(SUB_LANE), () => true);

const ungradeable = rows.filter((r) => r.grade.financial.ungradeable).length;
console.log(`\n  ungradeable (no/truncated forward option bars, reported separately — NEVER imputed): ${ungradeable}/${rows.length}`);
console.log("═".repeat(100));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({ session, direction: DIRECTION, subLane: SUB_LANE, graderTimeframe: GRADER_TF, rows }, null, 2));
}
