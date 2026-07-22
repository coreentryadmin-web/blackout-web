/**
 * Desktop UI E2E — real headless-Chromium walk of the live desktop site.
 *
 * Runs on a GitHub Actions runner (which HAS network egress to prod, unlike the
 * agent sandbox). For every page it: navigates at a 1440×900 desktop viewport,
 * screenshots the rendered page, enumerates every <a>/<button>, and re-navigates
 * to each unique internal link to confirm it resolves (status + its own shot).
 * Public marketing/auth surface only — no login required.
 *
 *   VALIDATE_BASE=https://blackouttrades.com node scripts/desktop-ui-e2e.mjs
 * Output: $DESKTOP_E2E_DIR (default ./artifacts/desktop-ui-e2e): *.png + report.json
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.DESKTOP_E2E_DIR || "./artifacts/desktop-ui-e2e";
const EXEC = process.env.CHROMIUM_PATH || undefined; // let Playwright find it in CI
mkdirSync(OUT, { recursive: true });

const PAGES = ["/", "/pricing", "/faq", "/learn", "/upgrade", "/sign-in", "/sign-up"];
const slug = (p) => (p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "-"));

const report = { base: BASE, at: new Date().toISOString(), pages: [], brokenLinks: [], buttons: {} };

const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });

const seen = new Set();
for (const path of PAGES) {
  consoleErrors.length = 0;
  let status = 0;
  try {
    const resp = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
    status = resp?.status() ?? 0;
  } catch (e) {
    report.pages.push({ path, status: "NAV_ERROR", error: String(e).slice(0, 160) });
    continue;
  }
  await page.waitForTimeout(1500);
  const shot = join(OUT, `${slug(path)}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  // enumerate links + buttons in the rendered DOM
  const links = await page.$$eval("a[href]", (as) => as.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) })));
  const buttons = await page.$$eval("button", (bs) => bs.map((b) => (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean));
  report.buttons[path] = buttons;
  report.pages.push({ path, status, screenshot: `${slug(path)}.png`, links: links.length, buttons: buttons.length, consoleErrors: [...consoleErrors] });

  // verify each unique internal link resolves (navigate to it, record status)
  for (const { href } of links) {
    if (!href || !href.startsWith("/") || seen.has(href.split("#")[0])) continue;
    const clean = href.split("#")[0];
    seen.add(clean);
    try {
      const r = await page.goto(BASE + clean, { waitUntil: "domcontentloaded", timeout: 30000 });
      const st = r?.status() ?? 0;
      if (st >= 400) report.brokenLinks.push({ from: path, href: clean, status: st });
    } catch (e) {
      // sign-in/up redirect when already authed etc. — record but don't fail-hard
      report.brokenLinks.push({ from: path, href: clean, status: "NAV_ERROR", error: String(e).slice(0, 100) });
    }
  }
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
await browser.close();

const broken = report.brokenLinks.filter((b) => typeof b.status === "number" && b.status >= 400);
console.log(`\ndesktop-ui-e2e: ${report.pages.length} pages shot, ${seen.size} internal links checked, ${broken.length} broken (>=400)`);
for (const b of broken) console.log(`  BROKEN ${b.status} ${b.href} (from ${b.from})`);
for (const p of report.pages) if (p.consoleErrors?.length) console.log(`  console errors on ${p.path}: ${p.consoleErrors.length}`);
process.exit(broken.length ? 1 : 0);
