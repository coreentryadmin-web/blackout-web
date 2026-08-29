#!/usr/bin/env node
/**
 * Rotating four-panel X post — catalog capture + live copy + BLACK50 + Whop on every post.
 *
 * Usage:
 *   npm run x:social:post                    # auto: king node / banger story, else creative
 *   npm run x:social:post -- --story king    # force king-node pack (weekly/monthly Vector)
 *   npm run x:social:post -- --story banger  # force banger-caught pack
 *   npm run x:social:post -- --story creative
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
  resolvePackShots,
  xWeightedLength,
} from "./lib/x-social-post-kit.mjs";
import { composeCreativePack, pickHotTicker } from "./lib/x-social-creative.mjs";
import { pickStoryPack, scanStoryCandidates } from "./lib/x-social-story-data.mjs";
import { commitXIntelStateIfChanged } from "./lib/x-intel-state-git.mjs";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const flag = (k) => args.includes(`--${k}`);

const BASE = "https://blackouttrades.com";
const STORY_MODE = opt("story", "auto"); // auto | king | banger | creative
const PACK_SLUG = opt("pack", null);

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

const TICKER_OPT = opt("ticker", null);

async function main() {
  let pack;
  let ticker;
  let storyCandidates = [];

  if (PACK_SLUG) {
    pack = getPanelPack(PACK_SLUG);
    ticker = (TICKER_OPT ?? pack.ticker ?? "NVDA").toUpperCase();
    console.log("Mode: CURATED PACK");
  } else if (STORY_MODE === "creative") {
    const ranked = await pickHotTicker(fetchAuditJson, BASE);
    ticker = (TICKER_OPT ?? ranked[0]?.ticker ?? "NVDA").toUpperCase();
    pack = composeCreativePack(ticker, ranked);
    console.log("Mode: CREATIVE");
    console.log("Hot scan:", ranked.slice(0, 4).map((r) => `${r.ticker}:${fmtPremShort(r.premium)}`).join(" · "));
  } else {
    storyCandidates = await scanStoryCandidates(fetchAuditJson, BASE);
    const prefer = STORY_MODE === "auto" ? undefined : STORY_MODE === "king" ? "king" : STORY_MODE;
    pack = pickStoryPack(storyCandidates, prefer);
    if (!pack) {
      const ranked = await pickHotTicker(fetchAuditJson, BASE);
      ticker = (TICKER_OPT ?? ranked[0]?.ticker ?? "NVDA").toUpperCase();
      pack = composeCreativePack(ticker, ranked);
      console.log("Mode: CREATIVE (no strong king/banger story — fallback)");
    } else {
      ticker = (TICKER_OPT ?? pack.ticker ?? "NVDA").toUpperCase();
      console.log(`Mode: STORY · ${pack.storyKind ?? pack.slug}`);
      if (pack.story?.kingStrike) {
        console.log(`King: ${pack.story.kingStrike} · γ ${fmtPremShort(pack.story.kingGamma)} · ${pack.story.horizon ?? "weekly"}`);
      }
      if (pack.story?.banger) {
        console.log(`Banger: ${pack.story.banger.ticker} · discovery +${pack.story.banger.gain}%`);
      }
    }
    if (storyCandidates.length) {
      console.log(
        "Story scan top:",
        storyCandidates.slice(0, 3).map((c) => `${c.ticker}:${c.kind}:${c.score.toFixed(1)}`).join(" · "),
      );
    }
  }

  const slug = pack.slug ?? `${pack.slug}-${ticker.toLowerCase()}`;
  const OUT = `/opt/cursor/artifacts/x-posts/${slug.replace(/[^a-z0-9-]/gi, "-")}`;

  console.log(`Pack: ${pack.slug ?? "creative"}`);
  console.log(`Panels: ${pack.label}`);
  console.log(`Ticker: ${ticker}`);

  mkdirSync(OUT, { recursive: true });
  const story = await loadStory(ticker);
  const shots = pack.shots ?? resolvePackShots(pack, ticker);

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

  const body = pack.buildCopy ? pack.buildCopy({ ...story, ticker }) : pack.label;
  const copy = assemblePost(body, slug);
  const weighted = xWeightedLength(copy);

  writeFileSync(join(OUT, "copy.txt"), copy);
  writeFileSync(
    join(OUT, "POST.md"),
    [
      `# X post — ${slug}`,
      "",
      `**Mode:** ${pack.storyKind ? `story · ${pack.storyKind}` : pack.creative ? "creative composer" : "curated pack"}`,
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
  commitXIntelStateIfChanged();
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
  commitXIntelStateIfChanged();
  process.exit(1);
});
