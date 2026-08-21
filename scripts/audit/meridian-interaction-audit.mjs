#!/usr/bin/env node
/**
 * Meridian INTERACTION audit — the sweep a demanding analyst does by hand, driven through the
 * CONNECT-tunnel Chromium against LIVE prod.
 *
 * Deliberately different from `meridian-earnings-ui-audit.mjs`, which asks "did the right
 * selectors paint?". That question is satisfied by a panel whose labels overlap into garbage,
 * which is exactly how two P2 defects shipped: they are pixel and behaviour facts, not
 * presence facts. This harness asks the questions presence cannot answer:
 *
 *   OVERLAP     — do any two text nodes inside a panel physically intersect on screen?
 *   CLIP        — is any text cut off by its own container (scrollWidth > clientWidth)?
 *   TAP TARGET  — is any control smaller than 24px in either axis?
 *   STATE       — does switching tabs and coming back preserve what was selected?
 *   RAPID       — does hammering the tab bar leave more than one tab marked active, or throw?
 *   KEYBOARD    — can the tab bar be reached and operated without a mouse, with a focus ring?
 *   DEEP LINK   — does reloading on a selected event restore it, or silently drop to default?
 *   NETWORK     — any non-2xx/3xx request, and any request fired more than twice (dup fetches)?
 *   CONSOLE     — any error at all.
 *
 * Every check is gated on a PAGE-LOADED proof first, and a missing gate is reported as HARNESS,
 * never as a product verdict — a blank page, a 404 and an auth bounce otherwise all read as
 * "the panel is broken".
 *
 * Read-only. One temp Clerk user, released in a finally. Never prints secrets.
 *
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1:
 *   node scripts/audit/meridian-interaction-audit.mjs [--base=…] [--out=DIR] [--viewport=desktop]
 */
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
import { splitOverFetches } from "./lib/expected-poll-count.mjs";
import {
  EARNINGS_ROW_BASE,
  describeCohort,
  earningsRowSelector,
  normalizeMinImpact,
  splitAuthFailures,
} from "./lib/meridian-earnings-cohort.mjs";
import { splitConsoleErrors } from "./lib/console-error-triage.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? "/tmp/meridian-ix";
const ONLY = args.get("viewport") ?? null;
// Which cohort this run judges — see lib/meridian-earnings-cohort.mjs. Default `high`, because the
// options-derived panels only populate for names with a real options market, so judging them
// against a micro-cap measures the cohort rather than the UI.
const MIN_IMPACT = normalizeMinImpact(args.get("min-impact"));
const ROW_SELECTOR = earningsRowSelector(MIN_IMPACT);
const COHORT = describeCohort(MIN_IMPACT);

const VIEWPORTS = [
  { name: "desktop", viewport: "1440x1000", desktop: true },
  { name: "tablet", viewport: "1024x1100", desktop: true },
  { name: "mobile", viewport: "430x932", desktop: false },
].filter((v) => !ONLY || v.name === ONLY);

const TABS = ["Summary", "Report", "Estimates", "Positioning", "History"];

/** Panels whose interiors are checked for overlap/clip. Scoped so one bad panel is nameable. */
const PANEL_ROOTS = [".msum", ".mr", ".me", ".mp", ".mh"];

const findings = [];
const record = (f) => {
  findings.push(f);
  console.log(`  [${f.severity}] ${f.viewport}/${f.where} — ${f.issue}`);
};

/**
 * Physical overlap between rendered TEXT nodes, measured in the page.
 *
 * Only leaf elements with their own text are compared: a parent always "overlaps" its child,
 * and reporting that would bury the real hits under hundreds of false ones. Zero-size and
 * invisible nodes are skipped for the same reason.
 */
const OVERLAP_PROBE = (rootSel) => {
  const root = document.querySelector(rootSel);
  if (!root) return null;
  const leaves = [...root.querySelectorAll("*")].filter((el) => {
    if (el.children.length > 0) return false;
    const t = (el.textContent ?? "").trim();
    if (!t) return false;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.15) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  });
  const boxes = leaves.map((el) => ({ el, r: el.getBoundingClientRect(), t: el.textContent.trim().slice(0, 30) }));
  const hits = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      // An SVG <text> inside the same <g> legitimately shares a box with its own decoration;
      // require a real 2-D intersection of at least 2px on BOTH axes before calling it.
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 2 && oy > 2) hits.push({ a: a.t, b: b.t, ox: Math.round(ox), oy: Math.round(oy) });
    }
  }
  const clipped = boxes
    .filter(({ el }) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
    .map(({ t }) => t);
  return { hits: hits.slice(0, 12), hitCount: hits.length, clipped: clipped.slice(0, 8), leaves: boxes.length };
};

const SMALL_TARGET_PROBE = (rootSel) => {
  const root = document.querySelector(rootSel) ?? document.body;
  return [...root.querySelectorAll("button, a[href], [role=button], input, select")]
    .filter((el) => {
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
    })
    .map((el) => ({
      label: (el.getAttribute("aria-label") ?? el.textContent ?? el.tagName).trim().slice(0, 28),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }))
    .slice(0, 10);
};

async function openEarningsEvent(page, vp) {
  const goto = () => page.goto(`${BASE}/meridian`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  try {
    await goto();
  } catch {
    // A dead connection here is a DRAINING ECS REPLICA mid-rollout, not the sandbox egress
    // block — the tunnel is already proven by this point. Retry once before giving up.
    await page.waitForTimeout(12_000);
    await goto();
  }
  if (!(await page.waitForSelector(".meridian-desk", { timeout: 45_000 }).catch(() => null))) {
    record({ severity: "HARNESS", viewport: vp, where: "page", issue: "desk shell never rendered" });
    return false;
  }
  // Target an EARNINGS row specifically: the timeline mixes macro/FDA/OpEx rows, and those have
  // no earnings tabs at all, so clicking the first row reports a product failure on a healthy page.
  //
  // ...and target the right COHORT. Clicking the first earnings row lands on whichever name is
  // next by date — live, a low-impact micro-cap with no options market, against which the
  // options-derived panels are legitimately empty. Judging them there measures the cohort, not
  // the UI. See lib/meridian-earnings-cohort.mjs.
  // Two separate waits: the timeline existing, then the COHORT row appearing. Querying the
  // cohort immediately after the first earnings row races the staggered mount (animationDelay
  // index*40ms) and reports "cohort absent" while the API carries dozens of qualifying events.
  const timelineUp = await page.waitForSelector(EARNINGS_ROW_BASE, { timeout: 30_000 }).catch(() => null);
  if (!timelineUp) {
    record({ severity: "HARNESS", viewport: vp, where: "timeline", issue: "no earnings row on the timeline at all" });
    return false;
  }
  const row = await page.waitForSelector(ROW_SELECTOR, { timeout: 20_000 }).catch(() => null);
  if (!row) {
    record({
      severity: "HARNESS",
      viewport: vp,
      where: "timeline",
      issue: `no ${COHORT} earnings row visible — cohort not sampled`,
    });
    return false;
  }
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click().catch(() => {});
  if (!(await page.waitForSelector(".meridian-earnings-tab", { timeout: 30_000 }).catch(() => null))) {
    record({ severity: "HARNESS", viewport: vp, where: "timeline", issue: "earnings tab bar never appeared" });
    return false;
  }
  return true;
}

async function auditViewport(vp, cookie) {
  const { browser, ctx, counts } = await createTunneledContext({
    url: `${BASE}/meridian`,
    cookie,
    viewport: vp.viewport,
    desktop: vp.desktop,
    // The Meridian timeline is legitimately slow on a cold cache — it aggregates ~160 events and
    // computes an options-implied move for the 36 highest-impact prints. Measured 2026-08-21:
    // 8.5s cold, then 117ms and 87ms warm. Against the tunnel's default 20s deadline that is
    // usually fine and occasionally not: three separate passes that day (desktop and tablet in
    // one run, tablet again in the next) died with `timeline?days=21: timeout` and reported
    // "no earnings row on the timeline at all" — the audit never reached a single tab.
    //
    // That is the failure `createTunneledContext`'s own note warns about: a deadline shorter than
    // the upstream turns "this is slow right now" into "this panel is missing". HARNESS keeps it
    // out of the product verdict, but a pass that judges nothing is still a pass that judges
    // nothing, and three of them in a row is an audit that has quietly stopped auditing.
    // A deadline chosen on purpose, well clear of the measured cold path.
    requestTimeoutMs: 70_000,
  });
  try {
    const page = await ctx.newPage();
    const consoleErrors = [];
    // Set when badResponses is triaged below; the console branch needs it to tell an echo of this
    // run's own expiry from an unexplained 401.
    let authFailureCount = 0;
    const badResponses = [];
    const requestCounts = new Map();
    // When the page actually opened, so a fetch count can be judged against the time it had to
    // accumulate in. Two Meridian panels poll on purpose (10-15s), so a bare count is not a defect.
    const pageOpenedAt = Date.now();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 180));
    });
    page.on("response", (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 110)}`);
    });
    page.on("request", (r) => {
      // Only app data matters; static assets legitimately repeat across navigations.
      if (r.url().includes("/api/")) requestCounts.set(r.url(), (requestCounts.get(r.url()) ?? 0) + 1);
    });

    if (!(await openEarningsEvent(page, vp.name))) return { counts, consoleErrors, badResponses };

    for (const tab of TABS) {
      const btn = await page.$(`.meridian-earnings-tab:has-text("${tab}")`).catch(() => null);
      if (!btn) {
        record({ severity: "P2", viewport: vp.name, where: `tab:${tab}`, issue: "tab button not present" });
        continue;
      }
      await btn.click().catch(() => {});
      await page.waitForTimeout(1100);

      for (const rootSel of PANEL_ROOTS) {
        const res = await page.evaluate(OVERLAP_PROBE, rootSel).catch(() => null);
        // null = that panel belongs to another tab. `undefined` would mean the probe never ran,
        // which must never be mistaken for "clean" — that is how a whole audit reports GREEN
        // while measuring nothing.
        if (res === undefined) {
          record({ severity: "HARNESS", viewport: vp.name, where: `${tab}${rootSel}`, issue: "overlap probe returned undefined — it did not execute" });
          continue;
        }
        if (res === null) continue;
        if (res.hitCount > 0) {
          record({
            severity: "P2",
            viewport: vp.name,
            where: `${tab}${rootSel}`,
            issue: `${res.hitCount} overlapping text pairs`,
            sample: res.hits.slice(0, 4).map((h) => `"${h.a}" ∩ "${h.b}" ${h.ox}x${h.oy}px`),
          });
        }
        if (res.clipped.length > 0) {
          record({
            severity: "P3",
            viewport: vp.name,
            where: `${tab}${rootSel}`,
            issue: `${res.clipped.length} clipped text nodes`,
            sample: res.clipped,
          });
        }
      }

      const small = await page.evaluate(SMALL_TARGET_PROBE, ".meridian-desk").catch(() => null);
      if (!Array.isArray(small)) {
        record({ severity: "HARNESS", viewport: vp.name, where: `${tab}:targets`, issue: "tap-target probe did not execute" });
      } else if (small.length > 0) {
        record({
          severity: "P3",
          viewport: vp.name,
          where: `${tab}:targets`,
          issue: `${small.length} controls under 24px`,
          sample: small.map((s) => `${s.label} ${s.w}x${s.h}`),
        });
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      );
      if (overflow) {
        record({ severity: "P2", viewport: vp.name, where: `${tab}:layout`, issue: "page scrolls horizontally" });
      }

      await page.screenshot({ path: path.join(OUT, `${tab.toLowerCase()}-${vp.name}.png`), fullPage: vp.name !== "mobile" });
    }

    // ── RAPID: hammer the tab bar. A tab bar that keeps two tabs active, or throws, is a state bug.
    const tabButtons = await page.$$(".meridian-earnings-tab");
    for (let i = 0; i < 18; i++) {
      await tabButtons[i % tabButtons.length]?.click().catch(() => {});
    }
    await page.waitForTimeout(1200);
    const activeCount = await page.evaluate(
      () => document.querySelectorAll(".meridian-earnings-tab.is-active, .meridian-earnings-tab[aria-selected=true]").length
    );
    if (activeCount !== 1) {
      record({
        severity: "P2",
        viewport: vp.name,
        where: "tabs:rapid",
        issue: `${activeCount} tabs marked active after rapid switching (expected exactly 1)`,
      });
    }

    // ── KEYBOARD: the tab bar must be reachable and show a visible focus ring.
    const focusable = await page.evaluate(() => {
      const el = document.querySelector(".meridian-earnings-tab");
      if (!el) return null;
      el.focus();
      const s = getComputedStyle(el, ":focus-visible");
      return {
        focused: document.activeElement === el,
        outline: s.outlineStyle !== "none" || s.boxShadow !== "none",
      };
    });
    if (focusable && !focusable.focused) {
      record({ severity: "P3", viewport: vp.name, where: "tabs:keyboard", issue: "tab button cannot take focus" });
    }
    if (focusable && focusable.focused && !focusable.outline) {
      record({ severity: "P3", viewport: vp.name, where: "tabs:keyboard", issue: "focused tab has no visible focus indicator" });
    }

    // ── DEEP LINK: reload on the current URL and check the earnings view survives.
    const url = page.url();
    if (/[?#]/.test(url)) {
      // A SWALLOWED reload is not evidence of anything. The first version caught the reload
      // error and then timed out waiting for the tab bar on a page that had never navigated,
      // and reported that as a product defect — a mobile "deep link does not restore" verdict
      // that a direct probe disproved in one run (tab bar present, correct row active, detail
      // rendered). Report a failed navigation as HARNESS, and retry once, because a dead
      // connection here is a draining ECS replica.
      let reloaded = true;
      try {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      } catch {
        await page.waitForTimeout(10_000);
        try {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
        } catch (e) {
          reloaded = false;
          record({
            severity: "HARNESS",
            viewport: vp.name,
            where: "deeplink",
            issue: `reload failed twice, deep link NOT tested — ${String(e?.message ?? e).slice(0, 90)}`,
          });
        }
      }
      if (reloaded) {
        const survived = await page.waitForSelector(".meridian-earnings-tab", { timeout: 40_000 }).catch(() => null);
        if (!survived) {
          record({
            severity: "P2",
            viewport: vp.name,
            where: "deeplink",
            issue: `reloading ${url.slice(0, 80)} does not restore the selected earnings event`,
          });
        }
      }
    } else {
      record({
        severity: "P3",
        viewport: vp.name,
        where: "deeplink",
        issue: "selecting an event does not change the URL — the view cannot be linked or restored",
      });
    }

    // A COUNT IS NOT A DEFECT WITHOUT THE TIME IT ACCUMULATED IN.
    //
    // MeridianDesk polls the event detail through SWR at 10s (event within the hour) or 15s
    // (already printed). This check used to flag anything over 2 and so reported `4×
    // /api/market/meridian/event?id=earnings:BEKE:2026-08-21` as a duplicate fetch, on a run that
    // held the page ~60s. The product was correct; the check was not — and it fired hardest on
    // the panels nearest a live catalyst, which is the worst place to cry wolf.
    const elapsedMs = Date.now() - pageOpenedAt;
    const { over, explained } = splitOverFetches([...requestCounts.entries()], elapsedMs);
    if (over.length > 0) {
      record({
        severity: "P3",
        viewport: vp.name,
        where: "network",
        issue: `${over.length} API endpoints fetched more than polling can explain (page open ${Math.round(elapsedMs / 1000)}s)`,
        sample: over.slice(0, 5).map((o) => `${o.count}× (max ${o.max}) ${o.url.slice(-64)}`),
      });
    }
    // Say what was EXPLAINED as well. Silence here would read as "nothing repeated", when what
    // actually happened is that a repeat was understood — a different fact, and the one that
    // proves this check was not simply widened until it stopped firing.
    if (explained.length > 0) {
      console.log(
        `  [poll] ${explained.length} endpoint(s) repeated within their polling cadence over ${Math.round(elapsedMs / 1000)}s: ` +
          explained.map((e) => `${e.count}/${e.max} ${e.url.slice(-48)}`).join(", ")
      );
    }
    if (badResponses.length > 0) {
      // A 401/403 is THIS HARNESS losing its session, not the product failing. A run can outlive
      // its ~72s JWT, and CLAUDE.md records that exactly this was mis-read as a product fault
      // three times. Reported as HARNESS, and separately from real failures.
      const { auth, failures } = splitAuthFailures(badResponses);
      authFailureCount = auth.length;
      if (auth.length) {
        record({
          severity: "HARNESS",
          viewport: vp.name,
          where: "auth",
          issue: `${auth.length} auth failures (401/403) — session lost mid-run, NOT a product verdict`,
          sample: auth.slice(0, 3),
        });
      }
      if (failures.length) {
        record({ severity: "P2", viewport: vp.name, where: "network", issue: `${failures.length} failed requests`, sample: failures.slice(0, 5) });
      }
    }
    if (consoleErrors.length > 0) {
      // Chromium logs every 401/403 to the console as well as returning it, so the auth failures
      // already reported as HARNESS above arrived here a second time and were counted as a
      // product P2 — the harness's own expired session, reported twice, once as a defect. Only
      // errors the auth count actually explains are reclassified; see console-error-triage.mjs.
      const { product, authEcho } = splitConsoleErrors(consoleErrors, authFailureCount);
      if (product.length > 0) {
        record({ severity: "P2", viewport: vp.name, where: "console", issue: `${product.length} console errors`, sample: product.slice(0, 4) });
      }
      if (authEcho.length > 0) {
        record({
          severity: "HARNESS",
          viewport: vp.name,
          where: "console",
          issue: `${authEcho.length} console errors are the browser echoing this run's own 401/403 — NOT a product verdict`,
          sample: authEcho.slice(0, 2),
        });
      }
    }

    return { counts, consoleErrors, badResponses };
  } catch (e) {
    // Per-viewport isolation: one thrown pass must not discard verdicts already collected.
    record({ severity: "HARNESS", viewport: vp.name, where: "run", issue: String(e?.stack ?? e).slice(0, 600) });
    return { counts, consoleErrors: [], badResponses: [] };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  let session = null;
  try {
    session = await mintClerkPremiumSession({ appUrl: BASE });
    if (session.skip) {
      console.log(`HARNESS SKIP: ${session.reason}`);
      return;
    }
    for (const vp of VIEWPORTS) {
      console.log(`\n── ${vp.name} (${vp.viewport}) ──`);
      const r = await auditViewport(vp, session.cookieHeader);
      console.log(`  routed: ${JSON.stringify(r.counts)}`);
    }
  } finally {
    if (session && typeof session.cleanup === "function") await session.cleanup().catch(() => {});
  }

  console.log("\nMERIDIAN INTERACTION AUDIT\n");
  const bySev = (s) => findings.filter((f) => f.severity === s);
  for (const f of findings) console.log(" ", JSON.stringify(f));
  console.log(
    `\n${bySev("P2").length} P2 · ${bySev("P3").length} P3 · ${bySev("HARNESS").length} HARNESS · screenshots in ${OUT}`
  );
  if (bySev("HARNESS").length)
    console.log(
      "HARNESS entries are NOT product verdicts — the page did not load, the cohort was unsampled, or the session expired."
    );
  console.log(`cohort judged: ${COHORT} (a verdict without its cohort is not a fact about the panel)`);
  process.exitCode = bySev("P2").length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
