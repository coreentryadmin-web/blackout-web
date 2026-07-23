/**
 * 0DTE IRON-CONDOR WIN-RATE BACKTEST — the reproducible evidence behind the high-WR premium-selling engine.
 * ======================================================================================================
 *
 * WHY: buying 0DTE options is inherently ~40-50% WR / big-payoff (you need a rare directional move to
 * double). The mirror image — SELLING a 0DTE iron condor with short strikes a small % outside the midday
 * price — wins the MAJORITY of sessions, because price stays in a range most days. This script measures
 * that win rate against REAL minute bars so the `CONDOR_WINRATE_BY_WIDTH` table in
 * `src/lib/zerodte/iron-condor.ts` is evidence, not assertion.
 *
 * WHAT IT MEASURES (per ticker × session, entry at --entry ET, settle at session close):
 *   1. WIDTH SWEEP — for each short-strike width W, WIN = close lands inside BOTH shorts (±W of entry).
 *      This is the empirical table the engine's width→WR map is calibrated from.
 *   2. SHIPPED GEOMETRY — grades the ACTUAL `selectIronCondor({ spot, targetWinRate })` legs (same code
 *      the board would use), so the module's real picks are validated, not a parallel re-implementation.
 *   3. HONEST NEGATIVE-SKEW STAT — intraday BREACH rate: how often price *touched* a short strike before
 *      close (tested-then-recovered = still a win at settlement, but the assignment/gamma risk the module
 *      warns about). High WR is small-credit-most-days + a defined loss on breakout days; this quantifies
 *      the tail.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/condor-wr.mjs [--tickers=SPY,QQQ,IWM] [--days=25] [--end=YYYY-MM-DD]
 *        [--entry=11:00] [--target=80] [--wing=0.005] [--dates=d1,d2,...] [--json]
 *
 * Secrets from env only (POLYGON_API_KEY). Self-defaults POLYGON_API_BASE. Read-only; nothing written.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const { fetchAggBars } = await import("../../src/lib/providers/polygon-largo.ts");
const { selectIronCondor, estWinRateForWidth, CONDOR_WINRATE_BY_WIDTH } = await import(
  "../../src/lib/zerodte/iron-condor.ts"
);

// ── args ────────────────────────────────────────────────────────────────────────
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

const TICKERS = arg("tickers", "SPY,QQQ,IWM").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const DAYS = Number(arg("days", "25"));
const END = arg("end", ""); // YYYY-MM-DD; default = latest available
const [ENTRY_H, ENTRY_M] = arg("entry", "11:00").split(":").map(Number);
const ENTRY_MIN = ENTRY_H * 60 + (ENTRY_M || 0);
const TARGET = Number(arg("target", "80"));
const WING = Number(arg("wing", "0.005"));
const EXPLICIT_DATES = arg("dates", "").split(",").map((s) => s.trim()).filter(Boolean);
const JSON_OUT = flag("json");
const WIDTHS = CONDOR_WINRATE_BY_WIDTH.map((r) => r.width_pct); // sweep the same widths the table uses

// ── helpers ───────────────────────────────────────────────────────────────────────
const etMin = (x) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date(x));
  return Number(p.find((z) => z.type === "hour")?.value ?? 0) * 60 + Number(p.find((z) => z.type === "minute")?.value ?? 0);
};
const etDate = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(x)); // YYYY-MM-DD
const clean = (b) => (b ?? [])
  .map((x) => ({ t: x.t, h: x.h, l: x.l, c: x.c }))
  .filter((x) => [x.t, x.h, x.l, x.c].every(Number.isFinite) && x.c > 0)
  .sort((a, z) => a.t - z.t);

// ── session list: derive from real SPY daily bars ending at --end (auto-adapts to calendar) ──
async function sessionDates() {
  if (EXPLICIT_DATES.length) return EXPLICIT_DATES;
  const to = END || etDate(Date.now());
  const fromMs = new Date(`${to}T00:00:00Z`).getTime() - Math.ceil(DAYS * 1.8 + 10) * 86400_000;
  const from = new Date(fromMs).toISOString().slice(0, 10);
  const daily = clean(await fetchAggBars("SPY", 1, "day", from, to, "400").catch(() => []));
  const days = [...new Set(daily.map((b) => etDate(b.t)))].sort();
  return days.slice(-DAYS);
}

async function main() {
  const DATES = await sessionDates();
  if (!DATES.length) {
    console.error("No sessions resolved — check POLYGON_API_KEY / --dates / --end.");
    process.exit(1);
  }

  const sweep = {}; // width → { n, inside }
  WIDTHS.forEach((w) => (sweep[w] = { n: 0, inside: 0 }));
  const shipped = { n: 0, wins: 0, breaches: 0, nullLegs: 0 }; // graded selectIronCondor picks
  const perSession = [];

  for (const date of DATES) {
    for (const t of TICKERS) {
      const u = clean(await fetchAggBars(t, 1, "minute", date, date, "1500").catch(() => []));
      if (u.length < 5) continue;
      const at = u.find((b) => etMin(b.t) >= ENTRY_MIN);
      if (!at) continue;
      const entry = at.c;
      const post = u.filter((b) => b.t >= at.t); // entry → close
      const close = post.at(-1).c;

      // (1) width sweep — WIN = close inside both shorts (±W)
      for (const w of WIDTHS) {
        sweep[w].n++;
        if (close >= entry * (1 - w) && close <= entry * (1 + w)) sweep[w].inside++;
      }

      // (2) shipped geometry — grade the module's actual legs (no walls in a pure minute backtest)
      const legs = selectIronCondor({ spot: entry, targetWinRate: TARGET, wingPct: WING });
      if (!legs) {
        shipped.nullLegs++;
      } else {
        shipped.n++;
        const win = close < legs.short_call && close > legs.short_put;
        if (win) shipped.wins++;
        // intraday breach: did any bar after entry pierce a short strike? (tested-then-recovered risk)
        const breached = post.some((b) => b.h >= legs.short_call || b.l <= legs.short_put);
        if (breached) shipped.breaches++;
        perSession.push({ date, ticker: t, entry, close, ...legs, win, breached });
      }
    }
  }

  const table = WIDTHS.map((w) => ({
    width_pct: w,
    n: sweep[w].n,
    win_rate: sweep[w].n ? Number(((sweep[w].inside / sweep[w].n) * 100).toFixed(1)) : null,
    table_win_rate: estWinRateForWidth(w),
  }));
  const shippedWr = shipped.n ? Number(((shipped.wins / shipped.n) * 100).toFixed(1)) : null;
  const breachRate = shipped.n ? Number(((shipped.breaches / shipped.n) * 100).toFixed(1)) : null;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      sessions: DATES.length, tickers: TICKERS, entry_et: arg("entry", "11:00"), target: TARGET,
      width_sweep: table, shipped: { ...shipped, win_rate: shippedWr, breach_rate: breachRate },
      losses: perSession.filter((p) => !p.win), // the defined-risk tail — inspect the sessions that lost
      trades: flag("trades") ? perSession : undefined, // full per-trade detail only when asked (large)
    }, null, 2));
    return;
  }

  console.log(`\n0DTE IRON-CONDOR WIN RATE — short strikes ±W% from ${arg("entry", "11:00")} ET price, WIN = close inside both`);
  console.log(`${TICKERS.join(",")} × ${DATES.length} sessions  (${DATES[0]} → ${DATES.at(-1)})\n`);
  console.log(`${"short width".padEnd(13)}${"n".padStart(5)}${"WIN%".padStart(8)}${"table".padStart(8)}`);
  console.log("-".repeat(34));
  for (const r of table) {
    console.log(
      `±${(r.width_pct * 100).toFixed(2)}%`.padEnd(13) +
      String(r.n).padStart(5) +
      (r.win_rate == null ? "—" : r.win_rate.toFixed(1)).padStart(8) +
      `${r.table_win_rate}%`.padStart(8),
    );
  }
  console.log(`\nSHIPPED selectIronCondor(target=${TARGET}, wing=${WING}) over the same tape:`);
  console.log(`  graded ${shipped.n}  |  WIN RATE ${shippedWr}%  |  intraday breach ${breachRate}% (tested-then-recovered = still a win at close)`);
  console.log(`\nNote: wider strikes = higher WR but smaller credit. High WR is NEGATIVE skew — small credit most`);
  console.log(`days, a DEFINED loss on breakout days. WR is real; profitability needs the credit priced right +`);
  console.log(`a breach stop + small size (see the HONEST SKEW WARNING in src/lib/zerodte/iron-condor.ts).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
