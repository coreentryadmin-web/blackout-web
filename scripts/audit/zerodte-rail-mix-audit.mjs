/**
 * 0DTE DISCOVERY RAIL MIX AUDIT — CloudWatch evidence for "why so few WATCH/OPEN plays?"
 *
 * Pulls production `[zerodte-scan] discovery rail mix` lines (one per scan cycle) and
 * `[zerodte-breakout] … built N setup(s)` chain-walk stats for a session, then rolls up:
 *   - hourly candidate counts per rail (FLOW / BREAKOUT / PIN)
 *   - peak cycle totals
 *   - BREAKOUT chain-walk failure rates (no_chain / no_same_day_contract)
 *
 * Requires AWS CLI creds with logs:FilterLogEvents on `/ecs/blackout-production`.
 * Optional: `--score-band` runs the production breakout score map over grouped-daily
 * (Polygon) to quantify how many names sit in the 65–69 band blocked by G-3's 70 floor.
 *
 * Usage:
 *   node --import tsx scripts/audit/zerodte-rail-mix-audit.mjs --date=2026-08-03 [--json] [--score-band]
 */
import { execSync } from "node:child_process";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const JSON_OUT = argv.json === true || argv.json === "true";
const SCORE_BAND = argv["score-band"] === true || argv["score-band"] === "true";
const LOG_GROUP = process.env.ZERODTE_RAIL_LOG_GROUP ?? "/ecs/blackout-production";

function awsCliRegion() {
  const fromEnv = process.env.AWS_CLI_REGION ?? process.env.AWS_REGION;
  if (fromEnv) return fromEnv;
  try {
    return execSync("aws configure get region", { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Set AWS_CLI_REGION or configure aws CLI region for CloudWatch log pull");
  }
}

/** Resolve YYYY-MM-DD: explicit --date, else last weekday. */
function resolveDate() {
  if (argv.date && argv.date !== true) return String(argv.date).slice(0, 10);
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return new Date().toISOString().slice(0, 10);
}

/** Aug EDT = UTC-4 (repo RTH audits use -4 for summer sessions). */
function sessionUtcBounds(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  // 09:26 ET ≈ first rail-mix line seen; 16:04 ET last — pad 09:00–16:30 ET.
  const start = Date.UTC(y, m - 1, d, 13, 0, 0);
  const end = Date.UTC(y, m - 1, d, 20, 30, 0);
  return { start, end };
}

function awsFilterLogEvents({ startTime, endTime, filterPattern }) {
  const region = awsCliRegion();
  const events = [];
  let nextToken = null;
  for (;;) {
    const args = [
      "logs",
      "filter-log-events",
      "--region",
      region,
      "--log-group-name",
      LOG_GROUP,
      "--filter-pattern",
      filterPattern,
      "--start-time",
      String(startTime),
      "--end-time",
      String(endTime),
      "--limit",
      "10000",
    ];
    if (nextToken) args.push("--next-token", nextToken);
    const out = JSON.parse(execSync(["aws", ...args].map((s) => JSON.stringify(s)).join(" "), { encoding: "utf8" }));
    events.push(...(out.events ?? []));
    nextToken = out.nextToken;
    if (!nextToken) break;
  }
  return events;
}

const RAIL_RE =
  /discovery rail mix total=(\d+) FLOW=(\d+) BREAKOUT=(\d+) PIN=(\d+) multi=(\d+) merge_policy=(\S+)/;
const BRK_RE =
  /built (\d+) setup\(s\) \((\d+)L\/(\d+)S\) from walk (\d+)L\+(\d+)S attempted=(\d+) no_chain=(\d+) no_same_day=(\d+)/;

function etHourBucket(tsMs) {
  const etH = new Date(tsMs - 4 * 3600_000).getUTCHours();
  return `${String(etH).padStart(2, "0")}:xx`;
}

function summarizeRailMix(events) {
  const rows = [];
  for (const e of events) {
    const m = RAIL_RE.exec(e.message ?? "");
    if (!m) continue;
    rows.push({
      ts: e.timestamp,
      total: +m[1],
      flow: +m[2],
      breakout: +m[3],
      pin: +m[4],
      multi: +m[5],
      merge_policy: m[6],
    });
  }
  if (rows.length === 0) return null;

  const avg = (arr, key) => arr.reduce((s, r) => s + r[key], 0) / arr.length;
  const max = (arr, key) => Math.max(...arr.map((r) => r[key]));

  const hourly = {};
  for (const r of rows) {
    const h = etHourBucket(r.ts);
    (hourly[h] ??= []).push(r);
  }
  const hourlyAvg = Object.fromEntries(
    Object.entries(hourly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([h, vals]) => [
        h,
        {
          cycles: vals.length,
          total: +avg(vals, "total").toFixed(1),
          flow: +avg(vals, "flow").toFixed(1),
          breakout: +avg(vals, "breakout").toFixed(1),
          pin: +avg(vals, "pin").toFixed(1),
          multi: +avg(vals, "multi").toFixed(1),
        },
      ]),
  );

  const core = rows.filter((r) => {
    const h = new Date(r.ts - 4 * 3600_000).getUTCHours();
    return h >= 10 && h < 15;
  });

  return {
    cycles: rows.length,
    avg_total: +avg(rows, "total").toFixed(1),
    max_total: max(rows, "total"),
    max_flow: max(rows, "flow"),
    max_breakout: max(rows, "breakout"),
    max_pin: max(rows, "pin"),
    max_multi: max(rows, "multi"),
    core_10_15_et: core.length
      ? {
          cycles: core.length,
          avg_total: +avg(core, "total").toFixed(1),
          max_total: max(core, "total"),
        }
      : null,
    hourly: hourlyAvg,
    top_cycles: [...rows].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}

function summarizeBreakout(events) {
  const rows = [];
  for (const e of events) {
    const m = BRK_RE.exec(e.message ?? "");
    if (!m) continue;
    rows.push({
      built: +m[1],
      long: +m[2],
      short: +m[3],
      attempted: +m[6],
      no_chain: +m[7],
      no_same_day: +m[8],
    });
  }
  if (rows.length === 0) return null;
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  const avg = (key) => sum(key) / rows.length;
  const totalAttempted = sum("attempted");
  const totalNoSameDay = sum("no_same_day");
  return {
    cycles: rows.length,
    avg_built: +avg("built").toFixed(1),
    max_built: Math.max(...rows.map((r) => r.built)),
    avg_attempted: +avg("attempted").toFixed(1),
    no_same_day_rate_pct: totalAttempted > 0 ? +((100 * totalNoSameDay) / totalAttempted).toFixed(1) : null,
    no_same_day_of_attempted: `${totalNoSameDay}/${totalAttempted}`,
  };
}

async function scoreBandReport(ymd) {
  const KEY = process.env.POLYGON_API_KEY;
  if (!KEY) return { skipped: "POLYGON_API_KEY absent" };
  const rawBase = process.env.POLYGON_API_BASE;
  const BASE = rawBase && /^https?:\/\//.test(rawBase) ? rawBase : "https://api.polygon.io";
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const { screenBreakoutMovers } = await import(`${SRC}features/nighthawk/lib/candidates.ts`);
  const { breakoutScore } = await import(`${SRC}lib/zerodte/breakout-source.ts`);

  const gd = await fetch(`${BASE}/v2/aggs/grouped/locale/us/market/stocks/${ymd}?adjusted=true&apiKey=${KEY}`).then(
    (r) => r.json(),
  );
  const movers = screenBreakoutMovers(gd?.results ?? []);
  const maxDollar = Math.max(...movers.map((m) => m.dollar), 1);
  const scored = movers.map((m) => ({
    ticker: m.ticker,
    gain_pct: +((m.gain ?? 0) * 100).toFixed(2),
    score: breakoutScore(m, m.dollar / maxDollar, "long"),
  }));
  const band6570 = scored.filter((s) => s.score >= 65 && s.score < 70);
  return {
    qualifying_movers: scored.length,
    pass_at_floor_70: scored.filter((s) => s.score >= 70).length,
    pass_at_floor_65: scored.filter((s) => s.score >= 65).length,
    added_by_65_vs_70: band6570.length,
    band_65_69: band6570.sort((a, b) => b.score - a.score).slice(0, 12),
  };
}

const date = resolveDate();
const { start, end } = sessionUtcBounds(date);

const railEvents = awsFilterLogEvents({
  startTime: start,
  endTime: end,
  filterPattern: '"discovery rail mix"',
});
const brkEvents = awsFilterLogEvents({
  startTime: start,
  endTime: end,
  filterPattern: '"[zerodte-breakout]"',
});

const report = {
  date,
  log_group: LOG_GROUP,
  rail_mix: summarizeRailMix(railEvents),
  breakout_chain: summarizeBreakout(brkEvents),
  score_band: SCORE_BAND ? await scoreBandReport(date) : null,
  interpretation: [
    "Discovery emits ~8–11 merged candidates/cycle on heavy days — NOT a 12k scan on the live board.",
    "FLOW is UW whale-print accumulation (≥$200k gross); BREAKOUT screens ~12k grouped-daily but chain-walk keeps ~1–3/cycle.",
    "PIN=0 all session means no clean long-gamma pin regime — not a gate bug.",
    "OPEN count = ledger commits only; WATCH = gate-blocked survivors from the same small pool.",
  ],
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n=== 0DTE RAIL MIX AUDIT · ${date} ===\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (!report.rail_mix) {
  console.error(`No rail-mix lines found for ${date} in ${LOG_GROUP}.`);
  process.exit(2);
}
