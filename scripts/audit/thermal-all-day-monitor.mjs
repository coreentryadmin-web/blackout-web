#!/usr/bin/env node
/**
 * Thermal all-day bug hunter — runs until 16:15 ET (or --forever).
 * Simulates an open compare grid (force=1 cadence), rotates all sector presets,
 * checks matrix integrity, writes bugs to JSONL, hourly UI audit.
 *
 *   node scripts/audit/thermal-all-day-monitor.mjs [--until-close] [--forever]
 */
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const APP = (process.env.AUDIT_APP_URL || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/thermal-all-day-monitor";
const BUGS = join(OUT, "bugs.jsonl");
const LOG = join(OUT, "monitor.log");
const SUMMARY = join(OUT, "hourly-summary.jsonl");

mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const FOREVER = args.includes("--forever");
const UNTIL_CLOSE = args.includes("--until-close") || !FOREVER;

const PRESETS = [
  { id: "indices", tickers: ["SPY", "SPX", "QQQ", "IWM"] },
  { id: "semis", tickers: ["NVDA", "AMD", "AVGO", "MU", "SMCI", "INTC", "TSM"] },
  { id: "mega", tickers: ["NVDA", "AAPL", "MSFT", "GOOG", "AMZN", "META", "TSLA"] },
  { id: "ai", tickers: ["PLTR", "ORCL", "ANET", "VRT", "ARM"] },
  { id: "macro", tickers: ["TLT", "GLD", "IBIT"] },
  { id: "crypto", tickers: ["COIN", "MSTR", "HOOD", "MARA", "RIOT"] },
  { id: "energy", tickers: ["XOM", "CVX", "OXY", "SLB", "COP"] },
  { id: "financials", tickers: ["JPM", "GS", "BAC", "MS", "V"] },
  { id: "healthcare", tickers: ["LLY", "UNH", "MRK", "ABBV", "GILD"] },
  { id: "space", tickers: ["RKLB", "ASTS", "LUNR", "BA"] },
];

const GRID_SIM = ["SPY", "SPX", "QQQ", "NVDA", "AMD", "AAPL", "META"];
const CADENCE_INTERVAL_MS = 6_500; // >5s force throttle
const SECTOR_TICK_DELAY_MS = 450;
const SESSION_REFRESH_MS = 40 * 60_000;
const UI_AUDIT_EVERY_MS = 45 * 60_000;
const FORCE_STALE_BUG_SEC = 12;
const PASSIVE_STALE_WARN_SEC = 90;

function log(line) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}`;
  console.log(line);
  appendFileSync(LOG, msg + "\n");
}

function recordBug(bug) {
  const row = { ts: new Date().toISOString(), ...bug };
  appendFileSync(BUGS, JSON.stringify(row) + "\n");
  log(`  *** BUG [${bug.severity}] ${bug.code}: ${bug.detail}`);
}

function etNow() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
}

function isRth() {
  const d = etNow();
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60 + 15;
}

function shouldStop() {
  if (FOREVER) return false;
  if (!UNTIL_CLOSE) return false;
  const d = etNow();
  const day = d.getDay();
  if (day === 0 || day === 6) return true;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 16 * 60 + 15;
}

function todayEtYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function sumStrikeTotals(strikeTotals) {
  let s = 0;
  for (const v of Object.values(strikeTotals ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) s += v;
  }
  return s;
}

async function fetchHeatmap(cookie, ticker, { force = false } = {}) {
  const q = force ? "&force=1" : "";
  const url = `${APP}/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}&lens=gex${q}`;
  const res = await fetch(url, {
    headers: { Cookie: cookie, "Cache-Control": "no-cache", Pragma: "no-cache" },
    cache: "no-store",
  });
  if (res.status === 401) return { authError: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function integrityCheck(ticker, payload) {
  const bugs = [];
  const gex = payload.gex;
  if (!gex) return bugs;
  const total = gex.total;
  const sum = sumStrikeTotals(gex.strike_totals);
  if (typeof total === "number" && Math.abs(total - sum) > 0.01) {
    bugs.push({
      severity: "RED",
      code: "gex_total_mismatch",
      ticker,
      detail: `total=${total} Σstrike=${sum} Δ=${Math.abs(total - sum).toFixed(2)}`,
    });
  }
  if (!(payload.spot > 0)) {
    bugs.push({ severity: "RED", code: "spot_missing", ticker, detail: "spot ≤ 0" });
  }
  if (!payload.expiries?.length) {
    bugs.push({ severity: "RED", code: "no_expiries", ticker, detail: "empty expiry axis" });
  }
  const today = todayEtYmd();
  const has0dte = payload.expiries?.some((e) => e === today || e.startsWith(today));
  if (!has0dte && payload.expiries?.length) {
    bugs.push({
      severity: "AMBER",
      code: "no_0dte_listed",
      ticker,
      detail: `no daily expiry for ${today}; front=${payload.expiries[0]}`,
    });
  }
  return bugs;
}

async function mintSession() {
  const s = await mintClerkPremiumSession({ appUrl: APP });
  if (s.skip) throw new Error(s.reason);
  return s;
}

async function withAuth(session, ticker, opts) {
  let payload = await fetchHeatmap(session.cookieHeader, ticker, opts);
  if (payload.authError) {
    await session.cleanup();
    const next = await mintSession();
    Object.assign(session, next);
    payload = await fetchHeatmap(session.cookieHeader, ticker, opts);
    if (payload.authError) throw new Error("auth failed after re-mint");
  }
  return payload;
}

function asofAgeSec(asof) {
  if (!asof) return null;
  const t = new Date(asof).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 1000 : null;
}

async function runUiAudit() {
  return new Promise((resolve) => {
    log("\n── hourly UI clickthrough ──");
    const child = spawn("node", ["scripts/audit/thermal-ui-clickthrough.mjs"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    child.on("close", (code) => {
      const fails = (out.match(/\[FAIL\]/g) || []).length;
      const warns = (out.match(/\[WARN\]/g) || []).length;
      log(`  UI audit exit=${code} FAIL=${fails} WARN=${warns}`);
      if (fails > 0) {
        recordBug({
          severity: "RED",
          code: "ui_clickthrough_fail",
          detail: `${fails} FAIL in thermal-ui-clickthrough`,
        });
      }
      resolve({ code, fails, warns });
    });
  });
}

async function main() {
  let session = await mintSession();
  let sessionStarted = Date.now();
  let tick = 0;
  let presetIdx = 0;
  let lastUiAudit = 0;
  const stats = {
    started: new Date().toISOString(),
    ticks: 0,
    sectorLoads: 0,
    sectorFails: 0,
    gridSimPolls: 0,
    bugs: 0,
    forceStale: 0,
  };

  // Resume bug count if file exists
  try {
    const prev = readFileSync(BUGS, "utf8").trim().split("\n").filter(Boolean);
    stats.bugs = prev.length;
  } catch {
    /* fresh run */
  }

  log(`\n=== Thermal all-day bug hunter ===`);
  log(`Target: ${APP}`);
  log(`Mode: ${FOREVER ? "forever" : "until 16:15 ET"}`);
  log(`Grid-sim tickers: ${GRID_SIM.join(", ")}`);
  log(`Bugs log: ${BUGS}\n`);

  if (Date.now() - lastUiAudit > UI_AUDIT_EVERY_MS) {
    lastUiAudit = Date.now();
    await runUiAudit();
  }

  while (!shouldStop()) {
    if (!isRth()) {
      log("Off RTH — sleeping 60s");
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }

    if (Date.now() - sessionStarted > SESSION_REFRESH_MS) {
      log("Proactive session refresh");
      await session.cleanup();
      session = await mintSession();
      sessionStarted = Date.now();
    }

    if (Date.now() - lastUiAudit >= UI_AUDIT_EVERY_MS) {
      lastUiAudit = Date.now();
      await runUiAudit();
    }

    tick++;
    stats.ticks = tick;
    const et = etNow().toLocaleString("en-US");
    log(`\n── tick ${tick} · ${et} ET ──`);

    // Grid simulation: force refresh each hot column (compare desk open)
    for (const ticker of GRID_SIM) {
      try {
        const payload = await withAuth(session, ticker, { force: true });
        stats.gridSimPolls++;
        if (!payload?.available) {
          stats.sectorFails++;
          recordBug({
            severity: "RED",
            code: "grid_unavailable",
            ticker,
            detail: "compare-grid ticker unavailable",
          });
          continue;
        }
        const age = asofAgeSec(payload.asof);
        const ageStr = age?.toFixed(1) ?? "?";
        if (age != null && age > FORCE_STALE_BUG_SEC) {
          stats.forceStale++;
          recordBug({
            severity: "RED",
            code: "force_stale_asof",
            ticker,
            detail: `force=1 but asof age ${ageStr}s (>${FORCE_STALE_BUG_SEC}s)`,
          });
          log(`  [BUG] grid-sim/${ticker} force stale asof=${ageStr}s`);
        } else {
          log(`  [OK] grid-sim/${ticker} asof age=${ageStr}s spot=${payload.spot?.toFixed?.(2)}`);
        }
        for (const b of integrityCheck(ticker, payload)) {
          stats.bugs++;
          recordBug(b);
        }
      } catch (e) {
        stats.sectorFails++;
        recordBug({
          severity: "RED",
          code: "grid_fetch_error",
          ticker,
          detail: String(e.message || e).slice(0, 120),
        });
        log(`  [FAIL] grid-sim/${ticker} — ${String(e.message || e).slice(0, 80)}`);
      }
      await new Promise((r) => setTimeout(r, CADENCE_INTERVAL_MS));
    }

    // One sector preset per tick
    const preset = PRESETS[presetIdx % PRESETS.length];
    presetIdx++;
    let ok = 0;
    for (const ticker of preset.tickers) {
      try {
        const payload = await withAuth(session, ticker, { force: false });
        if (!payload?.available) throw new Error("unavailable");
        ok++;
        stats.sectorLoads++;
        const age = asofAgeSec(payload.asof);
        if (age != null && age > PASSIVE_STALE_WARN_SEC) {
          recordBug({
            severity: "AMBER",
            code: "passive_stale_cache",
            ticker,
            preset: preset.id,
            detail: `passive read asof age ${age.toFixed(1)}s — cold until viewed/ warmed`,
          });
        }
        for (const b of integrityCheck(ticker, payload)) {
          recordBug(b);
        }
      } catch (e) {
        stats.sectorFails++;
        recordBug({
          severity: "RED",
          code: "sector_load_fail",
          ticker,
          preset: preset.id,
          detail: String(e.message || e).slice(0, 120),
        });
        log(`  [FAIL] ${preset.id}/${ticker} — ${String(e.message || e).slice(0, 80)}`);
      }
      await new Promise((r) => setTimeout(r, SECTOR_TICK_DELAY_MS));
    }
    log(`  → sector ${preset.id}: ${ok}/${preset.tickers.length} OK`);

    // Hourly summary snapshot
    if (tick % 8 === 0) {
      const snap = { ts: new Date().toISOString(), tick, ...stats };
      appendFileSync(SUMMARY, JSON.stringify(snap) + "\n");
      writeFileSync(join(OUT, "status.json"), JSON.stringify(snap, null, 2));
      log(`  … status: ticks=${stats.ticks} bugs=${stats.bugs} forceStale=${stats.forceStale} sectorFails=${stats.sectorFails}`);
    }
  }

  await session.cleanup();
  log(`\n=== Stopped (${shouldStop() ? "market close / weekend" : "manual"}) ===`);
  log(`Ticks: ${stats.ticks} · Bugs logged: ${stats.bugs} · Force-stale: ${stats.forceStale}`);
  writeFileSync(join(OUT, "final-status.json"), JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  log(`FATAL: ${e.stack || e}`);
  process.exit(2);
});
