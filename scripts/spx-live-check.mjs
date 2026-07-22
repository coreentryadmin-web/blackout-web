/**
 * SPX Slayer live-UI check — authenticated desktop Chromium capture of the live
 * /dashboard desk, sampled EVERY MINUTE across a window (one auth, continuous
 * session) so the frame sequence proves: values change, beads form/grow at
 * intervals + sit at the right price-axis strikes, and the EOD Pin Forecaster
 * moves with price/time. UI only — no direct API polling.
 *
 * Runs on a GH Actions runner (network + CLERK_SECRET_KEY). Env:
 *   FRAMES (default 12), INTERVAL_MS (default 60000), VALIDATE_BASE, SPX_CHECK_DIR, RUN_STAMP
 * Output: desk-<stamp>-f<NN>.png (full), chart-<stamp>-f<NN>.png (bead/chart crop),
 *   pin-<stamp>-f<NN>.png (pin forecaster), report-<stamp>.json (per-frame values + deltas)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SPX_CHECK_DIR || "./artifacts/spx-live-check";
const STAMP = process.env.RUN_STAMP || "run";
const FRAMES = Math.max(1, parseInt(process.env.FRAMES || "12", 10));
const INTERVAL_MS = Math.max(15000, parseInt(process.env.INTERVAL_MS || "60000", 10));
mkdirSync(OUT, { recursive: true });

const pad = (n) => String(n).padStart(2, "0");
const report = { base: BASE, stamp: STAMP, frames: [], deltas: {}, notes: [] };

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  report.notes.push("AUTH SKIP: " + session.reason);
  writeFileSync(join(OUT, `report-${STAMP}.json`), JSON.stringify(report, null, 2));
  console.log("AUTH SKIP:", session.reason);
  process.exit(2);
}

// --disable-quic: the GH runner intermittently fails HTTP/3 to the edge (net::ERR_QUIC_PROTOCOL_ERROR),
// which stalled the load; force HTTP/1.1+2 over TCP so navigation is reliable.
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-quic"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await ctx.addCookies(session.cookies);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") report.notes.push("console:" + m.text().slice(0, 120)); });

  // NOT waitUntil:"networkidle" — the desk is a live-polling SPA (SWR + SSE never go idle), so
  // networkidle never fires and page.goto times out at 60s with zero frames. Wait for the DOM, then
  // a fixed hydration window for the client-only desk components (matrix/pin/commentary mount + SWR
  // populate) before capturing.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(12000);
  // Dismiss the first-visit onboarding modal ("WELCOME TO BLACKOUT" quick tour). A fresh temp user
  // ALWAYS sees it and it dims/covers the desk, wrecking the capture. Try Skip / close / Escape.
  for (const sel of ['button:has-text("Skip")', 'button:has-text("SKIP")', 'button[aria-label="Close"]', '[aria-label="Close"]']) {
    try { const b = page.locator(sel).first(); if (await b.count() && await b.isVisible()) { await b.click({ timeout: 2500 }); await page.waitForTimeout(600); break; } } catch { /**/ }
  }
  try { await page.keyboard.press("Escape"); } catch { /**/ }
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { await new Promise((r) => { let y = 0; const t = () => { window.scrollTo(0, y); y += Math.round(window.innerHeight * 0.7); if (y < document.body.scrollHeight) setTimeout(t, 130); else { window.scrollTo(0, 0); setTimeout(r, 400); } }; t(); }); });
  await page.waitForTimeout(3000);

  const capture = async (i) => {
    const f = pad(i);
    const ts = new Date().toISOString();
    const frame = { i, ts };
    try {
      const bodyText = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ");
      frame.signedInDesk = !/(^|\s)(Sign in|Get access|Unlock the full floor)/i.test(bodyText.slice(0, 300));

      // EOD Pin Forecaster
      const pinLabels = await page.$$eval('[aria-label*="projected close"]', (els) => els.map((e) => e.getAttribute("aria-label")));
      frame.pin = pinLabels[0] || (/pin forecast|projected close/i.test(bodyText) ? "present(no-aria)" : "NOT-FOUND");

      // headline values via text scan
      const grab = (re) => { const m = bodyText.match(re); return m ? m[0].replace(/\s+/g, " ").trim() : null; };
      frame.spotLike = [...bodyText.matchAll(/\b[5-7]\d{3}(?:\.\d{1,2})?\b/g)].map((m) => m[0]).slice(0, 10);
      frame.regime = grab(/(BULLISH|BEARISH|NEUTRAL|PINNED|POSITIVE GAMMA|NEGATIVE GAMMA|LONG GAMMA|SHORT GAMMA)[^.]{0,32}/i);
      frame.flip = grab(/flip[^0-9]{0,16}[5-7]\d{3}(\.\d+)?/i);
      frame.maxPain = grab(/max[- ]?pain[^0-9]{0,16}[5-7]\d{3}(\.\d+)?/i);

      // bead / chart geometry — count nodes + measure canvas
      frame.beads = await page.evaluate(() => {
        const q = (s) => document.querySelectorAll(s).length;
        const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ w: c.width, h: c.height }));
        return { canvases: canvases.length, biggestCanvas: canvases.sort((a, b) => b.w * b.h - a.w * a.h)[0] || null, beadNodes: q('[class*="bead"], circle[class*="bead"], [data-bead]'), matrixCells: q('[class*="matrix"] td, [class*="gex"] td, [class*="ladder"] [class*="cell"]'), tables: q("table") };
      });

      await page.screenshot({ path: join(OUT, `desk-${STAMP}-f${f}.png`), fullPage: true });
      // pin forecaster crop
      const pinEl = await page.$('[aria-label*="projected close"]');
      if (pinEl) { try { await pinEl.screenshot({ path: join(OUT, `pin-${STAMP}-f${f}.png`) }); } catch { /**/ } }
      // biggest canvas (the chart with beads) crop — for brightness/formation review
      const canvasEl = (await page.$$("canvas")).sort ? await page.evaluateHandle(() => { let best = null, area = 0; for (const c of document.querySelectorAll("canvas")) { const r = c.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; best = c; } } return best; }) : null;
      try { const el = canvasEl && canvasEl.asElement && canvasEl.asElement(); if (el) await el.screenshot({ path: join(OUT, `chart-${STAMP}-f${f}.png`) }); } catch { /**/ }
    } catch (e) { frame.error = String(e).slice(0, 140); }
    report.frames.push(frame);
    console.log(`  f${f} ${ts.slice(11, 19)} pin=${(frame.pin || "").slice(0, 60)} regime=${frame.regime || "-"} spot=${(frame.spotLike || [])[0] || "-"} beads=${frame.beads?.beadNodes ?? "?"}`);
  };

  for (let i = 1; i <= FRAMES; i++) {
    await capture(i);
    if (i < FRAMES) await page.waitForTimeout(INTERVAL_MS);
  }

  // deltas: did key signals move across frames?
  const uniq = (key) => [...new Set(report.frames.map((f) => JSON.stringify(f[key])))].length;
  const pinPx = report.frames.map((f) => (f.pin || "").match(/projected close ([\d,]+)/)?.[1]).filter(Boolean);
  report.deltas = {
    frames: report.frames.length,
    signedInAll: report.frames.every((f) => f.signedInDesk),
    distinctPin: [...new Set(pinPx)].length, pinValues: pinPx,
    distinctRegime: uniq("regime"),
    distinctSpotFirst: [...new Set(report.frames.map((f) => (f.spotLike || [])[0]))].length,
    beadNodeRange: [Math.min(...report.frames.map((f) => f.beads?.beadNodes ?? 0)), Math.max(...report.frames.map((f) => f.beads?.beadNodes ?? 0))],
  };
  console.log("DELTAS:", JSON.stringify(report.deltas));
} catch (e) {
  report.notes.push("ERROR: " + String(e).slice(0, 200));
  console.log("ERROR:", String(e).slice(0, 200));
} finally {
  writeFileSync(join(OUT, `report-${STAMP}.json`), JSON.stringify(report, null, 2));
  await browser.close();
  await session.cleanup();
}
