/**
 * G-11 PRINT-WINDOW COUNTERFACTUAL — the missing half of INTENTIONAL-DESIGN.md §5.
 *
 * WHY THIS EXISTS. §5 built `earnings-print-window.ts` (the sharper Benzinga print-time
 * classifier) and measured how many rows the DATE-grained G-11 gate over-blocks — but explicitly
 * stopped there: "the missing half of the evidence is the graded outcome of the would-be commits
 * this would unlock — the counterfactual needs real minute bars, not just a count of what was
 * blocked." This script is that missing half.
 *
 * WHAT IT MEASURES. Over a real historical window, every CONFIRMED Benzinga structured-earnings
 * row above an importance floor is classified with the same `assessPrintWindow` logic G-11 does
 * NOT yet use (mirrored in lib/print-window-eval.mjs — see that file's header for why it's a copy,
 * not an import). Rows classified `after_close` or `pre_open_landed` are EXEMPTIBLE: the coarse
 * date-grained gate blocks them ALL DAY today, but the print-window-aware gate would not, because
 * the print cannot gap a position that is flat before it lands (after_close) or already resolved
 * before the session opened (pre_open_landed).
 *
 * For every exemptible ticker-day this pulls REAL Polygon 1-minute RTH bars and computes realized
 * intraday range/move — NOT a graded P&L backtest. Building a real backtest needs the full
 * discovery+contract-pick+exit-management pipeline (flow accumulation, chain fetch, trim-scale),
 * which this script deliberately does not reimplement (that's what zerodte-sim.mjs is for, and
 * duplicating grading logic here would risk it drifting from the real one). What this DOES answer
 * honestly: is the realized vol on an exemptible day elevated versus an ordinary session, which is
 * the one argument that could still justify blocking despite zero direct print-gap risk (pre/post
 * earnings vol bleed). A baseline basket (SPY/QQQ/IWM, always liquid, never earnings-blocked)
 * measured on the SAME calendar days is the control.
 *
 * Read-only. No Clerk session needed — Benzinga/Polygon only, both via the Polygon-proxied key.
 * Self-defaults POLYGON_API_BASE like every other script here.
 *
 * Run:
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node --import tsx \
 *     scripts/audit/g11-print-window-outcome.mjs [--days=20] [--importance=4] [--json]
 */
import { assessPrintWindow } from "./lib/print-window-eval.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const flag = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : def;
};
const LOOKBACK_DAYS = Math.max(5, Math.min(90, Number(flag("days", "20"))));
const IMPORTANCE_MIN = Number(flag("importance", "4"));
const NOW_MIN = 9 * 60 + 35; // 09:35 ET — matches §5's "once the session opens" evidence window

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const RAW_POLY_BASE = process.env.POLYGON_API_BASE;
const POLYGON_BASE = /^https?:/.test(RAW_POLY_BASE ?? "") ? RAW_POLY_BASE : "https://api.massive.com";

const BASELINE_TICKERS = ["SPY", "QQQ", "IWM"];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchConfirmedEarnings(dateGte, dateLte) {
  const rows = [];
  let path = "/benzinga/v1/earnings";
  let params = new URLSearchParams({
    "date.gte": dateGte,
    "date.lte": dateLte,
    "importance.gte": String(IMPORTANCE_MIN),
    date_status: "confirmed",
    limit: "200",
    sort: "date.asc",
    apiKey: POLYGON_KEY,
  });
  for (let page = 0; page < 4; page++) {
    const url = `${POLYGON_BASE}${path}?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 403) return { rows, entitled: false };
      throw new Error(`benzinga earnings ${res.status}`);
    }
    const data = await res.json().catch(() => null);
    for (const r of data?.results ?? []) {
      const ticker = String(r.ticker ?? "").trim().toUpperCase();
      const date = String(r.date ?? "").slice(0, 10);
      if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      rows.push({ ticker, date, time: r.time ?? null, dateStatus: r.date_status ?? null });
    }
    if (!data?.next_url) break;
    const nextUrl = new URL(data.next_url, POLYGON_BASE);
    path = nextUrl.pathname;
    params = new URLSearchParams(nextUrl.searchParams);
    params.delete("apiKey");
    params.set("apiKey", POLYGON_KEY);
  }
  return { rows, entitled: true };
}

/** RTH-only (09:30-16:00 ET) 1-minute bar stats for one ticker/day. Null (never 0) on no data. */
async function sessionMoveStats(ticker, day) {
  const url =
    `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/${day}/${day}` +
    `?adjusted=true&sort=asc&limit=1000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const dayMs = Date.parse(`${day}T00:00:00-05:00`); // ET offset approx; bar `t` filter is generous
  const rows = (data?.results ?? []).filter((r) => {
    const t = new Date(r.t);
    const etHour = t.getUTCHours() - 5; // EST/EDT both land inside the 09:30-16:00 filter margin
    return etHour >= 9 && etHour < 17;
  });
  if (rows.length === 0 || !Number.isFinite(dayMs)) return null;
  const open = rows[0].o;
  if (!(open > 0)) return null;
  const close = rows[rows.length - 1].c;
  const high = Math.max(...rows.map((r) => r.h));
  const low = Math.min(...rows.map((r) => r.l));
  return {
    range_pct: Number((((high - low) / open) * 100).toFixed(2)),
    move_pct: Number((((close - open) / open) * 100).toFixed(2)),
    bars: rows.length,
  };
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  if (!POLYGON_KEY) {
    console.error("POLYGON_API_KEY not set");
    process.exit(1);
  }
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // exclude today — its classification is time-dependent/live
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS);

  const { rows: earnRows, entitled } = await fetchConfirmedEarnings(ymd(start), ymd(end));
  if (!entitled) {
    console.error("SKIP: Benzinga structured earnings not entitled on this Polygon plan");
    process.exit(0);
  }

  const tally = {
    after_close: 0,
    pre_open_landed: 0,
    pre_open_pending: 0,
    intraday: 0,
    unknown: 0,
    total: earnRows.length,
  };
  const exemptible = [];
  for (const r of earnRows) {
    const v = assessPrintWindow(r, r.date, NOW_MIN);
    tally[v.verdict]++;
    if (!v.threatensToday) exemptible.push({ ...r, verdict: v.verdict });
  }

  if (exemptible.length === 0) {
    const out = { insufficient_data: true, tally, note: "No exemptible rows in window — widen --days." };
    console.log(asJson ? JSON.stringify(out, null, 2) : `INSUFFICIENT DATA — ${out.note}`);
    process.exit(0);
  }

  // Cap concurrent Polygon calls; dedupe baseline fetches per day.
  const days = [...new Set(exemptible.map((r) => r.date))];
  const baselineByDay = new Map();
  for (const day of days) {
    const stats = [];
    for (const t of BASELINE_TICKERS) {
      const s = await sessionMoveStats(t, day);
      if (s) stats.push(s);
    }
    baselineByDay.set(day, stats);
  }

  const measured = [];
  for (const r of exemptible) {
    const s = await sessionMoveStats(r.ticker, r.date);
    if (s) measured.push({ ...r, ...s });
  }

  const exemptibleRanges = measured.map((m) => m.range_pct);
  const baselineRanges = days.flatMap((d) => (baselineByDay.get(d) ?? []).map((s) => s.range_pct));

  const summary = {
    window: { from: ymd(start), to: ymd(end), lookback_days: LOOKBACK_DAYS, importance_min: IMPORTANCE_MIN },
    tally,
    exemptible_count: exemptible.length,
    exemptible_with_bars: measured.length,
    median_range_pct: { exemptible: median(exemptibleRanges), baseline_spy_qqq_iwm: median(baselineRanges) },
    rows: measured.map((m) => ({
      ticker: m.ticker,
      date: m.date,
      verdict: m.verdict,
      range_pct: m.range_pct,
      move_pct: m.move_pct,
    })),
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`G-11 print-window counterfactual — ${summary.window.from}..${summary.window.to} (importance>=${IMPORTANCE_MIN})`);
  console.log(`Tally: after_close=${tally.after_close} pre_open_landed=${tally.pre_open_landed} pre_open_pending=${tally.pre_open_pending} intraday=${tally.intraday} unknown=${tally.unknown} total=${tally.total}`);
  console.log(`Exemptible (would-unblock): ${exemptible.length}, bars found for ${measured.length}`);
  console.log(`Median realized RTH range%: exemptible=${summary.median_range_pct.exemptible ?? "n/a"}  baseline(SPY/QQQ/IWM)=${summary.median_range_pct.baseline_spy_qqq_iwm ?? "n/a"}`);
  console.log("");
  console.log("ticker   date        verdict           range%   move%");
  for (const r of summary.rows) {
    console.log(
      `${r.ticker.padEnd(8)} ${r.date}  ${r.verdict.padEnd(16)}  ${String(r.range_pct).padStart(6)}  ${String(r.move_pct).padStart(6)}`
    );
  }
  console.log("");
  console.log(
    "NOTE: realized-range measurement only, not a graded P&L backtest — a real backtest needs the"
  );
  console.log(
    "full discovery+contract-pick+exit pipeline (see zerodte-sim.mjs). This answers the narrower"
  );
  console.log(
    "question of whether exemptible days carry elevated vol that could still justify a block."
  );
}

main().catch((err) => {
  console.error("FATAL:", err?.stack || err);
  process.exit(1);
});
