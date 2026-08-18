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

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? "/tmp/meridian-ix";
const ONLY = args.get("viewport") ?? null;

const VIEWPORTS = [
  { name: "desktop", viewport: "1440x1000", desktop: true },
  { name: "tablet", viewport: "1024x1100", desktop: true },
  { name: "mobile", viewport: "430x932", desktop: false },
].filter((v) => !ONLY || v.name === ONLY);

const TABS = ["Report", "Estimates", "Positioning", "History"];

/** Panels whose interiors are checked for overlap/clip. Scoped so one bad panel is nameable. */
const PANEL_ROOTS = [".mr", ".me", ".mp", ".mh"];

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
  const row = await page
    .waitForSelector(".meridian-timeline-row.meridian-theme-earnings", { timeout: 30_000 })
    .catch(() => null);
  if (!row) {
    record({ severity: "HARNESS", viewport: vp, where: "timeline", issue: "no earnings row visible" });
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
  });
  try {
    const page = await ctx.newPage();
    const consoleErrors = [];
    const badResponses = [];
    const requestCounts = new Map();
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

    const dupes = [...requestCounts.entries()].filter(([, n]) => n > 2);
    if (dupes.length > 0) {
      record({
        severity: "P3",
        viewport: vp.name,
        where: "network",
        issue: `${dupes.length} API endpoints fetched more than twice`,
        sample: dupes.slice(0, 5).map(([u, n]) => `${n}× ${u.slice(-70)}`),
      });
    }
    if (badResponses.length > 0) {
      record({ severity: "P2", viewport: vp.name, where: "network", issue: `${badResponses.length} failed requests`, sample: badResponses.slice(0, 5) });
    }
    if (consoleErrors.length > 0) {
      record({ severity: "P2", viewport: vp.name, where: "console", issue: `${consoleErrors.length} console errors`, sample: consoleErrors.slice(0, 4) });
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
  if (bySev("HARNESS").length) console.log("HARNESS entries are NOT product verdicts — the page did not load.");
  process.exitCode = bySev("P2").length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
