#!/usr/bin/env node
/**
 * Cross-product X post builder — catalog capture + live copy.
 * Usage: node --import tsx scripts/audit/x-post-now.mjs --ticker SPX --angle spx-negative-gamma
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { captureByCatalogId } from "./lib/x-capture-runner.mjs";
import { assemblePost } from "./lib/x-social-post-kit.mjs";

const args = process.argv.slice(2);
const opt = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE = "https://blackouttrades.com";
const ANGLE = opt("angle", "spx-negative-gamma");

const PACKAGES = {
  "spx-negative-gamma": {
    slug: "spx-negative-gamma",
    shots: [
      { id: "thermal.matrix.spx.gex", file: "thermal-spx-gex.png", role: "GAMMA" },
      { id: "helix.tape.spx.whales", file: "helix-spx-whales.png", role: "FLOW" },
      { id: "spx_slayer.gex_rail", file: "slayer-spx-rail.png", role: "DESK" },
    ],
  },
  "quad-desk": {
    ticker: "META",
    shots: (ticker) => [
      { id: `meridian.event.${ticker.toLowerCase()}.positioning`, file: "meridian-positioning.png", role: "MERIDIAN" },
      { id: `helix.tape.${ticker.toLowerCase()}.whales`, file: "helix-whales.png", role: "HELIX" },
      { id: `thermal.matrix.${ticker.toLowerCase()}.gex`, file: "thermal-gex.png", role: "THERMAL" },
      {
        id: "largo.conflict",
        file: "largo-reconcile.png",
        role: "LARGO",
        params: { ticker, question: `Helix and Thermal disagree on ${ticker} — reconcile the flow vs gamma read.` },
      },
    ],
    buildCopy: (story) => {
      const t = story.ticker;
      const spot = story.spot != null ? Number(story.spot).toFixed(2) : "—";
      const gexStr = fmtGex(story.netGex);
      const neg = Number(story.netGex) < 0;
      const top = story.top;
      const prem = fmtPrem(top.premium);
      const typ = String(top.option_type ?? "PUT").toUpperCase();
      return assemblePost(
        [
          `$${t} ${spot} · ${neg ? "short" : "long"} gamma (${gexStr})`,
          ``,
          `Meridian · Helix whales · Thermal walls ${story.putWall}/${story.callWall}.`,
          prem ? `Tape: ${prem} ${typ} ${top.strike}. Largo reconciles flow vs gamma.` : `Largo ties flow to dealer positioning.`,
          ``,
          `Four desks, one ticker ↓`,
        ].join("\n"),
        `${t.toLowerCase()}-quad-desk`,
      );
    },
  },
  "tsla-breakout": {
    slug: "tsla-0dte-vex",
    ticker: "TSLA",
    shots: [
      { id: "helix.tape.tsla.0dte", file: "helix-tsla-0dte.png", role: "FLOW" },
      { id: "thermal.matrix.tsla.vex", file: "thermal-tsla-vex.png", role: "VEX" },
      { id: "thermal.matrix.tsla.gex", file: "thermal-tsla-gex.png", role: "GEX" },
    ],
    buildCopy: (story) => {
      const spot = story.spot != null ? Number(story.spot).toFixed(2) : "—";
      const gexStr = fmtGex(story.netGex);
      const top = story.top;
      const prem = fmtPrem(top.premium);
      const typ = String(top.option_type ?? "CALL").toUpperCase();
      const strike = top.strike;
      const dte = top.dte;
      return assemblePost(
        [
          `$TSLA ${spot} · ${Number(story.netGex) >= 0 ? "long" : "short"} gamma (${gexStr})`,
          ``,
          `0DTE tape: ${prem ?? "—"} ${typ} ${strike}${dte != null ? ` (${dte}d)` : ""}. Call wall ${story.callWall ?? "—"}.`,
          `VEX lens shows where vol exposure clusters into ${story.callWall ?? "resistance"}.`,
          ``,
          `Helix 0DTE + Thermal VEX/GEX. Three lenses ↓`,
        ].join("\n"),
        "tsla-0dte-vex",
      );
    },
  },
};

const pkg = PACKAGES[ANGLE] ?? PACKAGES["spx-negative-gamma"];
const TICKER = opt("ticker", pkg.ticker ?? "SPX").toUpperCase();
const slug =
  ANGLE === "quad-desk"
    ? `${TICKER.toLowerCase()}-quad-desk`
    : typeof pkg.slug === "string"
      ? pkg.slug
      : `${TICKER.toLowerCase()}-quad-desk`;
const OUT = `/opt/cursor/artifacts/x-posts/${slug}`;
const shots = typeof pkg.shots === "function" ? pkg.shots(TICKER) : pkg.shots;

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
  const [posR, heatR, flowR] = await Promise.all([
    fetchAuditJson(BASE, `/api/market/gex-positioning?ticker=${ticker}`),
    fetchAuditJson(BASE, `/api/market/gex-heatmap?ticker=${ticker}`),
    fetchAuditJson(BASE, `/api/market/flows?limit=50&ticker=${ticker}`),
  ]);
  const pos = posR.ok ? posR.json : {};
  const heat = heatR.ok ? heatR.json : {};
  const flows = (flowR.ok ? flowR.json?.flows : []) ?? [];
  flows.sort((a, b) => (Number(b.premium) || 0) - (Number(a.premium) || 0));
  return {
    ticker,
    spot: pos.spot ?? heat.spot,
    flip: pos.flip ?? pos.gamma_flip ?? heat.gex?.flip,
    callWall: pos.call_wall ?? pos.callWall ?? heat.gex?.call_wall,
    putWall: pos.put_wall ?? pos.putWall ?? heat.gex?.put_wall,
    maxPain: pos.max_pain ?? pos.maxPain ?? heat.max_pain,
    netGex: pos.net_gex ?? pos.netGex ?? heat.gex?.total,
    top: flows[0] ?? {},
    top3: flows.slice(0, 3),
    flowCount: flows.length,
  };
}

function buildCopy(story) {
  const t = story.ticker;
  const sym = t === "SPX" ? "$SPX" : `$${t}`;
  const spot = story.spot != null ? Number(story.spot).toFixed(t === "SPX" ? 2 : 2) : "—";
  const gexStr = fmtGex(story.netGex);
  const negGamma = Number(story.netGex) < 0;

  if (ANGLE === "spx-negative-gamma" || (t === "SPX" && negGamma)) {
    const top = story.top;
    const prem = fmtPrem(top.premium);
    const typ = String(top.option_type ?? "PUT").toUpperCase();
    const strike = top.strike;
    return assemblePost(
      [
        `${sym} ${spot} · dealers short gamma (${gexStr})`,
        ``,
        `Walls: ${story.putWall ?? "—"} put · ${story.callWall ?? "—"} call. Spot trapped between — moves can extend.`,
        prem ? `${prem} ${typ} ${strike} on the index tape.` : `Index flow still paying for downside.`,
        ``,
        `Thermal matrix + Helix whales + SPX Slayer rail. Three lenses, one index.`,
      ].join("\n"),
      "spx-negative-gamma",
    );
  }

  const top = story.top;
  const prem = fmtPrem(top.premium);
  const typ = String(top.option_type ?? "CALL").toUpperCase();
  return assemblePost(
    [
      `${sym} ${spot} · ${gexStr} net GEX`,
      prem ? `${prem} ${typ} ${top.strike} on the tape.` : "",
      `Walls ${story.putWall}/${story.callWall}. Desk live ↓`,
    ]
      .filter(Boolean)
      .join("\n"),
    `${t.toLowerCase()}-desk`,
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const story = await loadStory(TICKER);
  console.log("story", JSON.stringify(story, null, 2));

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
      console.log(`capture ${shot.id}…`);
      try {
        const buf = await captureByCatalogId(page, BASE, shot.id, shot.params ?? {});
        const path = join(OUT, shot.file);
        writeFileSync(path, buf);
        captured.push({ ...shot, path, bytes: buf.length, ok: true });
        console.log(`  ✓ ${path}`);
      } catch (err) {
        captured.push({ ...shot, ok: false, error: err?.message ?? String(err) });
        console.warn(`  ✗ ${shot.id}:`, err?.message ?? err);
      }
    }
  } finally {
    await browser.close();
    await auth.cleanup();
    await releaseAuditClerkSession();
  }

  const copy = pkg.buildCopy ? pkg.buildCopy(story) : buildCopy(story);
  writeFileSync(
    join(OUT, "POST.md"),
    [
      `# X post — ${slug}`,
      "",
      "## Copy",
      "",
      "```",
      copy,
      "```",
      "",
      "## Attachments",
      "",
      ...captured.filter((c) => c.ok).map((c) => `- ${c.role}: ${c.path}`),
      "",
      "## Data",
      "",
      "```json",
      JSON.stringify(story, null, 2),
      "```",
    ].join("\n"),
  );
  writeFileSync(join(OUT, "copy.txt"), copy);
  console.log("\n--- COPY ---\n");
  console.log(copy);
  console.log(`\n→ ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
