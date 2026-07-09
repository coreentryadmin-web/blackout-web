#!/usr/bin/env node
/**
 * Deep production browser + API audit after AWS cutover.
 * Mints temp Clerk admin, walks every premium surface, records latencies.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const ART = "/opt/cursor/artifacts/aws-prod-deep-e2e";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(ART, { recursive: true });
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { path: "/", label: "landing", ready: () => document.body.innerText.includes("BlackOut") },
  { path: "/sign-in", label: "sign-in", ready: () => document.querySelector(".cl-rootBox, [data-clerk], form") != null },
  { path: "/dashboard", label: "dashboard", ready: () => document.querySelectorAll(".spx-gex-matrix-table tbody tr").length >= 10 },
  { path: "/flows", label: "flows", ready: () => document.body.innerText.length > 800 },
  { path: "/heatmap", label: "heatmap", ready: () => document.querySelector(".gex-heatmap-panel, [class*='heatmap']") != null },
  { path: "/terminal", label: "terminal", ready: () => document.body.innerText.length > 400 },
  { path: "/nighthawk", label: "nighthawk", ready: () => document.body.innerText.length > 400 },
  { path: "/vector", label: "vector", ready: () => document.body.innerText.length > 400 },
  { path: "/track-record", label: "track-record", ready: () => document.body.innerText.length > 300 },
  { path: "/faq", label: "faq", ready: () => document.body.innerText.length > 300 },
  { path: "/admin", label: "admin", ready: () => document.body.innerText.toLowerCase().includes("admin") },
];

const API_PATHS = [
  "/api/health",
  "/api/ready",
  "/api/market/spx/bootstrap",
  "/api/market/spx/desk",
  "/api/market/spx/pulse",
  "/api/market/spx/play",
  "/api/market/gex-heatmap?ticker=SPX",
  "/api/market/gex-heatmap?ticker=SPY",
  "/api/market/flows?limit=30",
  "/api/market/nighthawk/edition",
  "/api/market/zerodte/board",
  "/api/admin/health",
];

const checks = [];
const rec = (name, status, detail, ms) => {
  checks.push({ name, status, detail, ms });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}${ms != null ? ` (${ms}ms)` : ""}`);
};

function grade(ms) {
  if (ms <= 800) return "PASS";
  if (ms <= 2000) return "WARN";
  return "FAIL";
}

async function main() {
  console.log(`\n=== AWS prod deep browser audit ===\nTarget: ${BASE}\nTime: ${new Date().toISOString()}\n`);

  // ── 1. Public / Clerk sign-in (no session) ──
  console.log("--- Clerk / public ---");
  const browser0 = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx0 = await browser0.newContext();
  const p0 = await ctx0.newPage();
  const tSign = Date.now();
  await p0.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p0.waitForTimeout(2000);
  const signMs = Date.now() - tSign;
  const hasClerk = await p0.locator(".cl-rootBox, [data-clerk]").count().catch(() => 0);
  const hasGoogle = await p0.getByRole("button", { name: /google/i }).count().catch(() => 0);
  rec("clerk:sign-in-page", signMs < 3000 ? "PASS" : "WARN", `dom ${signMs}ms clerk=${hasClerk > 0} google=${hasGoogle > 0}`, signMs);
  await p0.screenshot({ path: join(ART, "01-sign-in-clerk.png"), fullPage: true });
  await browser0.close();

  // ── 2. Mint admin session ──
  console.log("\n--- Mint Clerk admin session ---");
  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    rec("clerk:mint-admin", "FAIL", session.reason);
    process.exit(1);
  }
  rec("clerk:mint-admin", "PASS", `user=${session.userId ?? "ok"} cookies=${session.cookies?.length ?? 0}`);

  const cookieHeader = session.cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  // ── 3. API cold + warm ──
  console.log("\n--- API latency (cold then warm) ---");
  for (const path of API_PATHS) {
    for (let pass = 1; pass <= 2; pass++) {
      const t0 = performance.now();
      const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookieHeader, Accept: "application/json" } });
      const body = await res.text();
      const ms = Math.round(performance.now() - t0);
      const label = pass === 1 ? `api:${path.split("?")[0]}:cold` : `api:${path.split("?")[0]}:hot`;
      const short = path.includes("?") ? `${path.split("?")[0]} (${path.split("=")[1]})` : path;
      rec(label, grade(ms), `HTTP ${res.status} ${short} ${body.length}B`, ms);
    }
  }

  // ── 4. Browser walk all surfaces ──
  console.log("\n--- Browser surfaces ---");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(session.cookies);

  let i = 2;
  for (const page of PAGES) {
    const p = await context.newPage();
    const t0 = Date.now();
    try {
      const resp = await p.goto(`${BASE}${page.path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await p.waitForFunction(() => window.Clerk?.user?.id, { timeout: 30_000 }).catch(() => null);
      const domMs = Date.now() - t0;
      await p.waitForFunction(page.ready, { timeout: 45_000 }).catch(() => null);
      const readyMs = Date.now() - t0;
      const status = resp?.status() ?? 0;
      rec(`page:${page.label}:dom`, grade(domMs), `HTTP ${status}`, domMs);
      rec(`page:${page.label}:ready`, grade(readyMs), "content ready", readyMs);
      await p.screenshot({ path: join(ART, `${String(i).padStart(2, "0")}-${page.label}.png`), fullPage: false });
      i += 1;
    } catch (e) {
      rec(`page:${page.label}`, "FAIL", String(e.message || e));
    } finally {
      await p.close();
    }
  }
  await browser.close();
  await session.cleanup?.();

  const stamp = Date.now();
  const summary = {
    ts: new Date().toISOString(),
    base: BASE,
    totals: checks.reduce((a, c) => {
      a[c.status] = (a[c.status] ?? 0) + 1;
      return a;
    }, {}),
    checks,
  };
  const reportPath = join(OUT, `aws-prod-deep-e2e-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Screenshots: ${ART}/`);
  console.log(`\n=== Summary ===`, summary.totals);

  const fails = checks.filter((c) => c.status === "FAIL").length;
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
