#!/usr/bin/env node
/**
 * Full-site latency audit — APIs + browser paint times for every premium surface.
 * Exit 1 when any P1 threshold breached (for CI / scheduled agents).
 *
 * Usage:
 *   node scripts/site-latency-audit.mjs [--base=https://blackouttrades.com]
 *   node scripts/site-latency-audit.mjs --base=https://staging.blackouttrades.com --api-only
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";
import { fetchRetry } from "./audit/lib/fetch-retry.mjs";

const args = process.argv.slice(2);
const API_ONLY = args.includes("--api-only") || process.env.SITE_LATENCY_API_ONLY === "1";
const BASE = (
  args.find((a) => a.startsWith("--base="))?.slice(7) ??
  process.env.CRON_TARGET_BASE_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const IS_STAGING = BASE.includes("staging.");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const P1_MS = 2_000;
const P2_MS = 1_000;
const WARN_MS = 800;

function etParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return { weekday: parts.weekday, mins: hour * 60 + minute };
}

/** Off regular US equity RTH (weekday 09:30–16:00 ET) — matrix/flow desks may be sparse. */
function isOffHoursEt(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return true;
  return mins < 9 * 60 + 30 || mins > 16 * 60;
}

const OFF_HOURS = isOffHoursEt();
const P2_CONTENT_MS = OFF_HOURS ? 1_500 : P2_MS;
const P1_PREWARM_MS = OFF_HOURS ? 5_000 : P1_MS;

const API_PATHS = [
  "/api/health",
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/pulse",
  "/api/market/spx/desk",
  "/api/market/spx/play",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/flows?limit=30",
  "/api/market/nighthawk/edition",
  "/api/market/zerodte/board",
  // Public member path — /api/public/track-record is admin-gated (401 for audit users).
  "/api/market/regime",
];

const WARM_PATHS = [
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/play",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/zerodte/board",
  "/api/market/flows?limit=30",
  "/api/market/nighthawk/edition",
];

const PAGES = [
  {
    path: "/dashboard",
    label: "dashboard",
    ready: IS_STAGING
      ? () =>
          document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= 5 ||
          document.body.innerText.length > 800
      : () => {
          const minRows = OFF_HOURS ? 5 : 20;
          return (
            document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= minRows ||
            document.body.innerText.length > 800
          );
        },
  },
  {
    path: "/flows",
    label: "flows",
    ready: () => document.body.innerText.length > 400,
  },
  {
    path: "/heatmap",
    label: "heatmap",
    ready: () =>
      document.querySelector(".gex-heatmap-panel") != null ||
      document.body.innerText.toLowerCase().includes("thermal"),
  },
  {
    path: "/nighthawk",
    label: "nighthawk",
    slowDesk: true,
    ready: () =>
      /today'?s 0dte plays/i.test(document.body.innerText) ||
      document.body.innerText.length > 300,
  },
];

const checks = [];
const rec = (name, status, detail, ms) => {
  checks.push({ name, status, detail, ms });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}${ms != null ? ` (${ms}ms)` : ""}`);
};

function grade(ms, { prewarm = false, contentReady = false, slowDesk = false } = {}) {
  const p1 = prewarm ? P1_PREWARM_MS : slowDesk && OFF_HOURS ? 4_000 : P1_MS;
  let p2 = contentReady ? P2_CONTENT_MS : P2_MS;
  if (contentReady && slowDesk && OFF_HOURS) p2 = 4_000;
  if (ms <= WARN_MS) return "PASS";
  if (ms <= p2) return "WARN";
  if (ms <= p1) return "FAIL";
  return "FAIL";
}

async function fetchApi(url, headers) {
  return fetchRetry(url, { headers }, { retries: IS_STAGING ? 4 : 2, baseDelayMs: 1200, timeoutMs: 90_000 });
}

function cookieHeaderFromSession(cookies) {
  return cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** Premium desk routes — a 401 is an auth failure, not a latency measurement. */
function isPremiumApiPath(path) {
  return path.startsWith("/api/market/") || path.startsWith("/api/admin/");
}

async function fetchApiMeasured(url, headers, { authState = null } = {}) {
  let res = await fetchApi(url, headers);
  if (
    res.status === 401 &&
    authState &&
    !authState.retried &&
    isPremiumApiPath(new URL(url).pathname)
  ) {
    authState.retried = true;
    const session = await mintIosPlaywrightSession({ appUrl: BASE });
    if (!session.skip) {
      await authState.cleanup?.();
      authState.cleanup = session.cleanup;
      authState.cookies = session.cookies;
      headers.Cookie = cookieHeaderFromSession(session.cookies);
      res = await fetchApi(url, headers);
    }
  }
  return res;
}

async function stagingForceWarmCrons() {
  if (!IS_STAGING || process.env.STAGING_CRON_WARM !== "1") return;
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return;
  const paths = [
    "/api/cron/desk-warm?force=1",
    "/api/cron/heatmap-warm?force=1",
    "/api/cron/zerodte-warm?force=1",
  ];
  console.log("--- Staging cron warm (force) ---");
  for (const path of paths) {
    const t0 = performance.now();
    try {
      const res = await fetchApi(`${BASE}${path}`, { Authorization: `Bearer ${secret}` });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      console.log(`  warmed ${path.split("?")[0]} → HTTP ${res.status} (${ms}ms)`);
    } catch (e) {
      console.warn(`  warm ${path} failed: ${e.message}`);
    }
  }
}

async function main() {
  console.log(`\n=== Site latency audit ===\nTarget: ${BASE}\nOff-hours ET: ${OFF_HOURS}\n`);

  await stagingForceWarmCrons();

  const cronSecret = process.env.CRON_SECRET?.trim();
  const useCronAuth = (IS_STAGING || process.env.SITE_LATENCY_CRON_AUTH === "1") && API_ONLY && cronSecret;

  let apiHeaders = { Accept: "application/json" };
  let cleanup = null;
  let browserCookies = null;
  const authState = { cleanup: null, cookies: null, retried: false };

  if (useCronAuth) {
    apiHeaders.Authorization = `Bearer ${cronSecret}`;
    rec("auth", "PASS", "cron bearer (staging api-only)");
  } else {
    const session = await mintIosPlaywrightSession({ appUrl: BASE });
    if (session.skip) {
      rec("auth", "FAIL", session.reason);
      process.exit(1);
    }
    cleanup = session.cleanup;
    authState.cleanup = session.cleanup;
    browserCookies = session.cookies;
    authState.cookies = session.cookies;
    apiHeaders.Cookie = cookieHeaderFromSession(session.cookies);
  }

  async function measurePath(path, labelPrefix) {
    const t0 = performance.now();
    try {
      const res = await fetchApiMeasured(`${BASE}${path}`, apiHeaders, { authState });
      await res.text();
      const ms = Math.round(performance.now() - t0);
      if (res.status === 401 && isPremiumApiPath(path.split("?")[0])) {
        rec(`${labelPrefix}:${path.split("?")[0]}`, "FAIL", "HTTP 401 auth", ms);
        return;
      }
      rec(`${labelPrefix}:${path.split("?")[0]}`, grade(ms, { prewarm: labelPrefix === "prewarm" }), `HTTP ${res.status}`, ms);
    } catch (e) {
      rec(`${labelPrefix}:${path}`, "FAIL", e.message);
    }
  }

  console.log("--- Pre-warm (desk-warm lane proxies) ---");
  // Seed each path once (3 ECS replicas → first measured hit may still be cold).
  for (const path of WARM_PATHS) {
    try {
      const res = await fetchApiMeasured(`${BASE}${path}`, apiHeaders, { authState });
      await res.text();
    } catch {
      /* seed best-effort */
    }
  }
  for (const path of WARM_PATHS) {
    await measurePath(path, "prewarm");
  }

  console.log("\n--- API warm pass (2nd = cached) ---");
  for (const path of API_PATHS) {
    for (let pass = 1; pass <= 2; pass++) {
      const t0 = performance.now();
      try {
        const res = await fetchApiMeasured(`${BASE}${path}`, apiHeaders, { authState });
        await res.text();
        const ms = Math.round(performance.now() - t0);
        const fullLabel =
          pass === 1 ? `api:${path.split("?")[0]}` : `api:${path.split("?")[0]}:warm`;
        if (res.status === 401 && isPremiumApiPath(path.split("?")[0])) {
          rec(fullLabel, "FAIL", "HTTP 401 auth", ms);
        } else {
          rec(fullLabel, grade(ms), `HTTP ${res.status}`, ms);
        }
      } catch (e) {
        rec(`api:${path}`, "FAIL", e.message);
      }
    }
  }

  if (!API_ONLY) {
    console.log("\n--- Browser paint ---");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext();
    await context.addInitScript(onboardingInitScript());
    if (browserCookies?.length) await context.addCookies(browserCookies);

    for (const page of PAGES) {
      const p = await context.newPage();
      const t0 = Date.now();
      try {
        const navStart = Date.now();
        await p.goto(`${BASE}${page.path}`, { waitUntil: "commit", timeout: 60_000 });
        const navMs = Date.now() - navStart;
        await p.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
        const domMs = Date.now() - t0;
        await p.waitForFunction(() => window.Clerk?.user?.id, { timeout: 20_000 }).catch(() => null);
        await p.waitForFunction(page.ready, { timeout: 30_000 }).catch(() => null);
        const readyMs = Date.now() - t0;
        rec(`page:${page.label}:nav`, grade(navMs, { slowDesk: page.slowDesk }), "commit", navMs);
        rec(`page:${page.label}:dom`, domMs <= P2_MS ? "PASS" : grade(domMs, { slowDesk: page.slowDesk }), "domcontentloaded", domMs);
        rec(`page:${page.label}:ready`, grade(readyMs, { contentReady: true, slowDesk: page.slowDesk }), "content ready", readyMs);
      } catch (e) {
        rec(`page:${page.label}`, "FAIL", e.message);
      } finally {
        await p.close();
      }
    }

    await browser.close();
  } else {
    rec("browser", "SKIP", "--api-only");
  }

  await cleanup?.();
  await authState.cleanup?.();

  const reportPath = join(OUT, `site-latency-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), base: BASE, checks }, null, 2));
  console.log(`\nReport: ${reportPath}`);

  const fails = checks.filter(
    (c) =>
      c.status === "FAIL" &&
      c.name !== "browser" &&
      !c.name.endsWith(":warm")
  );
  console.log(`\n=== Summary === FAIL: ${fails.length} / ${checks.length}\n`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
