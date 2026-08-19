#!/usr/bin/env node
/**
 * Reproduce desk navigation stuck via REAL <Link> clicks (Features mega-menu), not pushState.
 *
 * Opens Features → clicks each instrument card → waits for pathname change + desk shell.
 * After Meridian, toggles view/filter (writes history) then tries nav again — the known
 * pushState desync path.
 *
 * Usage:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/nav-desk-link-soak.mjs [--rounds=3]
 *
 * Read-only. One temp Clerk user, always deleted in finally.
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { resolveChromiumPath } from "./lib/playwright-chromium-path.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.slice(9) ?? 2);
const OUT = "/opt/cursor/artifacts/nav-desk-link-soak";
const BOUNDARY = /We couldn't load this page|SOMETHING WENT WRONG/i;
const LOADING = /LOADING DESK|LOADING VECTOR|Loading chart/i;

/** href → substring that should appear in body when the desk loaded */
const TOOLS = [
  { href: "/dashboard", marker: /SPX|Slayer|GEX/i },
  { href: "/flows", marker: /HELIX|Flow/i },
  { href: "/heatmap", marker: /Thermal|Gamma|GEX/i },
  { href: "/terminal", marker: /Largo|Intelligence/i },
  { href: "/nighthawk", marker: /Night Hawk|0DTE|Command/i },
  { href: "/vector", marker: /Vector|SPX|Chart|LOADING VECTOR/i },
  { href: "/meridian", marker: /Meridian|Catalyst|Timeline/i },
];

async function cookiesFromHeader(header) {
  return header.split(";").map((s) => s.trim()).filter(Boolean).map((pair) => {
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
  });
}

async function refreshCtxCookies(ctx, session, state) {
  if (Date.now() - state.lastRefresh < 45_000) return;
  const next = await session.refresh?.().catch(() => null);
  if (!next?.cookieHeader) return;
  await ctx.addCookies(await cookiesFromHeader(next.cookieHeader));
  state.lastRefresh = Date.now();
}
  const btn = page.locator('button.nav-pill-item:has-text("Features"), button:has-text("Features")').first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  await btn.click({ timeout: 8000 });
  await page.waitForSelector("#nav-mega", { state: "visible", timeout: 15_000 });
}

async function clickToolLink(page, href) {
  const link = page.locator(`#nav-mega a.nav-card[href="${href}"]`).first();
  const targetPath = href.split("?")[0];
  await Promise.all([
    page.waitForURL((url) => url.pathname === targetPath || url.pathname.startsWith(`${targetPath}/`), {
      timeout: 45_000,
    }).catch(() => {}),
    link.click({ timeout: 8000 }),
  ]);
  await page.waitForLoadState("domcontentloaded").catch(() => {});
}

async function waitNav(page, fromPath, href, timeoutMs = 45_000) {
  const targetPath = href.split("?")[0];
  const t0 = Date.now();
  let lastUrl = page.url();
  while (Date.now() - t0 < timeoutMs) {
    lastUrl = page.url();
    const path = new URL(lastUrl).pathname;
    if (path === targetPath || path.startsWith(`${targetPath}/`)) {
      while (Date.now() - t0 < timeoutMs) {
        let text = "";
        try {
          text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "");
        } catch {
          await page.waitForTimeout(400);
          continue;
        }
        if (BOUNDARY.test(text)) {
          return { ok: true, url: lastUrl, text, ms: Date.now() - t0, boundary: true };
        }
        if (LOADING.test(text)) {
          await page.waitForTimeout(600);
          continue;
        }
        if (text.length > 150) {
          return { ok: true, url: lastUrl, text, ms: Date.now() - t0, boundary: false };
        }
        await page.waitForTimeout(400);
      }
    }
    await page.waitForTimeout(400);
  }
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "").catch(() => "");
  return { ok: false, url: lastUrl, text, ms: Date.now() - t0, boundary: BOUNDARY.test(text), stuckOn: fromPath };
}

async function meridianInteract(page) {
  // Toggle analytics view — triggers replaceState on prod MeridianDesk
  const analytics = page.getByRole("button", { name: /analytics/i }).first();
  if ((await analytics.count()) > 0) {
    await analytics.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const firstRow = page.locator("[data-meridian-event]").first();
  if ((await firstRow.count()) > 0) {
    await firstRow.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await mintClerkPremiumSession({
    appUrl: BASE,
    email: `nav-soak-${crypto.randomBytes(4).toString("hex")}@blackouttrades.com`,
  });
  if (session.skip) {
    console.log("SKIP:", session.reason);
    process.exit(0);
  }

  const browser = await chromium.launch({
    executablePath: resolveChromiumPath(),
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
  const consoleErrs = [];
  const pageErrs = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrs.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => pageErrs.push(String(e.message).slice(0, 200)));

  const results = [];
  let failCount = 0;

  const cookieState = { lastRefresh: Date.now() };

  try {
    await page.goto(session.signInUrl ?? `${BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator('button.nav-pill-item:has-text("Features")').first().waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    for (let r = 0; r < ROUNDS; r++) {
      for (const tool of TOOLS) {
        const fromPath = new URL(page.url()).pathname;
        try {
          await refreshCtxCookies(ctx, session, cookieState);
          await openFeatures(page);
          await clickToolLink(page, tool.href);
          const nav = await waitNav(page, fromPath, tool.href);
          const markerOk = tool.marker.test(nav.text) && new URL(nav.url).pathname.startsWith(tool.href.split("?")[0]);
          const row = {
            round: r + 1,
            tool: tool.href,
            from: fromPath,
            ...nav,
            markerOk,
            pass: nav.ok && markerOk && !nav.boundary,
          };
          results.push(row);
          if (!row.pass) {
            failCount++;
            const shot = join(OUT, `fail-r${r + 1}-${tool.href.replace(/\W+/g, "_")}.png`);
            await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
            console.log(`FAIL ${tool.href}: ok=${nav.ok} marker=${markerOk} boundary=${nav.boundary} url=${nav.url} ms=${nav.ms}`);
          } else {
            console.log(`OK   ${tool.href} (${nav.ms}ms)`);
          }

          if (tool.href === "/meridian") {
            await meridianInteract(page);
            // Immediately try leaving Meridian after history writes
            await openFeatures(page);
            await clickToolLink(page, "/dashboard");
            const postMer = await waitNav(page, "/meridian", "/dashboard");
            const postRow = {
              round: r + 1,
              tool: "/dashboard-after-meridian",
              from: "/meridian",
              ...postMer,
              markerOk: /SPX|Slayer|GEX/i.test(postMer.text),
              pass: postMer.ok && /SPX|Slayer|GEX/i.test(postMer.text) && !postMer.boundary,
            };
            results.push(postRow);
            if (!postRow.pass) {
              failCount++;
              const shot = join(OUT, `fail-r${r + 1}-after-meridian.png`);
              await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
              console.log(`FAIL post-meridian → dashboard: url=${postMer.url} ms=${postMer.ms}`);
            } else {
              console.log(`OK   post-meridian → dashboard (${postMer.ms}ms)`);
            }
          }
        } catch (e) {
          failCount++;
          results.push({ round: r + 1, tool: tool.href, pass: false, err: String(e).slice(0, 200) });
          console.log(`ERR  ${tool.href}: ${String(e).slice(0, 120)}`);
        }
      }
    }
  } finally {
    await browser.close();
    await session.cleanup?.();
  }

  const report = {
    base: BASE,
    rounds: ROUNDS,
    transitions: results.length,
    failures: failCount,
    results,
    consoleErrors: [...new Set(consoleErrs)].slice(0, 20),
    pageErrors: [...new Set(pageErrs)].slice(0, 20),
  };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n=== nav desk link soak ===`);
  console.log(`transitions: ${results.length}, failures: ${failCount}`);
  console.log(`report: ${join(OUT, "report.json")}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
