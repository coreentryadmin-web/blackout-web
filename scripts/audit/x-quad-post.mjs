#!/usr/bin/env node
/**
 * Four-desk X post: exactly 4 attachments — Meridian · Helix · Thermal · Largo.
 * Usage: node --import tsx scripts/audit/x-quad-post.mjs --ticker NVDA
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { captureByCatalogId, shotClip, dismissOverlays } from "./lib/x-capture-runner.mjs";
import { assemblePost } from "./lib/x-social-post-kit.mjs";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const TICKER = opt("ticker", "NVDA").toUpperCase();
const OUT = `/opt/cursor/artifacts/x-posts/${TICKER.toLowerCase()}-quad-4`;

function fmtPrem(n) {
  const v = Math.abs(Number(n));
  if (!Number.isFinite(v)) return null;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

function fmtGex(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${v < 0 ? "-" : "+"}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${v < 0 ? "-" : "+"}$${(abs / 1e6).toFixed(0)}M`;
  return `${v < 0 ? "-" : "+"}$${Math.round(abs / 1e3)}K`;
}

async function loadStory(ticker) {
  const [posR, flowR] = await Promise.all([
    fetchAuditJson(BASE, `/api/market/gex-positioning?ticker=${ticker}`),
    fetchAuditJson(BASE, `/api/market/flows?limit=30&ticker=${ticker}`),
  ]);
  const pos = posR.ok ? posR.json : {};
  const flows = (flowR.ok ? flowR.json?.flows : []) ?? [];
  flows.sort((a, b) => (Number(b.premium) || 0) - (Number(a.premium) || 0));
  return { ticker, ...pos, top: flows[0] ?? {}, top3: flows.slice(0, 3) };
}

async function captureMeridian(page, ticker) {
  await page.goto(`${BASE}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await dismissOverlays(page);
  await page.waitForSelector(".meridian-page-root", { timeout: 60_000 });
  await page.locator(".meridian-search-input").first().fill(ticker);
  await new Promise((r) => setTimeout(r, 2500));
  const row = page.locator(".meridian-timeline-row.meridian-theme-earnings").filter({ hasText: ticker }).first();
  if (await row.count()) await row.click();
  await new Promise((r) => setTimeout(r, 4000));
  return shotClip(page, ".meridian-detail-v2, .meridian-desk-body, .meridian-page-root", "meridian", 980);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const story = await loadStory(TICKER);
  const auth = await mintIosPlaywrightSession({ appUrl: BASE });
  if (auth.skip) throw new Error(auth.reason ?? "auth failed");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  if (auth.cookies?.length) await ctx.addCookies(auth.cookies);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("blackout:onboarding:v", "2");
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();

  /** Exactly 4 attachments — one product each, fixed order for the thread/carousel. */
  const shots = [
    {
      product: "Meridian",
      file: "1-meridian.png",
      run: () => captureMeridian(page, TICKER),
    },
    {
      product: "Helix",
      file: "2-helix.png",
      run: () => captureByCatalogId(page, BASE, `helix.tape.${TICKER.toLowerCase()}.whales`),
    },
    {
      product: "Thermal",
      file: "3-thermal.png",
      run: () => captureByCatalogId(page, BASE, `thermal.matrix.${TICKER.toLowerCase()}.gex`),
    },
    {
      product: "Largo",
      file: "4-largo.png",
      run: () =>
        captureByCatalogId(page, BASE, "largo.flow_why", {
          ticker: TICKER,
          question: `Why is ${TICKER} seeing this flow — who's paying up and what does dealer positioning imply?`,
        }),
    },
  ];

  const captured = [];
  try {
    for (const shot of shots) {
      console.log(`▸ ${shot.product}…`);
      try {
        const buf = await shot.run();
        const path = join(OUT, shot.file);
        writeFileSync(path, buf);
        captured.push({ product: shot.product, path, bytes: buf.length, ok: true });
        console.log(`  ✓ ${path}`);
      } catch (err) {
        captured.push({ product: shot.product, ok: false, error: err?.message ?? String(err) });
        console.warn(`  ✗ ${shot.product}:`, err?.message ?? err);
      }
    }
  } finally {
    await browser.close();
    await auth.cleanup();
    await releaseAuditClerkSession();
  }

  const spot = story.spot != null ? Number(story.spot).toFixed(2) : "—";
  const gex = fmtGex(story.net_gex ?? story.netGex);
  const top = story.top;
  const prem = fmtPrem(top.premium);
  const typ = String(top.option_type ?? "CALL").toUpperCase();

  const body = [
    `$${TICKER} ${spot} · ${gex} net GEX · flip ${story.flip != null ? Number(story.flip).toFixed(0) : "—"}`,
    ``,
    `4 attachments · 4 desks:`,
    `① Meridian  ② Helix whales  ③ Thermal walls  ④ Largo reconcile`,
    ``,
    prem ? `Tape: ${prem} ${typ} ${top.strike}. Walls ${story.put_wall}/${story.call_wall}.` : "",
    `One ticker, full stack ↓`,
  ]
    .filter(Boolean)
    .join("\n");
  const copy = assemblePost(body, `${TICKER.toLowerCase()}-quad-4`);

  writeFileSync(join(OUT, "copy.txt"), copy);
  writeFileSync(
    join(OUT, "POST.md"),
    [
      `# Four-desk post — ${TICKER}`,
      "",
      "**Format:** 4 images = 4 products = 1 X post (carousel or reply thread).",
      "",
      "## Copy",
      "",
      "```",
      copy,
      "```",
      "",
      "## Attachments (exactly 4)",
      "",
      ...captured.filter((c) => c.ok).map((c, i) => `${i + 1}. **${c.product}** — \`${c.path}\``),
      "",
      "```json",
      JSON.stringify({ story, captured }, null, 2),
      "```",
    ].join("\n"),
  );

  console.log("\n--- COPY ---\n", copy);
  console.log(`\n${captured.filter((c) => c.ok).length}/4 captures → ${OUT}/`);
  if (captured.filter((c) => c.ok).length < 4) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
