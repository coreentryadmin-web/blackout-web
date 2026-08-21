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
 * COHORT GUARD (added 2026-08-21 after this harness produced three false REDs). It used to click
 * the FIRST earnings row on the timeline — whichever ticker happened to be next by date. Live, that
 * was `TP`: a low-impact micro-cap with `thermal.available: false`, no options market, and
 * therefore no expected move at all. `MeridianMoveRail` correctly renders NOTHING without a move
 * band, so `.mv-rail-track` was absent and the Positioning tab was reported RED on all three
 * viewports — for a panel behaving exactly as designed. On BABA (high impact, same session)
 * `expected_move_band` is `{spot 130.3, up 134.21, down 126.39}` and the rail paints.
 *
 * This is the same trap `meridian-earnings-data-inventory.mjs` carries `--min-importance` for:
 * a fill rate — or a painted/not-painted verdict — without its cohort is not a fact about the
 * field. So this harness now selects a HIGH-IMPACT earnings row, reports the ticker it judged in
 * every result line, and treats "no qualifying row visible" as HARNESS rather than as RED.
 *
 * Read-only. One temp Clerk user, released in a finally. Never prints secrets.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/meridian-earnings-ui-audit.mjs [--base=https://blackouttrades.com] [--out=DIR]
 *     [--min-impact=high|medium|low] [--viewport=desktop|tablet|mobile]
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
// proxy-tunnel-context is CJS; an .mjs harness needs createRequire to load it.
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
import {
  EARNINGS_ROW_BASE as ROW_BASE,
  describeCohort,
  earningsRowSelector,
  normalizeMinImpact,
} from "./lib/meridian-earnings-cohort.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? "/tmp/meridian-ui";
// Which cohort the run judges. `high` is the default because the options-derived panels are only
// populated for names with a real options market — see the cohort note in the header.
const MIN_IMPACT = normalizeMinImpact(args.get("min-impact"));
const ROW_SELECTOR = earningsRowSelector(MIN_IMPACT);
const COHORT = describeCohort(MIN_IMPACT);
// createTunneledContext takes a "WxH" STRING and a `desktop` flag, not a {width,height}.
// `--viewport=desktop` isolates one pass. Parity with meridian-interaction-audit.mjs, and the
// thing you actually want mid-rollout: a draining replica fails one viewport and re-running all
// three to re-check one is three more chances to hit the drain.
const ONLY = args.get("viewport") ?? null;
const VIEWPORTS = [
  { name: "desktop", viewport: "1440x1000", desktop: true },
  { name: "tablet", viewport: "1024x1100", desktop: true },
  { name: "mobile", viewport: "430x932", desktop: false },
].filter((v) => !ONLY || v.name === ONLY);

// Selectors are SCOPED to their own panel, and the two rails are distinguished.
// `.mv-rail-track` is rendered by BOTH MeridianMoveRail (inside `.mv-rail`) and MeridianTargetRail
// (inside `.mv-targets`), so a bare `.mv-rail-track` can be satisfied by whichever one happens to
// paint — the Report tab was passing on a TARGET rail while the assertion read as though it proved
// the move rail. An assertion that cannot say which component satisfied it cannot catch that
// component going missing.
const TABS = [
  { id: "report", label: "Report", must: [".mr", ".ms-halo, .mv-halo", ".mr .mv-rail-track"] },
  { id: "estimates", label: "Estimates", must: [".me", ".mv-traj-rows"] },
  { id: "positioning", label: "Positioning", must: [".mp", ".mp .mv-rail .mv-rail-track"] },
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

        // ERR_CONNECTION_RESET here is a DRAINING ECS REPLICA during an in-flight rollout, not
        // the sandbox egress block — the tunnel is proven working by this point. Retried once
        // after a pause, because a deploy is exactly the moment one connection dies and the next
        // succeeds. Without this the whole run aborts and reads as "the page is broken".
        const goto = () => page.goto(`${BASE}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
        let navOk = true;
        try {
          await goto();
        } catch {
          await page.waitForTimeout(12_000);
          try {
            await goto();
          } catch (e) {
            results.push({ viewport: vp.name, verdict: "HARNESS", reason: `navigation failed twice — ${String(e).slice(0, 110)}` });
            navOk = false;
          }
        }
        if (!navOk) continue;
        // The desk shell is the PAGE-LOADED gate. Without it every tab assertion below would be
        // reporting on a page that isn't there.
        const shell = await page.waitForSelector(".meridian-desk", { timeout: 45_000 }).catch(() => null);
        if (!shell) {
          results.push({ viewport: vp.name, verdict: "HARNESS", reason: "desk shell never rendered — page did not load" });
          continue;
        }

        // Open an EARNINGS event specifically. The timeline mixes macro / FDA / OpEx rows, and
        // clicking the first row lands on whichever kind happens to be next by date — a macro
        // print has no earnings tabs at all, so the run reported "tab bar absent" while the page
        // was perfectly healthy. The theme class is how a row declares its kind.
        //
        // ...and the IMPACT class is how it declares its cohort. Without that filter this picked
        // the next micro-cap by date and judged the options-derived panels against a name with no
        // options market — see the cohort note in the header.
        // Wait for the timeline to exist at all, THEN for the cohort row specifically. Querying
        // the cohort the instant the first earnings row appears races the list's staggered mount
        // (MeridianTimelineRow sets animationDelay index*40ms up to 400ms), so a high-impact row
        // a few hundred milliseconds behind the first one reads as "cohort absent". Caught live:
        // the API carried 61 high-impact earnings while this reported none.
        //
        // The two waits are separate on purpose — a missing TIMELINE and a missing COHORT are
        // different harness conditions and the reason line should say which.
        const timelineUp = await page.waitForSelector(ROW_BASE, { timeout: 30_000 }).catch(() => null);
        if (!timelineUp) {
          results.push({ viewport: vp.name, verdict: "HARNESS", reason: "no earnings row on the timeline at all" });
          continue;
        }
        const row = await page.waitForSelector(ROW_SELECTOR, { timeout: 20_000 }).catch(() => null);
        if (!row) {
          // A cohort we cannot sample is an UNKNOWN, not a pass and not a product failure.
          results.push({
            viewport: vp.name,
            verdict: "HARNESS",
            reason: `no ${MIN_IMPACT}-impact earnings row on the visible timeline — cohort not sampled`,
          });
          continue;
        }
        // Report WHICH name was judged. A verdict without its cohort is not a fact about the panel.
        const subject = await row
          .$eval(".meridian-timeline-title", (el) => el.textContent?.trim() ?? "")
          .catch(() => "");
        await row.click().catch(() => {});
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
            subject,
            cohort: COHORT,
            verdict: missing.length === 0 && !overflow ? "GREEN" : "RED",
            missing,
            overflow,
            shot,
          });
        }
        results.push({ viewport: vp.name, consoleErrors: errors.length, sample: errors.slice(0, 3), routed: counts });
      } catch (e) {
        // Per-viewport isolation: a thrown pass must not discard the verdicts already collected.
        results.push({ viewport: vp.name, verdict: "HARNESS", reason: String(e?.message ?? e).slice(0, 140) });
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
  if (harness.length)
    log("HARNESS failures are NOT product verdicts — the page did not load, or the cohort was unsampled.");
  log(`cohort judged: ${COHORT} (a verdict without its cohort is not a fact about the panel)`);
  process.exitCode = reds.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
