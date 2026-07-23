/**
 * WHOLE-MARKET BANGER SCANNER — scan EVERY US stock for asymmetric weekly-option "banger" setups.
 * ======================================================================================
 *
 * WHY: the strongest 0DTE/short-dated winners (3–20x) don't live in a fixed watchlist — they're
 * whole-market movers: breakouts past a level on heavy volume, squeezes, catalyst gaps. Polygon's
 * grouped-daily endpoint returns EVERY US stock for a date (~12,400/day), so we can literally screen
 * the entire market, then rank by CONFLUENCE (momentum × volume × close-strength × unusual flow) and
 * suggest a cheap OTM weekly call for each.
 *
 * THE EDGE IS THE EXIT (proven in docs/audit/0DTE-RESEARCH.md): a dumb breakout screen already surfaces
 * bangers constantly — 75% of movers' cheap OTM weeklies touch ≥2x intraweek — but held to expiry they
 * decay to ~zero. So the backtest here measures BOTH the `maxRet` upper bound AND the REALIZED return
 * under a mechanical scale-out (partial at 2x + trailing runner + hard stop), which is what actually
 * converts the opportunity into EV.
 *
 * MODES
 *   (default, live)      screen the latest (or --date) session → ranked banger candidates + a suggested
 *                        cheap OTM weekly call for each (current premium from the chain).
 *   --grade=YYYY-MM-DD   BACKTEST: screen that session, then for each candidate's weekly call measure
 *                        maxRet, hold-to-expiry, and realized-under-scale-out; report banger rates + EV.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/market-banger-scan.mjs [--date=YYYY-MM-DD] [--grade=YYYY-MM-DD]
 *        [--min-gain=0.05] [--min-vol=1000000] [--top=25] [--price-min=5] [--price-max=400] [--json]
 *
 * Secrets from env only (POLYGON_API_KEY, optional UW_API_KEY). Read-only; nothing written/committed.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
const BASE = process.env.POLYGON_API_BASE;
const KEY = process.env.POLYGON_API_KEY;
const SRC = new URL("../../src/", import.meta.url).pathname;
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
// Share ONE exit definition with production — the backtest grades under the exact same rule the
// live banger manager will run (src/lib/zerodte/scale-out.ts), so research and prod can't drift.
const { gradeScaleOut, SCALE_OUT_RULES } = await import(`${SRC}lib/zerodte/scale-out.ts`);

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const GRADE = argv.grade && argv.grade !== "true" ? String(argv.grade) : null;
const MIN_GAIN = Number(argv["min-gain"] ?? 0.05);
const MIN_VOL = Number(argv["min-vol"] ?? 1_000_000);
const TOP = Math.max(1, Number(argv.top ?? 25));
const PRICE_MIN = Number(argv["price-min"] ?? 5);
const PRICE_MAX = Number(argv["price-max"] ?? 400);
const EMIT_JSON = Boolean(argv.json);
const HOLD_DAYS = 9;

// Scale-out exit rule (the edge) — imported from the production module (SCALE_OUT_RULES) so the
// backtest and the live manager are literally the same numbers. Kept as locals for the printout.
const SCALE_AT = SCALE_OUT_RULES.scale_at_mult;
const SCALE_FRAC = SCALE_OUT_RULES.scale_fraction;
const TRAIL_FROM_PEAK = SCALE_OUT_RULES.trail_from_peak;
const HARD_STOP = SCALE_OUT_RULES.hard_stop_mult; // exit all at this multiple before touching 2×

const jget = async (u) => { const r = await fetch(u); return r.ok ? r.json() : null; };
const ymd = (d) => d.toISOString().slice(0, 10);
function nearestFriday(dateStr, minAhead = 4) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + minAhead);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  return ymd(d);
}
const inc = (s) => (s < 25 ? 0.5 : s < 100 ? 1 : s < 250 ? 2.5 : 5);
const occ = (t, exp, k) => `O:${t}${exp.slice(2).replace(/-/g, "")}C${String(Math.round(k * 1000)).padStart(8, "0")}`;
const cleanBars = (b) => (b ?? []).map((x) => ({ t: x.t, o: x.o, h: x.h, l: x.l, c: x.c })).filter((x) => [x.h, x.l, x.c].every(Number.isFinite) && x.c > 0);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

/** Resolve the session to scan: explicit --date/--grade, else walk back from today to the last day
 *  with grouped data (skips weekends/holidays). */
async function resolveSession() {
  if (GRADE) return GRADE;
  if (argv.date && argv.date !== "true") return String(argv.date);
  let d = new Date();
  for (let i = 0; i < 6; i++) {
    const day = ymd(d);
    const g = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true&apiKey=${KEY}`);
    if (g?.results?.length) return day;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymd(new Date());
}

/** Whole-market screen → ranked movers. */
function screenMovers(results) {
  return results
    .filter((x) => x.c >= PRICE_MIN && x.c <= PRICE_MAX && x.v >= MIN_VOL &&
      (x.c - x.o) / x.o >= MIN_GAIN && (x.h - x.c) / Math.max(1e-9, x.h - x.l) <= 0.5)
    .map((x) => ({
      ticker: x.T, close: x.c, gain: (x.c - x.o) / x.o, vol: x.v, dollar: x.v * x.c,
      closeStrength: (x.c - x.l) / Math.max(1e-9, x.h - x.l),
    }))
    .sort((a, b) => b.dollar - a.dollar)
    .slice(0, TOP);
}


/** Probe a cheap ~5–10% OTM weekly call with real bars over the hold window. */
async function probeWeekly(ticker, spot, exp, fromDate, toDate) {
  const step = inc(spot);
  const seen = new Set();
  for (const mult of [1.05, 1.07, 1.1, 1.03]) {
    const strike = Math.round((spot * mult) / step) * step;
    if (seen.has(strike)) continue; seen.add(strike);
    const bars = cleanBars(await fetchAggBars(occ(ticker, exp, strike), 1, "day", fromDate, toDate, "60").catch(() => []));
    if (bars.length) {
      const entryBar = bars.find((b) => b.t >= Date.parse(`${fromDate}T13:00:00Z`)) ?? bars[0];
      if (entryBar && entryBar.c > 0.02) {
        const window = bars.filter((b) => b.t >= entryBar.t);
        return { strike, entry: entryBar.c, exp, window };
      }
    }
  }
  return null;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const session = await resolveSession();
const grouped = await jget(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${session}?adjusted=true&apiKey=${KEY}`);
if (!grouped?.results?.length) { console.error(`No grouped data for ${session}. Market closed?`); process.exit(1); }
const movers = screenMovers(grouped.results);
const exp = nearestFriday(session, 4);

console.log("═".repeat(96));
console.log(`  WHOLE-MARKET BANGER SCAN — ${session}${GRADE ? " (BACKTEST)" : ""}  ·  ${grouped.results.length} stocks screened`);
console.log(`  filter: gain ≥ ${(MIN_GAIN * 100).toFixed(0)}% · vol ≥ ${(MIN_VOL / 1e6).toFixed(1)}M · $${PRICE_MIN}-${PRICE_MAX} · closed strong · top ${TOP} by $-vol · weekly exp ${exp}`);
console.log("═".repeat(96));

if (!GRADE) {
  console.log(`\n  ${pad("TICKER", 7)}${padL("CLOSE", 9)}${padL("GAIN", 7)}${padL("VOL", 8)}${padL("STRONG", 8)}   suggested cheap OTM weekly call`);
  console.log("  " + "─".repeat(90));
  const to = ymd(new Date(new Date(`${session}T00:00:00Z`).getTime() + HOLD_DAYS * 86400000));
  for (const m of movers) {
    const w = await probeWeekly(m.ticker, m.close, exp, session, to);
    const call = w ? `${w.strike}C ${exp} @ ~$${w.entry.toFixed(2)}` : "(no listed weekly call w/ data)";
    console.log(`  ${pad(m.ticker, 7)}${padL("$" + m.close.toFixed(2), 9)}${padL((m.gain * 100).toFixed(0) + "%", 7)}${padL((m.vol / 1e6).toFixed(0) + "M", 8)}${padL((m.closeStrength * 100).toFixed(0) + "%", 8)}   ${call}`);
  }
  console.log(`\n  NOTE: bangers are fleeting — this scan finds them; capture requires a mechanical scale-out`);
  console.log(`  (partial at ${SCALE_AT}× + trail runner at ${TRAIL_FROM_PEAK * 100}% of peak + hard stop ${(1 - HARD_STOP) * -100}%). Run --grade=DATE to measure realized EV.`);
} else {
  const to = ymd(new Date(new Date(`${session}T00:00:00Z`).getTime() + HOLD_DAYS * 86400000));
  const rows = [];
  for (const m of movers) {
    const w = await probeWeekly(m.ticker, m.close, exp, session, to);
    if (!w) continue;
    const maxRet = Math.max(...w.window.map((b) => b.h)) / w.entry;
    const holdRet = w.window.at(-1).c / w.entry;
    const realized = gradeScaleOut(w.window, w.entry); // shared production exit rule
    rows.push({ ...m, strike: w.strike, entry: w.entry, maxRet, holdRet, realized });
  }
  console.log(`\n  ${pad("TICKER", 7)}${padL("GAIN", 6)}${padL("VOL", 7)}${padL("STRIKE", 8)}${padL("ENTRY", 8)}${padL("maxRet", 8)}${padL("hold", 7)}${padL("REALIZED", 10)}`);
  console.log("  " + "─".repeat(92));
  for (const r of rows.sort((a, b) => b.realized - a.realized)) {
    console.log(`  ${pad(r.ticker, 7)}${padL((r.gain * 100).toFixed(0) + "%", 6)}${padL((r.vol / 1e6).toFixed(0) + "M", 7)}${padL(r.strike, 8)}${padL("$" + r.entry.toFixed(2), 8)}${padL(r.maxRet.toFixed(1) + "x", 8)}${padL(r.holdRet.toFixed(2) + "x", 7)}${padL(r.realized.toFixed(2) + "x", 10)}`);
  }
  const n = rows.length;
  if (n) {
    const rate = (f) => ((rows.filter(f).length / n) * 100).toFixed(0);
    const avg = (sel) => rows.reduce((s, r) => s + sel(r), 0) / n;
    console.log("\n" + "═".repeat(96));
    console.log(`  n=${n} · touched ≥2x: ${rate((r) => r.maxRet >= 2)}% · ≥3x: ${rate((r) => r.maxRet >= 3)}% · ≥5x: ${rate((r) => r.maxRet >= 5)}%`);
    console.log(`  MEAN return — maxRet(top-tick) ${avg((r) => r.maxRet).toFixed(2)}x · hold-to-expiry ${avg((r) => r.holdRet).toFixed(2)}x · REALIZED(scale-out) ${avg((r) => r.realized).toFixed(2)}x`);
    console.log(`  REALIZED EV per $1 risked: ${(avg((r) => r.realized) - 1 >= 0 ? "+" : "")}${((avg((r) => r.realized) - 1) * 100).toFixed(0)}%  (scale ${SCALE_FRAC * 100}%@${SCALE_AT}x · trail ${TRAIL_FROM_PEAK * 100}% · stop ${(1 - HARD_STOP) * -100}%)`);
    console.log("═".repeat(96));
    if (EMIT_JSON) { console.log("\n<<<JSON>>>"); console.log(JSON.stringify({ session, exp, n, rows }, null, 2)); }
  }
}
