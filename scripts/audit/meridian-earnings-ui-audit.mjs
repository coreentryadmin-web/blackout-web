#!/usr/bin/env node
/**
 * Meridian earnings UI audit — drives the LIVE desk through the CONNECT-tunnel Chromium and
 * asserts the rebuilt tabs actually painted.
 *
 * Structured to fail HONESTLY. The trap this class of harness falls into is reporting a
 * product defect when the page never loaded: a blank render, a 404 and an auth bounce all
 * surface as "the halo is missing". So every tab check is gated on a PAGE-LOADED proof first
 * (the desk shell + the earnings tab bar), and a missing gate is reported as HARNESS, never as
 * a UI failure. Same reason `depth-ladder-ui-audit.mjs` requires the long-shipped Matrix tab.
 *
 * Read-only. One temp Clerk user, released in a finally. Never prints secrets.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/meridian-earnings-ui-audit.mjs [--base=https://blackouttrades.com] [--out=DIR]
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
// proxy-tunnel-context is CJS; an .mjs harness needs createRequire to load it.
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? "/tmp/meridian-ui";
// createTunneledContext takes a "WxH" STRING and a `desktop` flag, not a {width,height}.
const VIEWPORTS = [
  { name: "desktop", viewport: "1440x1000", desktop: true },
  { name: "tablet", viewport: "1024x1100", desktop: true },
  { name: "mobile", viewport: "430x932", desktop: false },
];

const TABS = [
  { id: "report", label: "Report", must: [".mr", ".ms-halo, .mv-halo", ".mv-rail-track"] },
  { id: "estimates", label: "Estimates", must: [".me", ".mv-traj-rows"] },
  { id: "positioning", label: "Positioning", must: [".mp", ".mv-rail-track"] },
  { id: "history", label: "History", must: [".mh"] },
];

function log(...a) {
  console.log(...a);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");

  let session = null;
  const results = [];
  try {
    session = await mintClerkPremiumSession({ appUrl: BASE });
    // A missing Clerk secret is a HARNESS condition, not a product failure — say so loudly
    // rather than reporting four empty tabs.
    if (session.skip) {
      log(`HARNESS SKIP: ${session.reason}`);
      return;
    }
    const cookie = session.cookieHeader;
    if (!cookie) throw new Error("HARNESS: no session cookie returned");

    for (const vp of VIEWPORTS) {
      const { browser, ctx, counts } = await createTunneledContext({
        url: `${BASE}/meridian`,
        cookie,
        viewport: vp.viewport,
        desktop: vp.desktop,
      });
      try {
        const page = await ctx.newPage();
        const errors = [];
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text().slice(0, 200));
        });

        await page.goto(`${BASE}/meridian`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        // The desk shell is the PAGE-LOADED gate. Without it every tab assertion below would be
        // reporting on a page that isn't there.
        const shell = await page.waitForSelector(".meridian-desk", { timeout: 45_000 }).catch(() => null);
        if (!shell) {
          results.push({ viewport: vp.name, verdict: "HARNESS", reason: "desk shell never rendered — page did not load" });
          continue;
        }

        // Open the first earnings event so the tabs exist at all.
        const row = await page
          .waitForSelector(".meridian-timeline-row, [class*='timeline-row']", { timeout: 30_000 })
          .catch(() => null);
        if (row) await row.click().catch(() => {});
        const tabBar = await page.waitForSelector(".meridian-earnings-tab", { timeout: 30_000 }).catch(() => null);
        if (!tabBar) {
          results.push({ viewport: vp.name, verdict: "HARNESS", reason: "earnings tab bar absent — no earnings event selected" });
          continue;
        }

        for (const tab of TABS) {
          const btn = await page.$(`.meridian-earnings-tab:has-text("${tab.label}")`).catch(() => null);
          if (btn) {
            await btn.click().catch(() => {});
            await page.waitForTimeout(900);
          }
          const found = {};
          for (const sel of tab.must) {
            found[sel] = await page.$(sel).then((e) => Boolean(e)).catch(() => false);
          }
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth
          );
          const shot = path.join(OUT, `${tab.id}-${vp.name}.png`);
          await page.screenshot({ path: shot, fullPage: vp.name !== "mobile" });
          const missing = Object.entries(found).filter(([, v]) => !v).map(([k]) => k);
          results.push({
            viewport: vp.name,
            tab: tab.id,
            verdict: missing.length === 0 && !overflow ? "GREEN" : "RED",
            missing,
            overflow,
            shot,
          });
        }
        results.push({ viewport: vp.name, consoleErrors: errors.length, sample: errors.slice(0, 3), routed: counts });
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    if (session && typeof session.cleanup === "function") await session.cleanup().catch(() => {});
  }

  log("\nMERIDIAN EARNINGS UI AUDIT\n");
  for (const r of results) log(" ", JSON.stringify(r));
  const reds = results.filter((r) => r.verdict === "RED");
  const harness = results.filter((r) => r.verdict === "HARNESS");
  log(`\n${reds.length} RED · ${harness.length} HARNESS · screenshots in ${OUT}`);
  if (harness.length) log("HARNESS failures are NOT product verdicts — the page did not load.");
  process.exitCode = reds.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
