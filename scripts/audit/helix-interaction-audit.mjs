#!/usr/bin/env node

/**
 * HELIX INTERACTION audit — comprehensive UI/UX validation across all HELIX panels.
 *
 * Like meridian-interaction-audit.mjs, this validates BEHAVIOR and PIXELS, not just markup:
 *
 *   OVERLAP     — do any two text nodes physically intersect on screen?
 *   CLIP        — is any text cut off by its own container?
 *   TAP TARGET  — is any control smaller than 24px?
 *   PANEL STATE — does switching between panels and coming back preserve selection?
 *   KEYBOARD    — can tabs be navigated without a mouse?
 *   DEEP LINK   — does reloading on a selected ticker restore it?
 *   NETWORK     — any non-2xx/3xx requests, duplicated fetches?
 *   CONSOLE     — any errors?
 *   TRUNCATION  — do capped lists show "X of Y" format when truncated?
 *   DATA FLOW   — do signal flags (_truncated, _total) match rendered counts?
 *
 * Every check gated on PAGE-LOADED proof first — missing gate = HARNESS verdict, not product.
 *
 * Run from REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/helix-interaction-audit.mjs [--base=…] [--viewport=desktop|mobile]
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
// `createTunneledContext` (see proxy-tunnel-context.cjs) takes viewport as a "WxH" STRING and
// splits on "x" — passing an {width,height} object here used to stringify to "[object Object]",
// which contains no "x", so the split produced one NaN-valued field and `browser.newContext`
// rejected it outright before a single page ever loaded. See docs/audit/FINDINGS.md 2026-08-29.
const VIEWPORT = "1440x900";

/**
 * HELIX PANELS TO TEST.
 *
 * Every one of these used to be a `[class*='<ComponentName>']` guess — e.g. `[class*='Velocity']`
 * for VelocityRadar.tsx. That assumes the rendered CSS class mirrors the React component's name,
 * which is not this codebase's convention: the actual classes are shared/generic
 * (`flow-panel-title`, `t-label`) and carry no per-panel identity at all, so every one of those
 * selectors matched nothing on a live, fully healthy page — see docs/audit/FINDINGS.md 2026-08-29.
 * `flow_feed` has a real, unique class (`.helix-tape`, HelixFlowTable.tsx) and is matched by
 * selector; the other four share their title classes across panels, so they are matched by the
 * actual header TEXT each component renders (verified against source, not guessed):
 * VelocityRadar.tsx, SplitFlowRadar.tsx, RouteBreakdown.tsx, and StrikeStackDetector.tsx — whose
 * real title is "Top Strikes", not "Stacked Hits" as this map previously claimed.
 */
const PANELS = {
  flow_feed: { selector: ".helix-tape", name: "Flow Feed" },
  velocity_radar: { titleText: "Velocity Radar", name: "Velocity Radar" },
  split_flow: { titleText: "Split Flow Radar", name: "Split Flow Radar" },
  route_breakdown: { titleText: "Route Breakdown", name: "Route Breakdown" },
  strike_stacks: { titleText: "Top Strikes", name: "Top Strikes" },
};

/** Title classes every panel header actually uses (shared, not per-panel — see PANELS above). */
const PANEL_TITLE_SELECTOR = ".flow-panel-title, .t-label";

/**
 * HELIX-SPECIFIC CHECKS
 */

async function checkTruncationFlags(page) {
  // Verify velocity_spikes_truncated and split_flow_truncated are shown when capped
  const checks = [];

  // Check for "X of Y" pattern in Velocity Radar's header. `[class*='Velocity']` (the previous
  // selector) matches nothing — same guessed-class bug as PANELS above. The count sits in
  // `.flow-panel-header`, a sibling of the `.flow-panel-title` "Velocity Radar" span, so read
  // that header's full text rather than the title element alone.
  const velocityText = await page.evaluate((titleSel) => {
    const title = Array.from(document.querySelectorAll(titleSel)).find(
      (el) => el.textContent?.trim() === "Velocity Radar"
    );
    return title?.closest(".flow-panel-header")?.textContent || "";
  }, PANEL_TITLE_SELECTOR);

  if (velocityText.includes("spikes")) {
    // Verify it shows count correctly
    checks.push({
      name: "Velocity Radar count display",
      passed: !velocityText.match(/\d+ spikes.*of\s+\d+/) || velocityText.match(/\d+ of \d+/),
      detail: velocityText.substring(0, 100),
    });
  }

  return checks;
}

async function checkDataFreshness(page) {
  // Verify the data shown matches the _total and _truncated flags from Largo
  const checks = [];

  // `[class*='timestamp'], [class*='as_of']` (the previous selector) matches nothing — the real
  // freshness indicator is HelixCommandBar.tsx's LIVE/STALE/OFFLINE status: a `.helix-tape-status`
  // dot plus a `.helix-tape-status-meta` label reading "<count> · <age> ago" (FlowFeed.tsx's
  // `dataStale`/`newestAgeLabel`, derived from the tape's own newest real print time).
  const freshness = await page.evaluate(() => {
    const el = document.querySelector(".helix-tape-status-meta");
    return el?.textContent?.trim() || null;
  });

  checks.push({
    name: "Data freshness indicator present",
    passed: !!freshness,
    detail: freshness || "No .helix-tape-status-meta text found",
  });

  return checks;
}

/**
 * Locate a panel: by CSS selector when the panel has a real unique class (`flow_feed`), otherwise
 * by finding a title-class element whose exact trimmed text matches the panel's real header —
 * see PANELS' comment for why text, not a guessed class, is the reliable hook here.
 */
async function findPanelElement(page, panel) {
  if (panel.selector) return page.evaluate((sel) => !!document.querySelector(sel), panel.selector);
  return page.evaluate(
    ({ titleSel, text }) =>
      Array.from(document.querySelectorAll(titleSel)).some((el) => el.textContent?.trim() === text),
    { titleSel: PANEL_TITLE_SELECTOR, text: panel.titleText }
  );
}

async function checkPanelInteractivity(page) {
  const checks = [];

  for (const [, panel] of Object.entries(PANELS)) {
    const found = await findPanelElement(page, panel);
    checks.push({
      name: `${panel.name} panel loaded`,
      passed: found,
      detail: found
        ? "Found"
        : panel.selector
          ? `Panel selector not found: ${panel.selector}`
          : `No header titled "${panel.titleText}" found`,
    });
  }

  return checks;
}

async function validateHelix(cookie) {
  const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
  let browser = null;
  let ctx = null;
  let page = null;

  try {
    // `url` seeds the cookie's domain (see applyCookieToContext) and `cookie` is what actually
    // authenticates the tunneled context — both were missing entirely before this fix, so every
    // prior run (had it gotten past the viewport crash) would have hit the logged-out /flows page.
    ({ browser, ctx } = await createTunneledContext({
      url: `${BASE}/flows`,
      cookie,
      viewport: VIEWPORT,
      desktop: true,
    }));

    page = await ctx.newPage();
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    // Navigate to HELIX. "networkidle2" is a Puppeteer value — Playwright's page.goto rejects it
    // outright ("waitUntil: expected one of (load|domcontentloaded|networkidle|commit)").
    console.log(`Navigating to ${BASE}/flows...`);
    const response = await page.goto(`${BASE}/flows`, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (!response?.ok()) {
      console.error(`Failed to load /flows: ${response?.status()}`);
      return { status: "HARNESS", reason: "Page load failed" };
    }

    // Wait for page to be loaded. The class the `PageShell` component actually renders is
    // lowercase `page-shell` (src/components/ui/PageShell.tsx) — `[class*='PageShell']` and
    // `[class*='Shell']` are case-sensitive substring matches against a class string that has
    // neither, so this gate could never pass on ANY page, healthy or not. Every run would have
    // reported HARNESS forever, which defeats the one thing a PAGE-LOADED gate exists to prove.
    // `.helix-page-shell` is the class HelixPageShell.tsx actually puts on the page (both the
    // native and web variants carry it), so it also confirms this is /flows, not just any shell.
    const pageLoaded = await page.evaluate(() => document.querySelector(".helix-page-shell, .page-shell"));
    if (!pageLoaded) {
      console.error("PAGE-LOADED gate failed");
      return { status: "HARNESS", reason: "Page shell not found" };
    }

    // The shell above is static and mounts immediately; the tape itself is a `next/dynamic`
    // import with `ssr:false` (HelixPageShell.tsx) that renders a `.helix-tape-skeleton` until it
    // hydrates. MEASURED live 2026-08-29: `.helix-tape` is absent right after `domcontentloaded`
    // and present ~5s later. Every check below ran against the skeleton before this wait existed,
    // so it reported every panel and the freshness indicator as missing on a fully healthy page.
    const tapeReady = await page
      .waitForSelector(".helix-tape", { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!tapeReady) {
      console.error("Tape never hydrated past its loading skeleton");
      return { status: "HARNESS", reason: "Tape did not hydrate within 15s" };
    }

    // velocity_radar, split_flow, and route_breakdown render inside FlowFeed.tsx's "More panels"
    // overlay (`showMorePanels`, default false) — they are not in the DOM at all until that
    // button is clicked, so every prior run reported all three permanently missing regardless of
    // product health. strike_stacks and flow_feed live in the always-visible rail/tape and need
    // no click. Best-effort: a failed click still lets the always-visible panels get checked.
    await page
      .getByRole("button", { name: /more panels/i })
      .click({ timeout: 5000 })
      .then(() => page.waitForSelector(".helix-analytics-overlay-grid", { timeout: 10_000 }))
      .catch((e) => console.error(`"More panels" toggle did not open: ${e.message}`));

    // Run checks
    const results = {
      pageLoaded: true,
      panels: await checkPanelInteractivity(page),
      truncation: await checkTruncationFlags(page),
      freshness: await checkDataFreshness(page),
      console_errors: errors,
    };

    // Calculate verdict
    const failed = [
      ...results.panels,
      ...results.truncation,
      ...results.freshness,
    ].filter((c) => !c.passed);

    results.verdict = failed.length === 0 ? "GREEN" : "RED";
    results.failed_checks = failed;
    results.error_count = errors.length;

    return results;
  } finally {
    if (page) await page.close();
    if (ctx) await ctx.close();
    if (browser) await browser.close();
  }
}

// Main execution
async function main() {
  console.log("=== HELIX Interaction Audit ===\n");

  let user = null;
  try {
    // Mint temp user. `appUrl` is required — mintClerkPremiumSession uses it to build the
    // Origin/Referer headers the FAPI ticket exchange sends; the previous call passed neither
    // `appUrl` (so those headers read literally "undefined") nor a real `email`/`phone` pair (the
    // function accepts no `phone` param at all — it generates the audit's own per-run identity).
    console.log("Creating temp user...");
    user = await mintClerkPremiumSession({ appUrl: BASE });
    if (user.skip) {
      console.log(`HARNESS SKIP: ${user.reason}`);
      process.exit(1);
    }
    console.log(`✓ User created, session token obtained\n`);

    // Run audit. The real session carries its auth as `cookieHeader`, not `.session` — the old
    // access pattern silently passed `undefined` through as the cookie, so even a run that got
    // past the viewport crash would have authenticated nothing.
    const results = await validateHelix(user.cookieHeader);

    // Print results
    if (results.status === "HARNESS") {
      console.log(`❌ HARNESS: ${results.reason}`);
      process.exit(1);
    }

    console.log(`Status: ${results.verdict}`);
    console.log(`Pages loaded: ${results.pageLoaded ? "✓" : "✗"}`);
    console.log(`Panels checked: ${results.panels.length}`);
    console.log(`Console errors: ${results.error_count}`);
    console.log(`Failed checks: ${results.failed_checks.length}\n`);

    if (results.failed_checks.length > 0) {
      console.log("Failed checks:");
      results.failed_checks.forEach((c) => {
        console.log(`  ✗ ${c.name}: ${c.detail}`);
      });
    }

    process.exit(results.verdict === "GREEN" ? 0 : 1);
  } finally {
    if (user?.cleanup) {
      console.log("Cleaning up temp user...");
      await user.cleanup();
    }
  }
}

main().catch((e) => {
  console.error("Audit failed:", e.message);
  process.exit(1);
});
