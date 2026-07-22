/**
 * SPX Slayer live-UI check — authenticated desktop Chromium capture of the live
 * /dashboard desk. Screenshots the desk + the EOD Pin Forecaster + the GEX
 * matrix / bead rail, and extracts the live values (spot, gamma flip, regime,
 * max pain, projected close + confidence, ladder/bead rows) so successive runs
 * can be diffed to confirm values CHANGE and beads FORM over the session.
 *
 * Runs on a GH Actions runner (network + CLERK_SECRET_KEY secret). UI only — no
 * direct API polling. Output: $SPX_CHECK_DIR (default ./artifacts/spx-live-check)
 *   spx-desk.png, spx-pin.png (if found), report.json
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SPX_CHECK_DIR || "./artifacts/spx-live-check";
const STAMP = process.env.RUN_STAMP || "run";
mkdirSync(OUT, { recursive: true });

const report = { base: BASE, stamp: STAMP, ok: false, values: {}, pin: null, beads: {}, consoleErrors: [], notes: [] };

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  report.notes.push("AUTH SKIP: " + session.reason);
  writeFileSync(join(OUT, `report-${STAMP}.json`), JSON.stringify(report, null, 2));
  console.log("AUTH SKIP:", session.reason);
  process.exit(2);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addCookies(session.cookies);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 180)); });

  const resp = await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
  report.values.httpStatus = resp?.status() ?? 0;
  // let SSE / SWR polling run a few cycles so live values populate
  await page.waitForTimeout(10000);
  // scroll to trigger any lazy sections (matrix, pin, bead rail)
  await page.evaluate(async () => {
    await new Promise((r) => { let y = 0; const t = () => { window.scrollTo(0, y); y += Math.round(window.innerHeight * 0.75); if (y < document.body.scrollHeight) setTimeout(t, 150); else { window.scrollTo(0, 0); setTimeout(r, 500); } }; t(); });
  });
  await page.waitForTimeout(6000);

  await page.screenshot({ path: join(OUT, `spx-desk-${STAMP}.png`), fullPage: true });

  // signed-in gate check: is the real desk (not an upsell/sign-in) showing?
  const bodyText = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
  report.values.signedInDesk = !/Sign in|Get access|Unlock the full floor|Premium access/i.test(bodyText.slice(0, 400));

  // EOD Pin Forecaster — aria-label is "SPX 0DTE projected close <px> at <n>% confidence"
  const pinLabels = await page.$$eval('[aria-label*="projected close"]', (els) => els.map((e) => e.getAttribute("aria-label")));
  if (pinLabels.length) {
    report.pin = pinLabels[0];
    const el = await page.$('[aria-label*="projected close"]');
    if (el) { try { await el.screenshot({ path: join(OUT, `spx-pin-${STAMP}.png`) }); } catch { /* ignore */ } }
  } else {
    report.pin = /pin forecast|projected close|EOD/i.test(bodyText) ? "present-but-no-arialabel" : "NOT FOUND on desk";
  }

  // Extract labelled values by scanning text for known desk terms + nearby numbers
  const grab = (re) => { const m = bodyText.match(re); return m ? m[0] : null; };
  report.values.spotLike = [...bodyText.matchAll(/\b[5-7]\d{3}(?:\.\d{1,2})?\b/g)].map((m) => m[0]).slice(0, 12);
  report.values.regime = grab(/(BULLISH|BEARISH|NEUTRAL|PINNED|POSITIVE GAMMA|NEGATIVE GAMMA|LONG GAMMA|SHORT GAMMA)[^.]{0,40}/i);
  report.values.flip = grab(/(gamma )?flip[^0-9]{0,20}[5-7]\d{3}(\.\d+)?/i);
  report.values.maxPain = grab(/max[- ]?pain[^0-9]{0,20}[5-7]\d{3}(\.\d+)?/i);

  // Bead / ladder rows — count elements that look like gamma-ladder / bead nodes
  report.beads = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      canvases: q("canvas"),
      matrixRows: q('[class*="matrix"] tr, [class*="ladder"] [class*="row"], [class*="gex"] tr'),
      beadNodes: q('[class*="bead"], [class*="wall"] circle, [data-bead], circle[class*="bead"]'),
      tables: q("table"),
    };
  });

  report.ok = report.values.httpStatus === 200 && report.values.signedInDesk;
  console.log(`SPX live check [${STAMP}]: http=${report.values.httpStatus} signedInDesk=${report.values.signedInDesk} pin=${report.pin ? "yes" : "no"} beads=${JSON.stringify(report.beads)}`);
} catch (e) {
  report.notes.push("ERROR: " + String(e).slice(0, 200));
  console.log("ERROR:", String(e).slice(0, 200));
} finally {
  writeFileSync(join(OUT, `report-${STAMP}.json`), JSON.stringify(report, null, 2));
  await browser.close();
  await session.cleanup();
}
process.exit(report.ok ? 0 : 1);
