#!/usr/bin/env node
/**
 * Rotating four-panel X post — catalog capture + live copy + BLACK50 + Whop on every post.
 *
 * Usage:
 *   node --import tsx scripts/audit/x-social-post.mjs              # next pack in rotation
 *   node --import tsx scripts/audit/x-social-post.mjs --pack ai-net-premium-next24h
 *   node --import tsx scripts/audit/x-social-post.mjs --pack quad-desk-ticker --ticker META
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { captureByCatalogId } from "./lib/x-capture-runner.mjs";
import {
  assemblePost,
  getPanelPack,
  nextPanelPack,
  resolvePackShots,
  xWeightedLength,
} from "./lib/x-social-post-kit.mjs";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const PACK_SLUG = opt("pack", null);
const TICKER_OPT = opt("ticker", null);

async function loadStory(ticker) {
  const [posR, flowR] = await Promise.all([
    fetchAuditJson(BASE, `/api/market/gex-positioning?ticker=${ticker}`),
    fetchAuditJson(BASE, `/api/market/flows?limit=30&ticker=${ticker}`),
  ]);
  const pos = posR.ok ? posR.json : {};
  const flows = (flowR.ok ? flowR.json?.flows : []) ?? [];
  flows.sort((a, b) => (Number(b.premium) || 0) - (Number(a.premium) || 0));
  return {
    ticker,
    spot: pos.spot,
    flip: pos.flip ?? pos.gamma_flip,
    callWall: pos.call_wall ?? pos.callWall,
    putWall: pos.put_wall ?? pos.putWall,
    netGex: pos.net_gex ?? pos.netGex,
    top: flows[0] ?? {},
  };
}

async function captureShot(page, shot) {
  try {
    return await captureByCatalogId(page, BASE, shot.id, shot.params ?? {});
  } catch (err) {
    if (shot.fallbackId) {
      console.warn(`  ↪ fallback ${shot.fallbackId} (${err?.message ?? err})`);
      return captureByCatalogId(page, BASE, shot.fallbackId, shot.params ?? {});
    }
    throw err;
  }
}

async function main() {
  const pack = PACK_SLUG ? getPanelPack(PACK_SLUG) : nextPanelPack();
  const ticker = (TICKER_OPT ?? pack.ticker ?? "NVDA").toUpperCase();
  const slug = `${pack.slug}-${ticker.toLowerCase()}`;
  const OUT = `/opt/cursor/artifacts/x-posts/${slug}`;

  console.log(`Pack: ${pack.slug} (${pack.label})`);
  console.log(`Ticker: ${ticker}`);

  mkdirSync(OUT, { recursive: true });
  const story = await loadStory(ticker);
  const shots = resolvePackShots(pack, ticker);

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

  const captured = [];
  try {
    for (const shot of shots) {
      console.log(`▸ ${shot.product} — ${shot.id}`);
      try {
        const buf = await captureShot(page, shot);
        const path = join(OUT, shot.file);
        writeFileSync(path, buf);
        captured.push({ ...shot, path, bytes: buf.length, ok: true });
        console.log(`  ✓ ${path}`);
      } catch (err) {
        captured.push({ ...shot, ok: false, error: err?.message ?? String(err) });
        console.warn(`  ✗`, err?.message ?? err);
      }
    }
  } finally {
    await browser.close();
    await auth.cleanup();
    await releaseAuditClerkSession();
  }

  const body = pack.buildCopy ? pack.buildCopy({ ...story, ticker }) : pack.label;
  const copy = assemblePost(body, slug);
  const weighted = xWeightedLength(copy);

  writeFileSync(join(OUT, "copy.txt"), copy);
  writeFileSync(
    join(OUT, "POST.md"),
    [
      `# X post — ${slug}`,
      "",
      `**Pack:** ${pack.slug}`,
      `**Panels:** ${pack.label}`,
      `**Weighted length:** ${weighted}/${280}`,
      "",
      "## Copy",
      "",
      "```",
      copy,
      "```",
      "",
      "## Attachments",
      "",
      ...captured.filter((c) => c.ok).map((c, i) => `${i + 1}. **${c.product}** — \`${c.path}\``),
      "",
      "```json",
      JSON.stringify({ pack: pack.slug, story, captured }, null, 2),
      "```",
    ].join("\n"),
  );

  console.log("\n--- COPY ---\n", copy);
  console.log(`\nweighted=${weighted} · ${captured.filter((c) => c.ok).length}/${shots.length} captures → ${OUT}/`);
  if (captured.filter((c) => c.ok).length < shots.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
