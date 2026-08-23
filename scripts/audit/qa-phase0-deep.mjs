#!/usr/bin/env node
/**
 * QA lane — Phase 0 DEEP interaction pass.
 *
 * Supersedes the shallow crawl in qa-phase0-sweep.mjs for the seven product routes. The
 * coordinator's correction after reviewing #2775: a route that was navigated to and screenshotted
 * is not a route that was TESTED. The brief (docs/agents/briefs/qa-adversarial.md §1) specifies
 * clicking every tab/panel, searching, changing every filter/expiration/sort, opening/closing
 * drawers — and then verifying the RESULTING STATE is correct, not merely that no console error
 * fired. This harness does that, generically, without per-product hardcoded selectors:
 *
 *   1. INVENTORY every visible interactive element in the product shell (excludes header/nav/
 *      footer — that chrome is identical on every route and already covered once).
 *   2. INTERACT with each one for real (click a tab, sort a column, type into search, change a
 *      select, toggle a switch, open/close a drawer).
 *   3. VERIFY the resulting DOM actually changed the way the interaction implies — not just that
 *      it didn't throw. A tab click that leaves the panel's text byte-identical, or that leaves
 *      two tabs marked active, is a defect this reports; a shallow "did it throw" check would
 *      have missed both.
 *
 * A destructive-action blocklist skips anything that reads like sign-out, billing, delete, or
 * unsubscribe — this account is a disposable temp Clerk user, but a click here can still fire a
 * real side effect against production infrastructure (an email, a webhook, a write), and testing
 * interaction correctness does not require testing account-destruction paths.
 *
 * Same CONNECT-tunnel technique as qa-phase0-sweep.mjs / meridian-interaction-audit.mjs — see
 * docs/audit/LIVE-UI-CONNECTION.md. One temp Clerk premium session per invocation (mint is cheap
 * relative to a whole route's interaction pass; a long-lived session risks expiring mid-sweep).
 * One route+viewport per process, spawned by the caller with a cooldown between — the proxy tunnel
 * in this sandbox saturates under sustained load (lib/proxy-saturation.mjs), and on 2026-08-23 that
 * saturation was severe enough that qa-phase0-sweep.mjs's shallow pass reported HARNESS on every
 * route after the second. This script raises the cooldown and retry patience accordingly and, more
 * importantly, extracts far more signal per navigation that DOES succeed, so a saturated proxy
 * costs fewer un-judged routes for the same number of successful navigations.
 *
 * Read-only. Never prints secrets.
 *
 * Run per route:
 *   node --import tsx scripts/audit/qa-phase0-deep.mjs --route=/nighthawk --viewport=desktop [--base=...] [--out=DIR]
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
import { splitConsoleErrors } from "./lib/console-error-triage.mjs";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const OUT = args.get("out") ?? fs.mkdtempSync(path.join(os.tmpdir(), "qa-deep-"));
const ROUTE = args.get("route");
const VP_NAME = args.get("viewport") ?? "desktop";
if (!ROUTE) {
  console.error("FAILED: --route is required, e.g. --route=/nighthawk");
  process.exit(1);
}
const VIEWPORTS = {
  desktop: { viewport: "1440x900", desktop: true },
  mobile: { viewport: "430x932", desktop: false },
};
const VP = VIEWPORTS[VP_NAME];
if (!VP) {
  console.error(`FAILED: unknown viewport "${VP_NAME}" (expected desktop|mobile)`);
  process.exit(1);
}

/** Labels this harness refuses to click, no matter what element carries them. See file header. */
const DANGEROUS_LABEL = /sign[\s-]*out|log[\s-]*out|delete|remove|cancel\b|unsubscribe|downgrade|upgrade|billing|checkout|purchase|\bbuy\b|\bpay\b|invite|contact\s*support/i;

const findings = [];
const record = (f) => {
  findings.push(f);
  console.log(`  [${f.severity}] ${f.route}/${f.viewport}/${f.where} — ${f.issue}`);
};

/** Runs in-page. Describes every candidate interactive element, outside header/nav/footer. */
const INVENTORY = () => {
  const inShell = (el) => !el.closest("header, nav, [role=navigation], footer, [class*=cookie], [class*=banner]");
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.15) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const label = (el) =>
    (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("title") ?? el.tagName)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 48);

  const tabs = [...document.querySelectorAll('[role=tab]')].filter(inShell).filter(visible).map(label);
  const sortHeaders = [...document.querySelectorAll("th")]
    .filter(inShell)
    .filter(visible)
    .filter((el) => getComputedStyle(el).cursor === "pointer" || el.hasAttribute("aria-sort") || el.querySelector("[class*=sort]"))
    .map(label);
  const searchInputs = [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')]
    .filter(inShell)
    .filter(visible)
    .filter((el) => /search|ticker|symbol|find/i.test(`${el.placeholder ?? ""} ${el.getAttribute("aria-label") ?? ""}`))
    .map((el) => el.placeholder || el.getAttribute("aria-label") || "search");
  const selects = [...document.querySelectorAll("select")].filter(inShell).filter(visible).map(label);
  const switches = [...document.querySelectorAll('[role=switch], input[type=checkbox]')].filter(inShell).filter(visible).map(label);
  const buttons = [...document.querySelectorAll("button, [role=button]")]
    .filter(inShell)
    .filter(visible)
    .filter((el) => !el.disabled)
    .map(label);
  return { tabs, sortHeaders, searchInputs, selects, switches, buttons };
};

const CONTENT_FINGERPRINT = () => {
  const panel = document.querySelector('[role=tabpanel]') ?? document.querySelector("main") ?? document.body;
  return (panel.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
};

/**
 * Active-tab count WITHIN one tablist, not the whole page. A page can legitimately carry more than
 * one independent `[role=tab]` group (Thermal's Matrix/Gamma-Profile/Forced-Flow view switcher AND
 * its separate GEX/VEX/DEX/CHARM lens switcher, confirmed live 2026-08-23 — 7 total [role=tab]
 * elements, one active in each of the two groups). A GLOBAL count reads that healthy state as "2
 * tabs active" and reports a false defect. Scope to the tablist ancestor (or, lacking one, the
 * clicked tab's own parent) so each group is judged independently.
 */
const ACTIVE_TAB_COUNT_IN_SCOPE = (tabEl) => {
  const scope = tabEl.closest('[role=tablist]') ?? tabEl.parentElement ?? document;
  return scope.querySelectorAll('[role=tab][aria-selected="true"], [role=tab].active, [role=tab][data-state=active]').length;
};

const OVERFLOW = () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

async function testTabs(page, route, vpName) {
  let tested = 0;
  for (let i = 0; i < 12; i++) {
    const handles = await page.$$('[role=tab]');
    const h = handles[i];
    if (!h) break;
    const meta = await h
      .evaluate((el) => ({
        inShell: !el.closest("header, nav, [role=navigation], footer"),
        visible: el.getBoundingClientRect().width > 2,
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
        wasActive: el.getAttribute("aria-selected") === "true" || el.classList.contains("active") || el.getAttribute("data-state") === "active",
      }))
      .catch(() => null);
    if (!meta || !meta.inShell || !meta.visible) continue;
    const before = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    await h.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1300);
    tested++;
    // Poll for a DIFFERENT fingerprint rather than reading once — same rationale as the active-tab
    // poll below: a route that client-navigates (router.replace) on a tab switch can still be
    // settling at a fixed 1300ms mark on a loaded proxy.
    let after = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    for (let poll = 0; poll < 4 && before && after === before; poll++) {
      await page.waitForTimeout(400);
      after = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    }
    // POLL, don't sample once. A one-shot check here produced a false "0 tabs active" on a live
    // pass (2026-08-23) that could not be reproduced across 3 follow-up attempts against the same
    // page/tab — a transient render/proxy race, not a product defect. A same-route client-side
    // navigation (e.g. this app's `router.replace` on view switches) can legitimately leave the DOM
    // in a brief inconsistent state; only report a defect if it is STILL wrong after settling.
    // -1 is this function's OWN catch-fallback, not a DOM reading: `h.evaluate` throws when the
    // clicked tab's node was replaced (not just re-attributed) by the click's re-render — some
    // lens switchers remount their buttons rather than toggling aria-selected in place. That is a
    // stale-handle limitation of this harness, not evidence the DOM is wrong, so it is tracked
    // separately from a genuine "wrong count read successfully" result.
    let activeCount = -1;
    let handleWentStale = false;
    for (let poll = 0; poll < 5; poll++) {
      activeCount = await h.evaluate(ACTIVE_TAB_COUNT_IN_SCOPE).catch(() => {
        handleWentStale = true;
        return -1;
      });
      if (activeCount === 1) break;
      await page.waitForTimeout(400);
    }
    if (handleWentStale && activeCount === -1) {
      record({
        severity: "HARNESS",
        route,
        viewport: vpName,
        where: `tab:${meta.label}`,
        issue: "could not re-verify active state after click — the tab's DOM node was replaced (handle went stale), not evidence of a defect on its own",
      });
    } else if (activeCount !== 1) {
      record({ severity: "P2", route, viewport: vpName, where: `tab:${meta.label}`, issue: `${activeCount} tabs marked active in this tab's own tablist, 3s after click and settling (expected exactly 1)` });
    }
    // A tab that was ALREADY active before the click legitimately re-selecting itself is not a
    // "no content change" defect — re-clicking the current tab is expected to be a no-op. Only
    // flag when the click was a REAL switch (a different tab becoming active) and content still
    // didn't move.
    if (!meta.wasActive && before && after && before === after) {
      record({ severity: "P2", route, viewport: vpName, where: `tab:${meta.label}`, issue: "clicking this (previously inactive) tab produced no observable content change in the panel" });
    }
  }
  return tested;
}

async function testSortHeaders(page, route, vpName) {
  let tested = 0;
  const handles = await page.$$("th");
  for (let i = 0; i < handles.length && tested < 8; i++) {
    const h = handles[i];
    const meta = await h
      .evaluate((el) => ({
        sortable: getComputedStyle(el).cursor === "pointer" || el.hasAttribute("aria-sort") || !!el.querySelector("[class*=sort]"),
        inShell: !el.closest("header, nav, [role=navigation], footer"),
        label: (el.textContent ?? "").trim().slice(0, 30),
      }))
      .catch(() => null);
    if (!meta || !meta.sortable || !meta.inShell) continue;
    const table = await h.evaluateHandle((el) => el.closest("table")).catch(() => null);
    // Fingerprint the whole table body text rather than one column — robust to which column the
    // header actually sorts and to columns whose values don't reorder visibly (a stable secondary
    // sort key, for instance).
    const bodyBefore = table ? await table.evaluate((t) => t.textContent.replace(/\s+/g, " ").slice(0, 500)).catch(() => "") : "";
    await h.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    tested++;
    const bodyAfter = table ? await table.evaluate((t) => t.textContent.replace(/\s+/g, " ").slice(0, 500)).catch(() => "") : "";
    if (table && bodyBefore && bodyAfter && bodyBefore === bodyAfter) {
      record({ severity: "P3", route, viewport: vpName, where: `sort:${meta.label}`, issue: "clicking this sortable-looking column header produced no observable row-order change" });
    }
  }
  return tested;
}

async function testSearch(page, route, vpName) {
  const handles = await page.$$('input[type=text], input[type=search], input:not([type])');
  let tested = 0;
  for (const h of handles) {
    const meta = await h
      .evaluate((el) => ({
        isSearch: /search|ticker|symbol|find/i.test(`${el.placeholder ?? ""} ${el.getAttribute("aria-label") ?? ""}`),
        inShell: !el.closest("header, nav, [role=navigation], footer"),
        visible: el.getBoundingClientRect().width > 2,
      }))
      .catch(() => null);
    if (!meta || !meta.isSearch || !meta.inShell || !meta.visible) continue;
    const query = "SPY";
    const badBefore = [];
    const onResp = (r) => {
      if (r.url().includes("/api/") && r.status() >= 400) badBefore.push(r.status());
    };
    page.on("response", onResp);
    await h.click({ timeout: 8000 }).catch(() => {});
    await h.fill("").catch(() => {});
    await h.type(query, { delay: 30 }).catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(1500);
    page.off("response", onResp);
    tested++;
    const value = await h.inputValue().catch(() => "");
    if (value !== query) {
      // P3, not P2, and explicitly flagged for manual verification. A ticker "search" input can
      // legitimately be an autocomplete/combobox that reverts to the last CONFIRMED symbol when
      // Enter is pressed without selecting a suggestion, rather than accepting arbitrary typed
      // text — that is a different (and correct) interaction model, not a value-retention bug, and
      // this harness cannot yet tell the two apart generically. Confirmed live on /vector: 2
      // back-to-back probes of the same input disagreed on whether it was even present/visible at
      // that moment (a collapsed search-icon trigger, not a plain always-open text field), which is
      // its own evidence this needs a combobox-aware interaction, not a stronger claim of a defect.
      record({
        severity: "P3",
        route,
        viewport: vpName,
        where: "search",
        issue: `typed "${query}" but input now reads "${value}" — could be a real value-retention bug, or a combobox reverting to the last confirmed symbol (this harness cannot yet tell the two apart); verify manually`,
      });
    }
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => "");
    if (!bodyText.toUpperCase().includes(query)) {
      record({ severity: "P3", route, viewport: vpName, where: "search", issue: `searching "${query}" — result content does not visibly mention the query (may be a legitimate no-op if ${query} has no matching data; verify manually)` });
    }
  }
  return tested;
}

async function testSelects(page, route, vpName) {
  const handles = await page.$$("select");
  let tested = 0;
  for (const h of handles) {
    const meta = await h
      .evaluate((el) => ({
        inShell: !el.closest("header, nav, [role=navigation], footer"),
        visible: el.getBoundingClientRect().width > 2,
        label: (el.getAttribute("aria-label") ?? el.name ?? "select").slice(0, 30),
        optionCount: el.options.length,
      }))
      .catch(() => null);
    if (!meta || !meta.inShell || !meta.visible || meta.optionCount < 2) continue;
    const before = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    const beforeVal = await h.inputValue().catch(() => "");
    await h.selectOption({ index: 1 }).catch(() => {});
    await page.waitForTimeout(1500);
    tested++;
    const afterVal = await h.inputValue().catch(() => "");
    // Poll rather than a single read — see testTabs's note on the same class of false positive.
    let after = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    for (let poll = 0; poll < 4 && before && after === before; poll++) {
      await page.waitForTimeout(400);
      after = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    }
    if (afterVal === beforeVal) {
      record({ severity: "P2", route, viewport: vpName, where: `select:${meta.label}`, issue: "changing this dropdown did not change its own value — selection not applied" });
    } else if (before && after && before === after) {
      record({ severity: "P2", route, viewport: vpName, where: `select:${meta.label}`, issue: `changed from "${beforeVal}" to "${afterVal}" but the panel's visible content did not change` });
    }
  }
  return tested;
}

async function testSwitches(page, route, vpName) {
  const handles = await page.$$('[role=switch], input[type=checkbox]');
  let tested = 0;
  for (let i = 0; i < handles.length && tested < 8; i++) {
    const h = handles[i];
    const meta = await h
      .evaluate((el) => ({
        inShell: !el.closest("header, nav, [role=navigation], footer"),
        visible: el.getBoundingClientRect().width > 2,
        label: (el.getAttribute("aria-label") ?? el.closest("label")?.textContent ?? "toggle").trim().slice(0, 30),
      }))
      .catch(() => null);
    if (!meta || !meta.inShell || !meta.visible || DANGEROUS_LABEL.test(meta.label)) continue;
    const before = await h.evaluate((el) => el.getAttribute("aria-checked") ?? el.checked).catch(() => null);
    await h.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    tested++;
    const after = await h.evaluate((el) => el.getAttribute("aria-checked") ?? el.checked).catch(() => null);
    if (before === after) {
      record({ severity: "P2", route, viewport: vpName, where: `toggle:${meta.label}`, issue: "clicking this switch/checkbox did not change its checked state" });
    }
  }
  return tested;
}

/** Bounded, blocklist-filtered pass over remaining buttons — the ones tabs/sort/select/switch didn't already cover. */
async function testButtons(page, route, vpName) {
  let tested = 0;
  for (let i = 0; i < 20; i++) {
    const handles = await page.$$("button, [role=button]");
    const h = handles[i];
    if (!h) break;
    const meta = await h
      .evaluate((el) => ({
        inShell: !el.closest("header, nav, [role=navigation], footer"),
        visible: el.getBoundingClientRect().width > 2,
        disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
        role: el.getAttribute("role"),
      }))
      .catch(() => null);
    if (!meta || !meta.inShell || !meta.visible || meta.disabled || meta.role === "tab" || meta.role === "switch") continue;
    if (!meta.label || DANGEROUS_LABEL.test(meta.label)) continue;
    const urlBefore = page.url();
    const before = await page.evaluate(CONTENT_FINGERPRINT).catch(() => "");
    const errBefore = findings.length;
    await h.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(900);
    tested++;
    const urlAfter = page.url();
    if (urlAfter !== urlBefore) {
      // Navigated away — go back so the rest of the inventory still applies to THIS route.
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      continue;
    }
    // Close anything this opened (modal/drawer) so subsequent buttons aren't tested behind an overlay.
    const dialog = await page.$('[role=dialog], [aria-modal="true"]').catch(() => null);
    if (dialog) {
      const closeBtn = await page.$('[role=dialog] button[aria-label*=close i], [aria-modal="true"] button[aria-label*=close i]').catch(() => null);
      if (closeBtn) await closeBtn.click({ timeout: 4000 }).catch(() => {});
      else await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }
    void before; // reserved: a byte-identical before/after is common for buttons with real but subtle effects (toasts, requests) — not flagged on its own, unlike tabs/selects where a no-op is the whole point of the control.
    void errBefore;
  }
  return tested;
}

async function runDeep() {
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  let session = null;
  try {
    session = await mintClerkPremiumSession({ appUrl: BASE });
    if (session.skip) {
      console.log(`HARNESS SKIP: ${session.reason}`);
      return;
    }
    const { browser, ctx, counts } = await createTunneledContext({
      url: `${BASE}${ROUTE}`,
      cookie: session.cookieHeader,
      viewport: VP.viewport,
      desktop: VP.desktop,
      requestTimeoutMs: 45_000,
    });
    try {
      const page = await ctx.newPage();
      let consoleErrors = [];
      let badResponses = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
      });
      page.on("response", (r) => {
        if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 120)}`);
      });
      // A mid-rollout chunk 404 (ecr-push-production.yml fires on every merge to main, including
      // this lane's own — measured live 2026-08-23, twice, both times racing this exact harness)
      // can make the app SELF-TRIGGER a reload/redirect after `domcontentloaded` already resolved,
      // which page.goto()'s own retry loop above cannot see (goto already succeeded). Track it so
      // the settle-poll below knows to keep waiting, and so pre-reload console noise from the
      // discarded first attempt isn't blamed on the interaction pass that follows.
      let lastNavAt = Date.now();
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) {
          lastNavAt = Date.now();
          consoleErrors = [];
          badResponses = [];
        }
      });

      // Generous retry: this run is precious (one route, several minutes of interaction), so give
      // navigation every reasonable chance rather than the shallow sweep's tighter budget.
      const RETRY_WAITS = [10_000, 25_000, 50_000, 90_000];
      let navigated = false;
      for (let attempt = 0; attempt <= RETRY_WAITS.length && !navigated; attempt++) {
        try {
          await page.goto(`${BASE}${ROUTE}`, { waitUntil: "domcontentloaded", timeout: 70_000 });
          navigated = true;
        } catch (err) {
          if (attempt === RETRY_WAITS.length) {
            record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "nav", issue: `navigation failed ${attempt + 1}x — ${String(err?.message ?? err).slice(0, 140)}` });
          } else {
            await page.waitForTimeout(RETRY_WAITS[attempt]);
          }
        }
      }
      if (!navigated) {
        console.log(`  routed: ${JSON.stringify(counts)}`);
        return;
      }

      // SETTLE, don't just wait a fixed beat. A live pass caught two real cases (2026-08-23) where
      // a fixed 4s wait landed mid self-triggered reload from a mid-rollout chunk error — the
      // inventory then read 0 interactive elements and 0 findings on a page that, once actually
      // settled, was fully populated (SPY price, GEX/VEX/DEX/CHARM lenses, wall levels — a normal
      // Thermal render). That is a FALSE CLEAN, worse than a false positive: "0 findings" reads as
      // "tested and fine" when it was never actually looked at. Poll for real content, and restart
      // the clock on every self-triggered navigation so a recovery reload gets its own full window
      // rather than inheriting whatever was left of the first one.
      const SETTLE_DEADLINE_MS = 45_000;
      const settleStart = Date.now();
      let settled = false;
      while (Date.now() - settleStart < SETTLE_DEADLINE_MS) {
        const sinceNav = Date.now() - lastNavAt;
        if (sinceNav < 2500) {
          await page.waitForTimeout(2500 - sinceNav);
          continue;
        }
        // Scoped OUTSIDE header/nav/footer, matching INVENTORY's own inShell filter — the shared
        // site chrome (nav links, the "Open desk" button) is present within ~1s on EVERY route and
        // satisfies "interactive > 0" trivially, so an unscoped probe reports "settled" before the
        // actual product panel has loaded at all. Caught live on /vector (2026-08-23): screenshot
        // still read "LOADING VECTOR" after the full interaction pass, while a direct patient probe
        // showed the real panel (chart, GEX/VEX/0DTE tabs, indicators, live tape) fully up at 6s —
        // well inside this deadline. The unscoped probe had already declared victory on nav alone.
        // Interactive-element count ONLY — no text-length fallback. A textLen>200 fallback (tried
        // first) passed on /vector at t=4s while the product was still showing its "LOADING VECTOR"
        // splash and INVENTORY (same shell-exclusion shape, checked moments later) found 0 controls:
        // persistent non-footer-tagged boilerplate (disclaimers, copy outside header/nav/<footer>)
        // is long enough on its own to clear 200 characters before any product content exists. Every
        // product route in this fleet has substantial interactive chrome once it actually mounts
        // (confirmed live: Thermal 33 buttons, Vector dozens once loaded, Night Hawk 8), so requiring
        // a real control is the reliable signal; a genuinely control-less page times out to HARNESS
        // below rather than being misread as settled.
        const probe = await page
          .evaluate(() => {
            const inShell = (el) => !el.closest("header, nav, [role=navigation], footer");
            const interactive = [...document.querySelectorAll("button, [role=tab], select, [role=switch]")].filter(inShell).length;
            return { ready: document.readyState === "complete", interactive };
          })
          .catch(() => null);
        if (probe && probe.ready && probe.interactive > 0) {
          settled = true;
          break;
        }
        await page.waitForTimeout(1500);
      }
      console.log(`  settle: ${settled ? "OK" : "TIMED OUT"} after ${Math.round((Date.now() - settleStart) / 1000)}s`);
      if (!settled) {
        record({
          severity: "HARNESS",
          route: ROUTE,
          viewport: VP_NAME,
          where: "settle",
          issue: `page never showed meaningful content/interactive elements within ${SETTLE_DEADLINE_MS / 1000}s of navigating — inventory below may be a false empty, not a verified-clean page`,
        });
      }

      const inv = await page.evaluate(INVENTORY).catch(() => null);
      if (!inv) {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "inventory", issue: "inventory probe did not execute" });
      } else {
        console.log(
          `  inventory: ${inv.tabs.length} tabs, ${inv.sortHeaders.length} sort headers, ${inv.searchInputs.length} search inputs, ${inv.selects.length} selects, ${inv.switches.length} switches, ${inv.buttons.length} buttons`
        );
      }

      const tabsTested = await testTabs(page, ROUTE, VP_NAME).catch((e) => {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "tabs", issue: `tab sweep threw: ${String(e?.message ?? e).slice(0, 140)}` });
        return 0;
      });
      const sortTested = await testSortHeaders(page, ROUTE, VP_NAME).catch((e) => {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "sort", issue: `sort sweep threw: ${String(e?.message ?? e).slice(0, 140)}` });
        return 0;
      });
      const searchTested = await testSearch(page, ROUTE, VP_NAME).catch((e) => {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "search", issue: `search sweep threw: ${String(e?.message ?? e).slice(0, 140)}` });
        return 0;
      });
      const selectsTested = await testSelects(page, ROUTE, VP_NAME).catch((e) => {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "selects", issue: `select sweep threw: ${String(e?.message ?? e).slice(0, 140)}` });
        return 0;
      });
      const switchesTested = await testSwitches(page, ROUTE, VP_NAME).catch((e) => {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "switches", issue: `switch sweep threw: ${String(e?.message ?? e).slice(0, 140)}` });
        return 0;
      });
      const buttonsTested = await testButtons(page, ROUTE, VP_NAME).catch((e) => {
        record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "buttons", issue: `button sweep threw: ${String(e?.message ?? e).slice(0, 140)}` });
        return 0;
      });

      console.log(
        `  tested: ${tabsTested} tabs, ${sortTested} sort headers, ${searchTested} search boxes, ${selectsTested} selects, ${switchesTested} switches, ${buttonsTested} buttons`
      );

      const overflow = await page.evaluate(OVERFLOW).catch(() => undefined);
      if (overflow === true) record({ severity: "P2", route: ROUTE, viewport: VP_NAME, where: "layout", issue: "page scrolls horizontally after the interaction pass" });

      await page.screenshot({ path: path.join(OUT, `${ROUTE.replace(/\//g, "_") || "root"}-${VP_NAME}-final.png`), fullPage: VP_NAME !== "mobile" }).catch(() => {});

      if (badResponses.length > 0) {
        const auth = badResponses.filter((b) => /^(401|403)\b/.test(b));
        const other = badResponses.filter((b) => !/^(401|403)\b/.test(b));
        if (auth.length) record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "auth", issue: `${auth.length} auth failures (401/403) — session lost mid-run, not a product verdict`, sample: auth.slice(0, 3) });
        if (other.length) record({ severity: "P2", route: ROUTE, viewport: VP_NAME, where: "network", issue: `${other.length} failed requests during the interaction pass`, sample: other.slice(0, 8) });
      }
      if (consoleErrors.length > 0) {
        const authCount = badResponses.filter((b) => /^(401|403)\b/.test(b)).length;
        const { product, authEcho } = splitConsoleErrors(consoleErrors, authCount);
        if (product.length > 0) record({ severity: "P2", route: ROUTE, viewport: VP_NAME, where: "console", issue: `${product.length} console errors during the interaction pass`, sample: product.slice(0, 6) });
        if (authEcho.length > 0) record({ severity: "HARNESS", route: ROUTE, viewport: VP_NAME, where: "console", issue: `${authEcho.length} console errors echo this run's own 401/403 — not a product verdict` });
      }
      console.log(`  routed: ${JSON.stringify(counts)}`);
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    if (session && typeof session.cleanup === "function") await session.cleanup().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  await runDeep();
  for (const f of findings) console.log(" ", JSON.stringify(f));
  try {
    fs.writeFileSync(path.join(OUT, `findings-${ROUTE.replace(/\//g, "_") || "root"}-${VP_NAME}.json`), JSON.stringify({ base: BASE, route: ROUTE, viewport: VP_NAME, findings }, null, 2), { mode: 0o600 });
  } catch (e) {
    console.log(`  (could not persist findings: ${String(e?.message ?? e).slice(0, 120)})`);
  }
  const bySev = (s) => findings.filter((f) => f.severity === s);
  console.log(`\n${bySev("P0").length} P0 · ${bySev("P1").length} P1 · ${bySev("P2").length} P2 · ${bySev("P3").length} P3 · ${bySev("HARNESS").length} HARNESS`);
  process.exitCode = bySev("P0").length + bySev("P1").length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
