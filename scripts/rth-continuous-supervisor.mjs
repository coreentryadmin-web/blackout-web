#!/usr/bin/env node
/**
 * RTH continuous supervisor — high-frequency data collection during cash session.
 *
 * Tiers (defaults tuned for max signal without melting prod):
 *   - Fast API probe:  every 2s  — all premium APIs + latency
 *   - Matrix probe:    every 15s — SPX Slayer + Thermal + Vector + Flows invariants
 *   - Browser probe:   every 45s — nav soft-click rotation + control clicks + paint times
 *   - Deep probe:      every 5m  — heatmap matrix audit (SPX) + member dashboard screenshot
 *
 * Metrics: audit-output/rth-continuous/YYYY-MM-DD/metrics.ndjson
 *
 * Usage:
 *   npm run validate:rth-continuous
 *   node scripts/rth-continuous-supervisor.mjs --once
 *   node scripts/rth-continuous-supervisor.mjs --fast-ms=1000 --browser-ms=30000
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 * Optional: CRON_SECRET (platform-warm on start), DATABASE_URL (cron freshness)
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { isTradingDayEt, todayEtYmd, etParts } from "./gha-et-window.mjs";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";
import {
  appendMetric,
  metricsPathForDate,
  THRESHOLDS,
  FAST_APIS,
  NAV_TOOLS,
} from "./audit/lib/rth-metrics.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const ONCE = process.argv.includes("--once");
const FORCE = process.argv.includes("--force");
const WAIT_OPEN = process.argv.includes("--wait-open");

function argMs(flag, fallback) {
  const a = process.argv.find((x) => x.startsWith(`${flag}=`));
  return a ? Math.max(500, Number(a.slice(flag.length + 1))) : fallback;
}

const FAST_MS = argMs("--fast-ms", 2000);
const MATRIX_MS = argMs("--matrix-ms", 15000);
const BROWSER_MS = argMs("--browser-ms", 45000);
const DEEP_MS = argMs("--deep-ms", 300000);

const OUT = join(process.cwd(), "audit-output", "rth-continuous");
mkdirSync(OUT, { recursive: true });

let tick = 0;
let lastFast = 0;
let lastMatrix = 0;
let lastBrowser = 0;
let lastDeep = 0;
let navIndex = 0;
let p1Streak = 0;
const activeIssues = new Map();

function inCashRth(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function msUntilOpen() {
  const now = new Date();
  const c = etParts(now);
  if (!isTradingDayEt(todayEtYmd(now))) return null;
  const open = 9 * 60 + 30;
  if (c.mins >= open) return 0;
  const sec = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", second: "numeric" }).format(now)
  );
  return (open - c.mins) * 60_000 - sec * 1000 - now.getMilliseconds();
}

function recordIssue(id, severity, detail) {
  activeIssues.set(id, { severity, detail, at: new Date().toISOString() });
  appendMetric({ kind: "issue", id, severity, detail });
}

function clearIssue(id) {
  if (activeIssues.delete(id)) appendMetric({ kind: "issue-clear", id });
}

async function warmPlatform() {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) return;
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api/cron/platform-warm?force=1`, {
      headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - t0);
    appendMetric({
      kind: "platform-warm",
      status: res.status,
      ms,
      warmed: body.warmed,
      total: body.total,
      ok: res.status === 200 && body.ok !== false,
    });
    console.log(`[warm] platform-warm ${res.status} ${ms}ms (${body.warmed}/${body.total})`);
  } catch (e) {
    recordIssue("platform-warm", "P1", e.message);
  }
}

async function fastProbe(cookieHeader) {
  const results = [];
  for (const api of FAST_APIS) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}${api.path}`, {
        headers: { Cookie: cookieHeader, Accept: "application/json" },
      });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      const warmMax = api.warmMax ?? THRESHOLDS.apiWarm;
      const fail = res.status !== 200 || ms > warmMax;
      results.push({ key: api.key, status: res.status, ms, fail });
      if (res.status !== 200) recordIssue(`api-${api.key}`, "P1", `HTTP ${res.status}`);
      else if (ms > THRESHOLDS.apiFast) recordIssue(`api-slow-${api.key}`, "P1", `${ms}ms`);
      else if (ms > warmMax) recordIssue(`api-warn-${api.key}`, "P2", `${ms}ms`);
      else clearIssue(`api-${api.key}`), clearIssue(`api-slow-${api.key}`), clearIssue(`api-warn-${api.key}`);
    } catch (e) {
      results.push({ key: api.key, status: 0, ms: -1, fail: true, err: e.message });
      recordIssue(`api-${api.key}`, "P1", e.message);
    }
  }
  appendMetric({ kind: "fast", tick, results });
  const fails = results.filter((r) => r.fail);
  if (fails.length) console.log(`[fast] tick=${tick} FAIL ${fails.map((f) => `${f.key}:${f.ms}ms`).join(", ")}`);
}

async function matrixProbe(cookieHeader) {
  const headers = { Cookie: cookieHeader, Accept: "application/json" };
  const probes = [];

  async function get(path) {
    const t0 = performance.now();
    const res = await fetch(`${BASE}${path}`, { headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, ms: Math.round(performance.now() - t0), body };
  }

  const spxHm = await get("/api/market/gex-heatmap?ticker=SPX");
  const spxDesk = await get("/api/market/spx/desk");
  const spyHm = await get("/api/market/gex-heatmap?ticker=SPY");
  const vecUni = await get("/api/market/vector/universe");
  const flows = await get("/api/market/flows?limit=30");

  const spxStrikes = spxHm.body?.gex?.strike_totals
    ? Object.keys(spxHm.body.gex.strike_totals).length
    : 0;
  const spyStrikes = spyHm.body?.gex?.strike_totals
    ? Object.keys(spyHm.body.gex.strike_totals).length
    : 0;
  const vecRows = Array.isArray(vecUni.body?.rows) ? vecUni.body.rows.length : 0;
  const flowRows = Array.isArray(flows.body?.flows) ? flows.body.flows.length : flows.body?.items?.length ?? 0;

  probes.push(
    { surface: "spx-slayer-matrix", strikes: spxStrikes, ms: spxHm.ms, status: spxHm.status },
    { surface: "thermal-spx", strikes: spxStrikes, ms: spxHm.ms },
    { surface: "thermal-spy", strikes: spyStrikes, ms: spyHm.ms },
    { surface: "vector-universe", rows: vecRows, ms: vecUni.ms },
    { surface: "helix-flows", rows: flowRows, ms: flows.ms }
  );

  const deskSpot = spxDesk.body?.price ?? spxDesk.body?.spot;
  const hmSpot = spxHm.body?.spot ?? spxHm.body?.summary?.spot;
  if (deskSpot && hmSpot && Math.abs(deskSpot - hmSpot) > Math.max(deskSpot * 0.002, 2)) {
    recordIssue("spot-desk-heatmap", "P1", `desk=${deskSpot} heatmap=${hmSpot}`);
  } else {
    clearIssue("spot-desk-heatmap");
  }

  if (spxStrikes < THRESHOLDS.matrixMinRows) {
    recordIssue("spx-matrix-thin", "P1", `only ${spxStrikes} strikes`);
  } else clearIssue("spx-matrix-thin");

  if (spyStrikes < 10) recordIssue("thermal-spy-thin", "P2", `${spyStrikes} strikes`);
  else clearIssue("thermal-spy-thin");

  if (vecRows < 10) recordIssue("vector-universe-thin", "P2", `${vecRows} rows`);
  else clearIssue("vector-universe-thin");

  appendMetric({ kind: "matrix", tick, deskSpot, hmSpot, probes });
  console.log(
    `[matrix] SPX=${spxStrikes} SPY=${spyStrikes} Vector=${vecRows} Flows=${flowRows} desk=${spxHm.ms}ms`
  );
}

async function browserProbe(session, page, consoleErrors) {
  const tool = NAV_TOOLS[navIndex % NAV_TOOLS.length];
  navIndex += 1;
  consoleErrors.length = 0;

  const navT0 = Date.now();
  let navMs = 0;
  let domMs = 0;
  let readyMs = 0;
  let clicks = [];

  try {
    const link = page.getByRole("link", { name: tool.navLabel }).first();
    if (await link.count()) {
      await link.click();
      navMs = Date.now() - navT0;
      await page.waitForLoadState("domcontentloaded", { timeout: 45_000 }).catch(() => null);
      domMs = Date.now() - navT0;
    } else {
      await page.goto(`${BASE}${tool.path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      domMs = Date.now() - navT0;
      navMs = domMs;
    }

    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 30_000 }).catch(() => null);
    await page.waitForFunction(tool.ready, { timeout: 30_000 }).catch(() => null);
    readyMs = Date.now() - navT0;

    if (tool.path === "/dashboard") {
      for (const name of [/GEX/i, /VEX/i]) {
        const tab = page.getByRole("tab", { name }).first();
        if (await tab.count()) {
          const c0 = Date.now();
          await tab.click();
          await page.waitForTimeout(400);
          clicks.push({ control: name.source, ms: Date.now() - c0 });
        }
      }
    }
    if (tool.path === "/heatmap") {
      for (const name of [/Profile/i, /Matrix/i]) {
        const tab = page.getByRole("tab", { name }).first();
        if (await tab.count()) {
          const c0 = Date.now();
          await tab.click();
          await page.waitForTimeout(500);
          clicks.push({ control: name.source, ms: Date.now() - c0 });
        }
      }
    }
    if (tool.path === "/vector") {
      const gexBtn = page.getByRole("button", { name: /GEX/i }).first();
      if (await gexBtn.count()) {
        const c0 = Date.now();
        await gexBtn.click();
        clicks.push({ control: "GEX-lens", ms: Date.now() - c0 });
      }
      const vexBtn = page.getByRole("button", { name: /VEX/i }).first();
      if (await vexBtn.count()) {
        const c0 = Date.now();
        await vexBtn.click();
        clicks.push({ control: "VEX-lens", ms: Date.now() - c0 });
      }
    }

    const matrixRows =
      tool.path === "/dashboard"
        ? await page.locator(".spx-gex-matrix-table tbody tr").count()
        : tool.path === "/heatmap"
          ? await page.locator(".gex-heatmap-panel").count()
          : 0;

    const entry = {
      kind: "browser",
      tick,
      tool: tool.path,
      navMs,
      domMs,
      readyMs,
      matrixRows,
      clicks,
      consoleErrors: consoleErrors.slice(0, 5),
    };
    appendMetric(entry);

    if (readyMs > THRESHOLDS.pageReady) recordIssue(`page-slow-${tool.path}`, "P1", `ready ${readyMs}ms`);
    else clearIssue(`page-slow-${tool.path}`);
    if (navMs > THRESHOLDS.navSoft && navMs < domMs) {
      recordIssue(`nav-slow-${tool.path}`, "P2", `soft-nav ${navMs}ms`);
    }
    if (consoleErrors.length) recordIssue(`console-${tool.path}`, "P2", consoleErrors[0]);

    console.log(`[browser] ${tool.path} nav=${navMs}ms ready=${readyMs}ms clicks=${clicks.length} console=${consoleErrors.length}`);
  } catch (e) {
    recordIssue(`browser-${tool.path}`, "P1", e.message);
    appendMetric({ kind: "browser", tick, tool: tool.path, error: e.message });
  }
}

function deepProbe() {
  console.log("[deep] heatmap-matrix-audit SPX + member-dashboard");
  const matrix = spawnSync("node", ["scripts/heatmap-matrix-audit.mjs", "--tickers=SPX"], {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });
  appendMetric({
    kind: "deep",
    step: "heatmap-matrix-spx",
    exit: matrix.status,
    ms: null,
    tail: (matrix.stdout || matrix.stderr || "").trim().split("\n").slice(-2).join(" | "),
  });

  const dash = spawnSync("npm", ["run", "validate:member-dashboard"], {
    stdio: "pipe",
    encoding: "utf8",
    env: { ...process.env, CRON_TARGET_BASE_URL: BASE },
  });
  appendMetric({
    kind: "deep",
    step: "member-dashboard",
    exit: dash.status,
    tail: (dash.stdout || dash.stderr || "").trim().split("\n").slice(-2).join(" | "),
  });

  if (matrix.status !== 0) recordIssue("deep-matrix", "P1", "heatmap-matrix-audit failed");
  if (dash.status !== 0) recordIssue("deep-dashboard", "P1", "member-dashboard failed");
}

async function main() {
  if (WAIT_OPEN) {
    const wait = msUntilOpen();
    if (wait != null && wait > 0) {
      console.log(`Waiting ${Math.round(wait / 1000)}s until 09:30 ET…`);
      await sleep(wait);
    }
  }

  const ymd = todayEtYmd();
  if (!FORCE && !isTradingDayEt(ymd)) {
    console.log(`${ymd} not a trading day — exit.`);
    process.exit(0);
  }
  if (!FORCE && !inCashRth() && !ONCE) {
    console.log("Outside cash RTH — use --force or --wait-open.");
    process.exit(0);
  }

  console.log(`\n=== RTH continuous supervisor ===`);
  console.log(`Base: ${BASE}`);
  console.log(`Cadence: fast=${FAST_MS}ms matrix=${MATRIX_MS}ms browser=${BROWSER_MS}ms deep=${DEEP_MS}ms`);
  console.log(`Metrics: ${metricsPathForDate(ymd)}\n`);

  await warmPlatform();

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    console.error(session.reason);
    process.exit(1);
  }

  const cookieHeader = session.cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(session.cookies);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 45_000 }).catch(() => null);

  const started = Date.now();
  const endAt = started + (ONCE ? 120_000 : 6.5 * 60 * 60 * 1000);

  try {
    while (Date.now() < endAt) {
      if (!FORCE && !ONCE && !inCashRth()) break;
      tick += 1;
      const now = Date.now();

      if (now - lastFast >= FAST_MS) {
        lastFast = now;
        await fastProbe(cookieHeader);
      }
      if (now - lastMatrix >= MATRIX_MS) {
        lastMatrix = now;
        await matrixProbe(cookieHeader);
      }
      if (now - lastBrowser >= BROWSER_MS) {
        lastBrowser = now;
        await browserProbe(session, page, consoleErrors);
      }
      if (now - lastDeep >= DEEP_MS) {
        lastDeep = now;
        deepProbe();
      }

      const p1 = [...activeIssues.values()].filter((i) => i.severity === "P1");
      if (p1.length) p1Streak += 1;
      else p1Streak = 0;

      if (tick % 30 === 0) {
        writeFileSync(
          join(OUT, ymd, "status.json"),
          JSON.stringify(
            {
              tick,
              uptime_ms: Date.now() - started,
              active_issues: [...activeIssues.entries()].map(([id, v]) => ({ id, ...v })),
              p1_streak: p1Streak,
            },
            null,
            2
          )
        );
      }

      if (ONCE && tick >= 3) break;
      await sleep(1000);
    }
  } finally {
    await browser.close();
    await session.cleanup?.();
  }

  const p1 = [...activeIssues.values()].filter((i) => i.severity === "P1");
  console.log(`\n=== Done === ticks=${tick} P1=${p1.length} metrics=${metricsPathForDate(ymd)}\n`);
  if (p1.length && !process.argv.includes("--allow-p1")) {
    for (const [id, v] of activeIssues) {
      if (v.severity === "P1") console.error(`  P1 ${id}: ${v.detail}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
