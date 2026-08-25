#!/usr/bin/env node
/**
 * Deep-desk X post — NOT matrix+tape defaults.
 * Uses sector grids, Helix analytics panels, Meridian analytics sections, Largo.
 *
 * Usage: node --import tsx scripts/audit/x-deep-post.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintIosPlaywrightSession } from "./lib/ios-playwright-auth.mjs";
import { releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { captureByCatalogId } from "./lib/x-capture-runner.mjs";
import { assemblePost } from "./lib/x-social-post-kit.mjs";

const BASE = "https://blackouttrades.com";
const OUT = "/opt/cursor/artifacts/x-posts/deep-desk-4";

/** Four attachments — each a DIFFERENT panel type (not matrix + whale tape). */
const SHOTS = [
  {
    product: "Thermal",
    panel: "Semis sector compare grid (7 names, 0DTE columns)",
    id: "thermal.sector_grid.semis",
    file: "1-thermal-semis-grid.png",
  },
  {
    product: "Helix",
    panel: "Analytics overlay — all panels grid",
    id: "helix.analytics_panels",
    file: "2-helix-analytics-grid.png",
  },
  {
    product: "Meridian",
    panel: "Analytics grid · Mega-cap earnings week strip",
    id: "meridian.megacap_week",
    file: "3-meridian-megacap-week.png",
    params: { panel: "megacap_week" },
  },
  {
    product: "Largo",
    panel: "Strongest setup on the board (cross-product)",
    id: "largo.board_best",
    file: "4-largo-board-best.png",
  },
];

const COPY_BODY = `Not matrix + tape again.

① Thermal · Semis sector grid (NVDA AMD AVGO MU SMCI INTC TSM)
② Helix · Analytics panels overlay (breadth, not the flow table)
③ Meridian · Mega-cap earnings week strip
④ Largo · What's the strongest setup on the board right now?

Four different panel types · one post ↓`;

async function main() {
  mkdirSync(OUT, { recursive: true });
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
    for (const shot of SHOTS) {
      console.log(`▸ ${shot.product} — ${shot.panel}`);
      try {
        const buf = await captureByCatalogId(page, BASE, shot.id, shot.params ?? {});
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

  const copy = assemblePost(COPY_BODY, "deep-desk-4");
  writeFileSync(join(OUT, "copy.txt"), copy);
  writeFileSync(
    join(OUT, "POST.md"),
    [
      "# Deep desk post — 4 different panel types",
      "",
      "Deliberately **not** single-ticker matrix + whale tape.",
      "",
      "## Copy",
      "",
      "```",
      copy,
      "```",
      "",
      "## Attachments",
      "",
      ...captured.filter((c) => c.ok).map((c) => `- **${c.product}** (${c.panel}): \`${c.path}\``),
      "",
      "## More panels in catalog (rotate next time)",
      "",
      "**Thermal:** sector grids (Mag7, AI, Space, Macro…) · GEX/VEX/DEX/CHARM lenses · gamma profile · forced-flow depth",
      "",
      "**Helix:** net premium · top prints · top strikes · contract drilldown · ticker drawer · whales/0DTE/indices filters",
      "",
      "**Meridian:** surprise scatter · print calendar heat · next 24h clock · estimate revisions · event tabs (report/estimates/positioning/history)",
      "",
      "**Largo:** gamma read · flow why · SPX shift · wall test · systems disagree",
      "",
      "```json",
      JSON.stringify(captured, null, 2),
      "```",
    ].join("\n"),
  );

  console.log("\n--- COPY ---\n", copy);
  console.log(`\n${captured.filter((c) => c.ok).length}/4 → ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
