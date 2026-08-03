#!/usr/bin/env node
/**
 * GA4 live probe — mint temp admin Clerk session, browse production with Playwright,
 * and verify gtag loads + google-analytics.com collect requests fire.
 *
 * Usage: node --import tsx scripts/audit/ga4-live-probe.mjs
 * Env: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 */
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

const APP = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const MEASUREMENT_ID = "G-YLN4K37KYF";

function isGaHit(url) {
  return (
    /google-analytics\.com\/g\/collect/i.test(url) ||
    /google-analytics\.com\/j\/collect/i.test(url) ||
    /google-analytics\.com\/mp\/collect/i.test(url) ||
    /googletagmanager\.com\/gtag\/js/i.test(url)
  );
}

async function main() {
  const results = {
    app: APP,
    measurementId: MEASUREMENT_ID,
    timestamp: new Date().toISOString(),
    auth: null,
    pages: [],
    gaHits: [],
    verdict: "UNKNOWN",
  };

  const session = await mintIosPlaywrightSession({ appUrl: APP });
  if (session.skip) {
    results.auth = { ok: false, reason: session.reason };
    results.verdict = "SKIP";
    console.log(JSON.stringify(results, null, 2));
    process.exit(2);
  }
  results.auth = { ok: true };

  const gaHits = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 GA4Probe/1.0",
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies(session.cookies);
  await context.addInitScript(onboardingInitScript());

  const page = await context.newPage();
  page.on("request", (req) => {
    const url = req.url();
    if (isGaHit(url)) {
      gaHits.push({ type: "request", url, method: req.method(), at: Date.now() });
    }
  });
  page.on("response", (res) => {
    const url = res.url();
    if (isGaHit(url)) {
      gaHits.push({ type: "response", url, status: res.status(), at: Date.now() });
    }
  });

  const routes = ["/", "/dashboard", "/flows", "/sign-in"];
  for (const route of routes) {
    const entry = { route, ok: false, gtagLoaded: false, dataLayerLen: 0, signedIn: false, error: null };
    try {
      const resp = await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      entry.httpStatus = resp?.status() ?? null;
      await page.waitForTimeout(3000);
      const probe = await page.evaluate((mid) => {
        const dl = window.dataLayer;
        const hasGtag = typeof window.gtag === "function";
        const scripts = [...document.querySelectorAll("script[src]")]
          .map((s) => s.getAttribute("src") || "")
          .filter((s) => s.includes("googletagmanager") || s.includes("google-analytics"));
        return {
          hasGtag,
          dataLayerLen: Array.isArray(dl) ? dl.length : 0,
          measurementInDom: document.documentElement.innerHTML.includes(mid),
          gaScripts: scripts,
          signedIn: Boolean(window.Clerk?.user?.id),
          title: document.title,
        };
      }, MEASUREMENT_ID);
      entry.gtagLoaded = probe.hasGtag;
      entry.dataLayerLen = probe.dataLayerLen;
      entry.measurementInDom = probe.measurementInDom;
      entry.gaScripts = probe.gaScripts;
      entry.signedIn = probe.signedIn;
      entry.title = probe.title;
      entry.ok = entry.httpStatus === 200 && probe.measurementInDom;
    } catch (e) {
      entry.error = e.message;
    }
    results.pages.push(entry);
  }

  await browser.close();
  if (session.cleanup) await session.cleanup();

  results.gaHits = gaHits.map((h) => ({
    ...h,
    tid: (h.url.match(/[?&]tid=([^&]+)/) || h.url.match(/id=([^&]+)/))?.[1] ?? null,
  }));

  const collectHits = gaHits.filter((h) => /\/g\/collect|\/j\/collect|\/mp\/collect/.test(h.url));
  const gtagJsLoaded = gaHits.some((h) => /gtag\/js/.test(h.url));
  const correctMeasurement = gaHits.some((h) => h.url.includes(MEASUREMENT_ID));
  const anyPageSignedIn = results.pages.some((p) => p.signedIn);
  const tagInDom = results.pages.every((p) => p.measurementInDom);

  if (collectHits.length > 0 && gtagJsLoaded) {
    results.verdict = "PASS";
  } else if (gtagJsLoaded && collectHits.length === 0) {
    results.verdict = "WARN";
    results.warn = "gtag present but no collect beacon captured (blocker or timing)";
  } else {
    results.verdict = "FAIL";
  }

  results.summary = {
    gtagJsLoaded,
    collectHitCount: collectHits.length,
    correctMeasurement,
    anyPageSignedIn,
    tagInDom,
  };

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.verdict === "PASS" ? 0 : results.verdict === "WARN" ? 1 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
