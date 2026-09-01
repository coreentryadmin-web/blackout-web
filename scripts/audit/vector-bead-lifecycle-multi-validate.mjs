#!/usr/bin/env node
/**
 * Multi-ticker Vector bead lifecycle validation — birth, death, rebirth, and horizon/timeframe scoping.
 *
 * Uses the SAME production helpers the chart renders from (strikeTrailLifecycle,
 * bucketWallHistoryForInterval, trailsByStrike). Read-only against prod; one temp Clerk user.
 *
 *   node --import tsx scripts/audit/vector-bead-lifecycle-multi-validate.mjs \
 *     [--tickers=SPX,SPY,QQQ,NVDA,TSLA,META,AMD] [--horizons=0dte,weekly] [--intervals=1,3,5] [--json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  strikeTrailLifecycle,
  bucketWallHistoryForInterval,
  trailsByStrike,
  DOMINANT_WALLS_PER_BUCKET,
} from "../../src/features/vector/lib/vector-wall-history.ts";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { mintIosPlaywrightSession, onboardingInitScript } from "./lib/ios-playwright-auth.mjs";

const args = process.argv.slice(2);
const arg = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const JSON_OUT = args.includes("--json");
const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.VECTOR_BEAD_LIFECYCLE_DIR || "/opt/cursor/artifacts/vector-bead-lifecycle-multi";
const TICKERS = arg("tickers", "SPX,SPY,QQQ,NVDA,TSLA,META,AMD")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);
const HORIZONS = arg("horizons", "0dte,weekly")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const INTERVALS = arg("intervals", "1,3,5")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

mkdirSync(OUT, { recursive: true });

const findings = [];
const note = (level, name, detail = "") => {
  findings.push({ level, name, detail });
  if (!JSON_OUT) console.log(`[${level}] ${name}${detail ? " — " + detail : ""}`);
};

function dominantSet(sample) {
  const c = sample?.walls?.callWalls?.slice(0, DOMINANT_WALLS_PER_BUCKET).map((w) => w.strike) ?? [];
  const p = sample?.walls?.putWalls?.slice(0, DOMINANT_WALLS_PER_BUCKET).map((w) => w.strike) ?? [];
  return JSON.stringify([...c.sort((a, b) => a - b), ...p.sort((a, b) => a - b)]);
}

function analyzeLifecycle(history, intervalMin, minBucketSec = 5) {
  if (!history.length) {
    return {
      samples: 0,
      bucketCount: 0,
      trails: 0,
      active: 0,
      departed: 0,
      midSessionBirths: 0,
      rebirths: 0,
      dynamism: 0,
      fullWidth: 0,
      verdict: "EMPTY",
    };
  }

  const bucketed = bucketWallHistoryForInterval(history, intervalMin, {
    minBucketSec,
    liveBeads: true,
  });
  const firstT = bucketed[0].time;
  const lastT = bucketed[bucketed.length - 1].time;
  const span = Math.max(1, lastT - firstT);
  const birthThreshold = firstT + span * 0.08;

  const callLife = strikeTrailLifecycle(bucketed, "callWalls", "gex");
  const putLife = strikeTrailLifecycle(bucketed, "putWalls", "gex");
  const all = [...callLife, ...putLife];
  const intervalSec = intervalMin * 60;

  let rebirths = 0;
  let midSessionBirths = 0;
  let fullWidth = 0;
  for (const t of all) {
    if (t.bornAt > birthThreshold) midSessionBirths++;
    if (t.points.length >= bucketed.length * 0.88) fullWidth++;
    for (let i = 1; i < t.points.length; i++) {
      if (t.points[i].time - t.points[i - 1].time > intervalSec * 2) rebirths++;
    }
  }

  const sets = bucketed.map(dominantSet);
  let dynamism = 0;
  for (let i = 1; i < sets.length; i++) {
    if (sets[i] !== sets[i - 1]) dynamism++;
  }

  const active = all.filter((t) => t.active).length;
  const departed = all.filter((t) => !t.active).length;

  let verdict = "GREEN";
  if (bucketed.length < 8) verdict = "THIN";
  else if (active === 0) verdict = "RED";
  else if (departed === 0 && bucketed.length >= 30) verdict = "AMBER";
  else if (midSessionBirths === 0 && fullWidth === all.length && all.length > 0) verdict = "AMBER";
  else verdict = "GREEN";

  return {
    samples: history.length,
    bucketCount: bucketed.length,
    trails: all.length,
    active,
    departed,
    midSessionBirths,
    rebirths,
    dynamism,
    fullWidth,
    verdict,
  };
}

function gradeMetric(name, stats) {
  if (stats.verdict === "EMPTY") return ["AMBER", "no history samples"];
  if (stats.active === 0) return ["FAIL", "no active walls at live edge"];
  if (stats.dynamism < 1 && stats.bucketCount >= 20)
    return ["AMBER", `flat dominant set (${stats.dynamism} transitions)`];
  if (stats.departed >= 1) return ["PASS", `${stats.departed} departed (death/fade)`];
  if (stats.bucketCount >= 30) return ["AMBER", "no departed walls yet this session"];
  return ["PASS", `${stats.active} active, ${stats.midSessionBirths} mid-session births`];
}

const session = await mintClerkPremiumSession({ appUrl: BASE, publicMetadata: { role: "admin", tier: "premium" } });
if (session.skip) {
  console.error("SKIP:", session.reason);
  process.exit(2);
}

const report = { base: BASE, tickers: {}, horizonCompare: {}, ui: [] };

try {
  for (const ticker of TICKERS) {
    const barsRes = await fetch(`${BASE}/api/market/vector/bars?ticker=${encodeURIComponent(ticker)}`, {
      headers: { Cookie: session.cookieHeader },
    });
    const barsData = barsRes.ok ? await barsRes.json() : {};
    const sessionYmd = barsData.sessionYmd;
    report.tickers[ticker] = { sessionYmd, horizons: {} };

    const histByHorizon = {};
    for (const horizon of HORIZONS) {
      const url = `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&dte=${horizon}&session=${encodeURIComponent(sessionYmd || "")}`;
      const res = await fetch(url, { headers: { Cookie: session.cookieHeader } });
      const body = res.ok ? await res.json() : { history: [] };
      const history = Array.isArray(body.history) ? body.history : [];
      histByHorizon[horizon] = history;

      const minBucket = ["SPX", "SPY", "QQQ", "IWM"].includes(ticker) ? 5 : 15;
      const perInterval = {};
      for (const iv of INTERVALS) {
        const stats = analyzeLifecycle(history, iv, minBucket);
        perInterval[iv] = stats;
        const [level, detail] = gradeMetric(`${ticker}/${horizon}/${iv}m`, stats);
        note(level, `${ticker} ${horizon} @ ${iv}m lifecycle`, detail);
        if (stats.rebirths > 0) {
          note("PASS", `${ticker} ${horizon} @ ${iv}m rebirth`, `${stats.rebirths} gap-resume trail(s)`);
        } else if (stats.bucketCount >= 40) {
          note("AMBER", `${ticker} ${horizon} @ ${iv}m rebirth`, "none detected (quiet tape ok)");
        }
        if (stats.midSessionBirths > 0) {
          note("PASS", `${ticker} ${horizon} @ ${iv}m birth`, `${stats.midSessionBirths} mid-session formation(s)`);
        }
      }
      report.tickers[ticker].horizons[horizon] = { samples: history.length, perInterval };
    }

    if (histByHorizon["0dte"]?.length && histByHorizon.weekly?.length) {
      const h0 = histByHorizon["0dte"];
      const hW = histByHorizon.weekly;
      const identical =
        h0.length === hW.length &&
        h0.every((s, i) => dominantSet(s) === dominantSet(hW[i]));
      const key = `${ticker}-0dte-vs-weekly`;
      report.horizonCompare[key] = { identical, len0: h0.length, lenW: hW.length };
      note(
        identical ? "AMBER" : "PASS",
        `${ticker} horizon scope`,
        identical ? "0dte and weekly rails identical (stable tape or check scope)" : "0dte ≠ weekly structure"
      );
    }
  }

  const browserSession = await mintIosPlaywrightSession({ appUrl: BASE });
  if (!browserSession.skip) {
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(onboardingInitScript);
    await context.addCookies(browserSession.cookies);
    const page = await context.newPage();

    const uiTickers = ["NVDA", "TSLA", "SPX"].filter((t) => TICKERS.includes(t));
    for (const ticker of uiTickers) {
      await page.goto(`${BASE}/vector?ticker=${ticker}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.locator(".vector-chart-wrap").waitFor({ state: "visible", timeout: 90_000 }).catch(() => null);
      const skip = page.getByRole("button", { name: /^skip$/i });
      if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) await skip.click();
      await page.waitForTimeout(3500);

      const matrixTitle = (await page.locator(".vector-odte-matrix-title").innerText().catch(() => "")).trim();
      const uiRow = { ticker, matrixTitle, shots: [] };

      for (const iv of [1, 3, 5]) {
        const sel = page.locator('[data-testid="vector-tf-select"]').first();
        if (await sel.isVisible({ timeout: 3000 }).catch(() => false)) {
          await sel.selectOption(String(iv));
          await page.waitForTimeout(2500);
        }
        const path = join(OUT, `${ticker.toLowerCase()}-${iv}m-0dte.png`);
        await page.screenshot({ path, fullPage: false });
        uiRow.shots.push({ interval: iv, horizon: "0dte", path });
      }

      const weeklyBtn = page.getByRole("button", { name: /^Weekly$/i }).first();
      if (await weeklyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await weeklyBtn.click();
        await page.waitForTimeout(3000);
        const wTitle = (await page.locator(".vector-odte-matrix-title").innerText().catch(() => "")).trim();
        uiRow.weeklyTitle = wTitle;
        const wPath = join(OUT, `${ticker.toLowerCase()}-3m-weekly.png`);
        await page.screenshot({ path: wPath, fullPage: false });
        uiRow.shots.push({ interval: 3, horizon: "weekly", path: wPath });
        note(/weekly/i.test(wTitle) ? "PASS" : "FAIL", `${ticker} UI weekly matrix`, wTitle || "(empty)");
      }

      note(/0DTE/i.test(matrixTitle) ? "PASS" : "FAIL", `${ticker} UI default matrix`, matrixTitle || "(empty)");
      report.ui.push(uiRow);
    }
    await browser.close();
    await browserSession.cleanup();
  } else {
    note("AMBER", "ui-playwright", browserSession.reason);
  }

  const fails = findings.filter((f) => f.level === "FAIL").length;
  report.summary = { fails, ambers: findings.filter((f) => f.level === "AMBER").length, passes: findings.filter((f) => f.level === "PASS").length };
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ findings, report }, null, 2));

  if (!JSON_OUT) {
    console.log(`\nArtifacts: ${OUT}`);
    console.log(`Summary: ${report.summary.passes} pass, ${report.summary.ambers} amber, ${report.summary.fails} fail`);
  } else {
    console.log(JSON.stringify({ findings, report }, null, 2));
  }
  process.exit(fails > 0 ? 1 : 0);
} finally {
  await session.cleanup();
}
