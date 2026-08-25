#!/usr/bin/env node
/**
 * Rotating four-panel X post — catalog capture + live copy + BLACK50 + Whop on every post.
 *
 * Usage:
 *   npm run x:social:post                    # creative mode (default) — hot ticker + random panels
 *   npm run x:social:post -- --pack slug     # curated pack from x-social-post-kit
 *   npm run x:social:post -- --ticker NVDA   # force hero ticker in creative mode
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
import { buildCreativeCopy, composeCreativePack, pickHotTicker } from "./lib/x-social-creative.mjs";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flag = (k) => args.includes(`--${k}`);

const BASE = "https://blackouttrades.com";
const PACK_SLUG = opt("pack", null);
const TICKER_OPT = opt("ticker", null);
const CREATIVE = !PACK_SLUG || flag("creative");

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
    top3: flows.slice(0, 3),
  };
}

async function captureShot(page, shot) {
  try {
    return await captureByCatalogId(page, BASE, shot.id, shot.params ?? {});
  } catch (err) {
    if (shot.fallbackId) {
      console.warn(`  ↪ fallback ${shot.fallbackId} (${err?.message ?? err})`);
      return captureByCatalogId(page, BASE, shot.fallbackId, shot.fallbackParams ?? shot.params ?? {});
    }
    throw err;
  }
}

async function main() {
  let pack;
  let ticker;

  if (CREATIVE && !PACK_SLUG) {
    const ranked = await pickHotTicker(fetchAuditJson, BASE);
    ticker = (TICKER_OPT ?? ranked[0]?.ticker ?? "NVDA").toUpperCase();
    pack = composeCreativePack(ticker, ranked);
    console.log("Mode: CREATIVE (hot ticker + rotating panels)");
    console.log(
      "Hot scan:",
      ranked.slice(0, 4).map((r) => `${r.ticker}:${fmtPremShort(r.premium)}`).join(" · "),
    );
  } else {
    pack = PACK_SLUG ? getPanelPack(PACK_SLUG) : nextPanelPack();
    ticker = (TICKER_OPT ?? pack.ticker ?? "NVDA").toUpperCase();
    console.log("Mode: CURATED PACK");
  }

  const slug = pack.slug ?? `${pack.slug}-${ticker.toLowerCase()}`;
  const OUT = `/opt/cursor/artifacts/x-posts/${slug.replace(/[^a-z0-9-]/gi, "-")}`;

  console.log(`Pack: ${pack.slug ?? "creative"}`);
  console.log(`Panels: ${pack.label}`);
  console.log(`Ticker: ${ticker}`);

  mkdirSync(OUT, { recursive: true });
  const story = await loadStory(ticker);
  const shots = pack.creative ? pack.shots : resolvePackShots(pack, ticker);

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
      console.log(`▸ ${shot.product} — ${shot.label ?? shot.id}`);
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

  const body = pack.creative
    ? buildCreativeCopy(story, pack)
    : pack.buildCopy
      ? pack.buildCopy({ ...story, ticker })
      : pack.label;
  const copy = assemblePost(body, slug);
  const weighted = xWeightedLength(copy);

  writeFileSync(join(OUT, "copy.txt"), copy);
  writeFileSync(
    join(OUT, "POST.md"),
    [
      `# X post — ${slug}`,
      "",
      `**Mode:** ${pack.creative ? "creative composer" : "curated pack"}`,
      `**Pack:** ${pack.slug ?? pack.label}`,
      `**Combo:** ${pack.combo?.join(" · ") ?? "—"}`,
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
      ...captured.filter((c) => c.ok).map((c, i) => `${i + 1}. **${c.product}** — ${c.label ?? c.id} — \`${c.path}\``),
      "",
      "```json",
      JSON.stringify({ pack, story, captured }, null, 2),
      "```",
    ].join("\n"),
  );

  console.log("\n--- COPY ---\n", copy);
  console.log(`\nweighted=${weighted} · ${captured.filter((c) => c.ok).length}/${shots.length} captures → ${OUT}/`);
  if (captured.filter((c) => c.ok).length < shots.length) process.exitCode = 1;
}

function fmtPremShort(n) {
  const v = Math.abs(Number(n));
  if (!Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
