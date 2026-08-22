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
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");
import { splitOverFetches } from "./lib/expected-poll-count.mjs";
import { NAV_ATTEMPTS, navRetryWaitMs, viewportCooldownMs } from "./lib/proxy-saturation.mjs";
import {
  EARNINGS_ROW_BASE,
  describeCohort,
  earningsRowSelector,
  normalizeMinImpact,
  splitAuthFailures,
} from "./lib/meridian-earnings-cohort.mjs";
import { splitConsoleErrors } from "./lib/console-error-triage.mjs";

/**
 * How long to wait for the Meridian surface to MOUNT, as opposed to how long to wait for a
 * request. Raising `requestTimeoutMs` fixed the transport half and the audit then bailed one step
 * later, at `waitForSelector`, with every request having succeeded:
 *
 *   routed: {"ok":217,"fail":0}   [HARNESS] mobile/timeline — earnings tab bar never appeared
 *
 * Three passes on 2026-08-21 died that way (desktop and tablet ~12:25, mobile 12:48). The event
 * detail is genuinely slow to mount on a cold cache — one click fans out to `preEarningsPackForLargo`,
 * a GEX heatmap fetch, fundamentals, vector EM and dark pool — and the 20-30s literals were under
 * it. These numbers are the ones a probe driving the same page in the same window used while
 * reaching the panels cleanly every time, not guesses.
 *
 * A deadline that is too SHORT costs an entire pass and reports nothing; one that is too long
 * costs a slow run on a genuinely broken page. Those are not symmetric, so these lean long.
 */
const MOUNT_DEADLINE_MS = {
  /** The desk shell. Already generous and never the one that failed. */
  desk: 45_000,
  /** Timeline rows, and the event detail that a row click mounts. */
  timeline: 90_000,
  detail: 90_000,
  /** The cohort row, once the timeline itself is up — a filter over rows already rendered. */
  cohortRow: 60_000,
  /** After a reload, on a warm cache. */
  afterReload: 60_000,
};

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

/**
 * How the parent hands a child its session. ENV, not argv — argv shows up in a process listing and
 * the value is a live `__session` JWT.
 */
const COOKIE_ENV = "MERIDIAN_IX_SESSION_COOKIE";
const IS_CHILD = Boolean(process.env[COOKIE_ENV]);

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
  // CLIPPED, as opposed to CAPPED.
  //
  // Text cut off by its own container is only a defect when the reader cannot get it back. The
  // Meridian orbital rim is the counter-example this exclusion exists for: `.ms-orb-label` sets
  // `max-width: 84px; overflow: hidden; text-overflow: ellipsis` ON PURPOSE, so a long pillar name
  // cannot shove into its neighbour's slot on a crowded rim — and the full string is carried on the
  // parent button's `title` AND `aria-label`, with `.ms-orb:hover` restoring it in place. Four
  // labels ("Vector expected move", "Street / analysts", "News & catalysts", "Insider activity")
  // were reported as clipped on every single run, on a panel that is behaving exactly as designed.
  //
  // That is a standing false positive, and this file's own header says why that matters: a check
  // which fires on healthy pages teaches its reader to skip the report. So the rule is narrowed,
  // not relaxed — text still clipped with NO way to recover it is still reported, which is the
  // case that actually costs a member something.
  const clipped = boxes
    .filter(({ el }) => {
      if (!(el.scrollWidth > el.clientWidth + 1)) return false;
      if (getComputedStyle(el).overflow === "visible") return false;
      const full = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!full) return false;
      // Recoverable if the element or any ancestor spells the full text out in a title or an
      // accessible name. Deliberately an ANCESTOR walk: the label is capped but the control that
      // owns it is what carries the name, which is where a reader (or a screen reader) finds it.
      for (let p = el; p && p !== document.body; p = p.parentElement) {
        const carried = `${p.getAttribute("title") ?? ""} ${p.getAttribute("aria-label") ?? ""}`
          .replace(/\s+/g, " ");
        if (carried.includes(full)) return false;
      }
      return true;
    })
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
  // THE LAST VIEWPORT WAS NEVER AUDITED — the agent proxy saturates after two passes and refuses
  // new CONNECTs, so mobile (where the rail defects live) died on its first navigation every full
  // run. One flat 12s retry was not enough to outlast it. See lib/proxy-saturation.mjs for the
  // measurement and for why the waits back off instead of getting longer.
  let navigated = false;
  for (let attempt = 0; attempt < NAV_ATTEMPTS && !navigated; attempt += 1) {
    try {
      await goto();
      navigated = true;
    } catch (err) {
      const wait = navRetryWaitMs(attempt);
      if (wait == null) {
        // Out of attempts. Report it as HARNESS — this viewport was NOT audited, and a run that
        // could not look must never read as a run that looked and found nothing.
        record({
          severity: "HARNESS",
          viewport: vp,
          where: "run",
          issue: `navigation failed ${attempt + 1}x — ${String(err?.message ?? err).slice(0, 120)}`,
        });
        return false;
      }
      await page.waitForTimeout(wait);
    }
  }
  if (!(await page.waitForSelector(".meridian-desk", { timeout: MOUNT_DEADLINE_MS.desk }).catch(() => null))) {
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
  const timelineUp = await page.waitForSelector(EARNINGS_ROW_BASE, { timeout: MOUNT_DEADLINE_MS.timeline }).catch(() => null);
  if (!timelineUp) {
    record({ severity: "HARNESS", viewport: vp, where: "timeline", issue: "no earnings row on the timeline at all" });
    return false;
  }
  const row = await page.waitForSelector(ROW_SELECTOR, { timeout: MOUNT_DEADLINE_MS.cohortRow }).catch(() => null);
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
  if (!(await page.waitForSelector(".meridian-earnings-tab", { timeout: MOUNT_DEADLINE_MS.detail }).catch(() => null))) {
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
        const survived = await page.waitForSelector(".meridian-earnings-tab", { timeout: MOUNT_DEADLINE_MS.afterReload }).catch(() => null);
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

/**
 * Run ONE viewport in this process, using a cookie the parent already minted.
 *
 * Children never mint and never clean up: Clerk FAPI rate-limits rapid sign-in cycles, so a run
 * authenticates ONCE, and the temp user belongs to the parent's `finally`. A child that deleted it
 * would pull the session out from under its siblings — the documented shared-identity failure that
 * produced 401 storms mis-read as product faults.
 */
async function runChildViewport() {
  const cookie = process.env[COOKIE_ENV] ?? "";
  if (!cookie) {
    record({ severity: "HARNESS", viewport: ONLY ?? "?", where: "run", issue: "child started with no session cookie" });
    return;
  }
  const vp = VIEWPORTS[0];
  console.log(`\n── ${vp.name} (${vp.viewport}) ──`);
  const r = await auditViewport(vp, cookie);
  console.log(`  routed: ${JSON.stringify(r.counts)}`);
}

/**
 * Fan the viewports out over CHILD PROCESSES, one each.
 *
 * WHAT THIS DOES AND DOES NOT DO. It does NOT cure the proxy-tunnel saturation. That was the
 * hypothesis and it was FALSIFIED — see the measurements below, kept because a wrong idea that
 * looks obvious deserves a headstone rather than a quiet deletion.
 *
 *   in-process loop, 2026-08-22   desktop 185 tunnels ok · tablet 141 ok · mobile DEAD
 *                                 (4 navigations, ~98s of #2606 backoff, all ERR_CONNECTION_RESET,
 *                                 while the proxy's `recentRelayFailures` stayed EMPTY — the
 *                                 saturation signature, not a failure signature)
 *   mobile run alone              clean, 239 tunnels
 *   desktop then mobile, two      237 then 273, both clean
 *     separate invocations
 *   ---> so: "the budget is per-PROCESS, a fresh process resets it"
 *   child-process fan-out          desktop 224 ok · tablet DEAD at 9 tunnels · mobile DEAD at 9
 *   ---> hypothesis dead. A fresh child does NOT reset it, and the two-invocation comparison that
 *        suggested it was confounded: those runs also differed in elapsed time and each minted its
 *        own session, so the process boundary was never the isolated variable.
 *
 * The controlling variable is still UNKNOWN. Do not add another cooldown on a hunch.
 *
 * What the fan-out IS worth keeping for is the second half of the original problem, which is not
 * flakiness but a SILENT BLIND SPOT. The loop sacrificed whichever viewport ran last, and mobile is
 * always last, so a starved viewport was reported as "no findings" rather than "never looked" —
 * the absence-as-evidence trap this harness exists to prevent, sitting inside the harness. A child
 * that dies now lands as HARNESS against its own viewport, which is exactly how the run above
 * reported tablet and mobile instead of implying they were clean.
 */
async function runParent(session) {
  const { spawnSync } = await import("node:child_process");
  const self = fileURLToPath(import.meta.url);
  for (const [idx, vp] of VIEWPORTS.entries()) {
    // Still cooled, though a fresh process no longer NEEDS it — the proxy is shared with whatever
    // else the lane is running, and half a minute is cheap next to a pass that cannot run.
    const cooldown = viewportCooldownMs(idx);
    if (cooldown > 0) await new Promise((r) => setTimeout(r, cooldown));
    const res = spawnSync(
      process.execPath,
      [self, `--viewport=${vp.name}`, `--base=${BASE}`, `--out=${OUT}`, `--min-impact=${MIN_IMPACT}`],
      {
        // The cookie goes through the ENVIRONMENT, never argv: argv is world-readable in a process
        // listing, and a `__session` JWT is a live credential.
        env: { ...process.env, [COOKIE_ENV]: session.cookieHeader },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      }
    );
    const out = `${res.stdout ?? ""}`;
    // Echo the child's LIVE lines but not its JSON findings — those are re-printed once, by the
    // parent's rollup, so forwarding them here would double every finding in the report.
    process.stdout.write(
      out
        .split("\n")
        .filter((l) => {
          const t = l.trim();
          return !(t.startsWith("{") && t.includes('"severity"'));
        })
        .join("\n")
    );
    if (res.stderr) process.stderr.write(res.stderr);
    // Re-collect the child's findings so the rollup and the exit code cover every viewport. A child
    // that died before printing any is a HARNESS condition, never a clean viewport.
    const parsed = parseChildFindings(out);
    if (parsed.length === 0 && res.status !== 0) {
      findings.push({
        severity: "HARNESS",
        viewport: vp.name,
        where: "run",
        issue: `child exited ${res.status ?? "signal " + res.signal} with no findings — viewport NOT judged`,
      });
    }
    findings.push(...parsed);
  }
}

/** Findings a child printed as one JSON object per line in its rollup. */
function parseChildFindings(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.includes('"severity"')) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o.severity === "string") out.push(o);
    } catch {
      // A truncated line is not a finding and must not be invented into one.
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  if (process.env[COOKIE_ENV]) {
    await runChildViewport();
  } else {
    const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
    let session = null;
    try {
      session = await mintClerkPremiumSession({ appUrl: BASE });
      if (session.skip) {
        console.log(`HARNESS SKIP: ${session.reason}`);
        return;
      }
      await runParent(session);
    } finally {
      if (session && typeof session.cleanup === "function") await session.cleanup().catch(() => {});
    }
  }

  const bySev = (s) => findings.filter((f) => f.severity === s);
  // A child emits ONLY the machine-readable lines; the parent owns the human rollup, so the run
  // ends with one report covering every viewport rather than one per process.
  if (IS_CHILD) {
    for (const f of findings) console.log(" ", JSON.stringify(f));
    process.exitCode = bySev("P2").length > 0 ? 1 : 0;
    return;
  }
  console.log("\nMERIDIAN INTERACTION AUDIT\n");
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
