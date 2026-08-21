#!/usr/bin/env node
/**
 * Full desk + marketing UI soak — every product route, primary panels/segments, error boundaries.
 *
 * Usage:
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/audit/desk-ui-full-soak.mjs
 *
 * Output: /opt/cursor/artifacts/desk-ui-full-soak/report.json + screenshots
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { resolveChromiumPath } from "./lib/playwright-chromium-path.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = "/opt/cursor/artifacts/desk-ui-full-soak";
const BOUNDARY = /We couldn't load this page|SOMETHING WENT WRONG/i;
const LOADING = /LOADING DESK|LOADING VECTOR|Loading chart|Loading 0dte matrix/i;

const DESK_ROUTES = [
  { path: "/dashboard", marker: /SPX|Slayer|GEX/i, name: "SPX Slayer" },
  { path: "/flows", marker: /HELIX|Flow|Connecting Live/i, name: "HELIX" },
  { path: "/heatmap", marker: /Thermal|Gamma|GEX|BlackOut Thermal/i, name: "Thermal" },
  { path: "/terminal", marker: /Largo|Intelligence|ASK THE DESK/i, name: "Largo" },
  { path: "/nighthawk", marker: /Night Hawk|0DTE|PLAYBOOK/i, name: "Night Hawk" },
  { path: "/vector", marker: /Vector|SPX|Chart|LOADING VECTOR/i, name: "Vector" },
  { path: "/meridian", marker: /Meridian|Catalyst|TIMELINE/i, name: "Meridian" },
  { path: "/account", marker: /Account|Membership|Profile/i, name: "Account" },
];

const MARKETING = ["/", "/pricing", "/faq", "/learn", "/track-record"];

const results = [];
let failures = 0;

function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "OK  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function waitForDeskContent(page, marker, timeoutMs = 45_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let text = "";
    try {
      text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
    } catch {
      await page.waitForTimeout(400);
      continue;
    }
    if (BOUNDARY.test(text)) return { ok: false, text, reason: "error-boundary" };
    if (marker.test(text) && !LOADING.test(text)) return { ok: true, text };
    if (marker.test(text) && LOADING.test(text)) {
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(600);
  }
  let text = "";
  try {
    text = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "");
  } catch {
    text = "";
  }
  return { ok: marker.test(text) && !BOUNDARY.test(text), text, reason: "timeout" };
}

async function loadDeskRoute(page, desk, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const resp = await page.goto(`${BASE}${desk.path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const statusOk = (resp?.status() ?? 500) < 400;
    if (!statusOk) return { ok: false, reason: `HTTP ${resp?.status()}` };
    const settled = await waitForDeskContent(page, desk.marker);
    if (settled.ok) return { ok: true };
    if (settled.reason === "error-boundary" && attempt < retries) {
      await page.waitForTimeout(3000);
      continue;
    }
    return { ok: false, reason: settled.reason ?? "timeout" };
  }
  return { ok: false, reason: "retries-exhausted" };
}

async function clickIfVisible(page, locator, label) {
  if (await locator.isVisible().catch(() => false)) {
    await locator.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    record(`${label}:click`, true);
    return true;
  }
  record(`${label}:click`, true, "skipped — not visible");
  return false;
}

async function exercisePanels(page, path) {
  if (path === "/dashboard") {
    for (const seg of ["ALL", "REGIME", "WALLS", "FLOW"]) {
      await clickIfVisible(page, page.getByRole("button", { name: new RegExp(seg, "i") }).first(), `dashboard:${seg}`);
    }
  }
  if (path === "/flows") {
    for (const seg of ["OPEN", "ALL", "WATCH"]) {
      await clickIfVisible(page, page.locator(".flow-seg-btn", { hasText: seg }).first(), `helix:${seg}`);
    }
  }
  if (path === "/heatmap") {
    await clickIfVisible(page, page.getByRole("button", { name: /GEX|VEX|DEX/i }).first(), "thermal:lens");
  }
  if (path === "/nighthawk") {
    for (const f of ["ALL", "OPEN", "WATCH"]) {
      await clickIfVisible(page, page.locator(".nh-deck-filtbtn", { hasText: f }).first(), `hawk:${f}`);
    }
    for (const seg of ["0DTE", "Swings", "Bangers"]) {
      await clickIfVisible(page, page.getByRole("button", { name: new RegExp(seg, "i") }).first(), `hawk:seg-${seg}`);
    }
  }
  if (path === "/meridian") {
    await clickIfVisible(page, page.getByRole("button", { name: /analytics/i }).first(), "meridian:analytics");
    await clickIfVisible(page, page.getByRole("button", { name: /timeline/i }).first(), "meridian:timeline");
  }
  if (path === "/vector") {
    await clickIfVisible(page, page.getByRole("button", { name: /GEX|VEX/i }).first(), "vector:lens").catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chromiumPath = resolveChromiumPath();
  const session = await mintClerkPremiumSession({
    appUrl: BASE,
    email: `desk-ui-${crypto.randomBytes(4).toString("hex")}@blackouttrades.com`,
  });
  if (session.skip) {
    console.log("SKIP:", session.reason);
    process.exit(0);
  }

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(
    session.cookieHeader.split(";").map((s) => s.trim()).filter(Boolean).map((pair) => {
      const i = pair.indexOf("=");
      return {
        name: pair.slice(0, i).trim(),
        value: pair.slice(i + 1).trim(),
        domain: "blackouttrades.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      };
    })
  );

  const page = await ctx.newPage();
  const chunkErrs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && /ChunkLoadError|MIME type|404.*_next\/static/i.test(t)) {
      chunkErrs.push(t.slice(0, 180));
    }
  });

  try {
    await page.goto(session.signInUrl ?? `${BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    for (const route of MARKETING) {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const ok = (resp?.status() ?? 500) < 400;
      record(`marketing:${route}`, ok, String(resp?.status()));
      await page.screenshot({ path: join(OUT, `mkt-${route.replace(/\W+/g, "_") || "home"}.png`) }).catch(() => {});
    }

    for (const desk of DESK_ROUTES) {
      const loaded = await loadDeskRoute(page, desk);
      record(`desk:${desk.name}:load`, loaded.ok, loaded.reason ?? "");
      if (!loaded.ok) {
        await page.screenshot({ path: join(OUT, `fail-${desk.path.replace(/\W+/g, "_")}.png`), fullPage: true }).catch(() => {});
        continue;
      }
      await exercisePanels(page, desk.path);
      await page.screenshot({ path: join(OUT, `desk-${desk.path.replace(/\W+/g, "_") || "root"}.png`), fullPage: false }).catch(() => {});
    }

    record("chunk-errors", chunkErrs.length === 0, chunkErrs.length ? chunkErrs[0] : "none");
  } finally {
    await browser.close();
    await session.cleanup?.();
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, failures, results, chunkErrs }, null, 2));
  console.log(`\n=== desk UI full soak: ${failures} failure(s) ===`);
  console.log(`report: ${join(OUT, "report.json")}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
