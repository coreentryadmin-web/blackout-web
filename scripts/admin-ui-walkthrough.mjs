#!/usr/bin/env node
/**
 * Admin UI walkthrough — real headless-Chromium walk of the LIVE, AUTHENTICATED desk.
 *
 * The public-only sibling is scripts/desktop-ui-e2e.mjs; this is its AUTHENTICATED superset:
 * it mints a temp admin+premium Clerk user, applies that session's cookies to a normal DESKTOP
 * context (1440×900 — NOT the iOS device/UA the ios-*-e2e suites use), then navigates every
 * signed-in desk page, toggles the new Vector chart layers + intel-rail / board controls, and
 * full-page-screenshots each step so the operator (and, via the uploaded artifacts, the agent —
 * whose sandbox browser is blocked from prod) gets real rendered pixels of the authed UI on demand.
 *
 * Runs on a GitHub Actions runner (real egress to prod). NOT runnable from the agent sandbox
 * (Chromium egress is reset — proven net::ERR_CONNECTION_RESET); the workflow is the only entry.
 *
 *   VALIDATE_BASE=https://blackouttrades.com node scripts/admin-ui-walkthrough.mjs
 * Output: $ADMIN_WALKTHROUGH_DIR (default ./artifacts/admin-ui-walkthrough): *.png + report.json
 *
 * Auth secrets (env, read by mintIosPlaywrightSession): CLERK_SECRET_KEY,
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. The temp admin user is DELETED in the finally (cleanup()).
 * Never prints secrets. Exits non-zero only on a HARD failure (auth mint failed / every page
 * errored); a single missing control is a logged note, not a failure.
 *
 * ── Hardening (2026-07-26) ────────────────────────────────────────────────────────────────────
 * A prior CI run passed the job but its interactions failed: the Vector indicator-menu / intel-rail
 * clicks timed out at 8s and "notfound" was reported without saying WHY. Root causes + the fixes
 * baked in here:
 *   (a) Waits too short. The Vector chart is a `dynamic(ssr:false)` lightweight-charts import
 *       (VectorPageShell renders "Loading chart…" until it mounts). Over a cold CI→prod link the
 *       mount can take far more than 8s, and the indicator TRIGGER only exists once the chart is
 *       mounted. Fix: before touching the menu we wait up to CHART_MOUNT_MS (45s) for the trigger
 *       to be VISIBLE (its presence == chart mounted), and per-interaction clicks now allow 15s.
 *   (b) No page-STATE detection. A missing control could mean chart-still-loading, premium-gated,
 *       launch-gated, or genuinely-empty (off-hours Night Hawk board) — indistinguishable from a
 *       real bug. Fix: detectPageState() reads the rendered DOM/text and records {route, state} so
 *       every "notfound" is explained. A premium gate is surfaced PROMINENTLY (it means the temp
 *       admin's tier didn't resolve to premium/admin — itself a finding).
 *   (c) No runtime-bug capture. Fix: every page's console errors, uncaught exceptions, failed
 *       requests and >=400 responses are collected (benign analytics/beacon tagged, not dropped)
 *       and rolled into per-page bug counts in report.json — the actual UI-bug signal.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.ADMIN_WALKTHROUGH_DIR || "./artifacts/admin-ui-walkthrough";
mkdirSync(OUT, { recursive: true });

// Timeouts — deliberately generous. The job has time (workflow timeout bumped to 20m); a slow
// cold-start chart mount over the CI→prod link must not be misread as a missing control.
const CHART_MOUNT_MS = 45_000; // wait for the indicator trigger (== chart mounted) before the menu
const CLICK_MS = 15_000; // per-interaction click timeout (was 8s → timed out on cold mounts)

/** Authenticated desk pages to walk (order matters — screenshots are prefixed by index). */
const PAGES = [
  { path: "/nighthawk", slug: "nighthawk" },
  { path: "/dashboard", slug: "dashboard" },
  { path: "/vector", slug: "vector" },
  { path: "/vector?ticker=SPX", slug: "vector-spx" },
];

// Chart pages carry the Vector indicator trigger once the lightweight-charts bundle mounts.
const CHART_SLUGS = new Set(["vector", "vector-spx", "dashboard"]);

const report = {
  base: BASE,
  at: new Date().toISOString(),
  pages: [],
  states: [], // [{ route, state, detail }] — WHY a control was/ wasn't reachable
  actions: [],
  consoleErrors: {}, // { path: [{ text, location }] }
  pageErrors: {}, // { path: [text] } — uncaught exceptions
  failedRequests: {}, // { path: [{ url, status|failure, benign }] }
  bugCounts: {}, // { path: { consoleErrors, pageErrors, failedRequests, benignRequests } }
};

/** Record a per-page interaction outcome (found / clicked / notfound / error) — never throws. */
function note(page, action, status, detail = "") {
  report.actions.push({ page, action, status, detail: String(detail).slice(0, 200) });
  console.log(`    [${status}] ${page} · ${action}${detail ? ` — ${String(detail).slice(0, 120)}` : ""}`);
}

/** Record the detected render-state for a route so a missing control is explained, not silent. */
function noteState(route, state, detail = "") {
  report.states.push({ route, state, detail: String(detail).slice(0, 200) });
  const loud = state === "premium-gate" ? "  ⚠️ " : "  · ";
  console.log(`${loud}state[${route}] = ${state}${detail ? ` (${detail})` : ""}`);
}

let shotSeq = 0;
async function shot(page, name) {
  const file = `${String(shotSeq++).padStart(2, "0")}-${name}.png`;
  try {
    await page.screenshot({ path: join(OUT, file), fullPage: true });
  } catch (e) {
    // A mid-animation capture can race the layout; fall back to a viewport shot so the step is
    // still evidenced rather than lost.
    await page.screenshot({ path: join(OUT, file), fullPage: false }).catch(() => {});
    note("_shot", name, "warn", `fullPage capture failed: ${e.message}`);
  }
  return file;
}

/** Click the first visible match of `locator`, screenshot after; log found/clicked/notfound. */
async function tryClick(pageKey, action, locator, page, screenshotName) {
  try {
    const el = locator.first();
    if (!(await el.isVisible().catch(() => false))) {
      note(pageKey, action, "notfound");
      return false;
    }
    await el.click({ timeout: CLICK_MS });
    await page.waitForTimeout(700);
    if (screenshotName) await shot(page, screenshotName);
    note(pageKey, action, "clicked");
    return true;
  } catch (e) {
    note(pageKey, action, "error", e.message);
    return false;
  }
}

/**
 * Detect the rendered state of a desk page so a missing control is EXPLAINED, not silently
 * "notfound". Returns a coarse state label and records it. Checks are ordered most-specific-first.
 * All text/selectors verified against source:
 *   - "Premium membership required" — SpxDashboard EmptyState (tier didn't resolve to premium/admin).
 *   - .spx-sniper-desk-loading — SpxDashboard desk-loading placeholder (deskLoading && !desk).
 *   - "Loading chart…" — VectorPageShell dynamic(ssr:false) chart still importing.
 *   - "launching soon" — SpxDashboard "Vector chart launching soon" embed gate (not enabled).
 */
async function detectPageState(page, slug) {
  const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
  const has = (sel) => page.locator(sel).first().isVisible().catch(() => false);

  if (/Premium membership required/i.test(bodyText)) {
    noteState(slug, "premium-gate", "temp admin tier did NOT resolve to premium/admin — surface this");
    return "premium-gate";
  }
  if (await has(".spx-sniper-desk-loading")) {
    noteState(slug, "desk-loading", "SpxDashboard placeholder (deskLoading && !desk)");
    return "desk-loading";
  }
  if (/launching soon/i.test(bodyText)) {
    noteState(slug, "vector-launch-gate", "Vector embed not enabled for this account");
    return "vector-launch-gate";
  }
  if (/Loading chart…|Loading chart\.\.\./i.test(bodyText)) {
    noteState(slug, "chart-loading", "lightweight-charts bundle still mounting");
    return "chart-loading";
  }
  if (slug === "nighthawk") {
    // Night Hawk off-hours: no board briefing tabs and no play terminal mounted == expected-empty,
    // NOT a bug. Label it so the missing board controls read as expected, not as a failure.
    const hasTabs = await page.getByRole("tab").first().isVisible().catch(() => false);
    const hasDeck = await has(".nh-deck-tabs");
    if (!hasTabs && !hasDeck) {
      noteState(slug, "nighthawk-empty-board", "off-hours: no briefing tabs / no play terminal (expected)");
      return "nighthawk-empty-board";
    }
  }
  noteState(slug, "ready");
  return "ready";
}

/**
 * Wait for the Vector chart to MOUNT on a chart page. The indicator trigger
 * (data-testid="vector-indicator-trigger") only exists once the dynamic(ssr:false) lightweight-
 * charts bundle has mounted, so its visibility is our mount signal. Generous (CHART_MOUNT_MS) so a
 * cold CI→prod start isn't misread as a missing chart. Returns true if the trigger became visible.
 */
async function waitForChartMount(page, slug) {
  try {
    await page.locator('[data-testid="vector-indicator-trigger"]').first().waitFor({
      state: "visible",
      timeout: CHART_MOUNT_MS,
    });
    note(slug, "chart:mount", "found", "indicator trigger visible");
    return true;
  } catch {
    note(slug, "chart:mount", "notfound", `trigger not visible within ${CHART_MOUNT_MS}ms (see page state)`);
    return false;
  }
}

/**
 * Vector chart layer walk — open the indicator menu (the `Indicators` trigger carries
 * data-testid="vector-indicator-trigger"), screenshot the open menu (all toggles visible), then
 * enable each NEW positioning/expected-move layer by its menu label and screenshot the chart after
 * each. Menu items are role="menuitemcheckbox" whose text is the label from vector-indicators-config
 * (VECTOR_INDICATOR_GROUPS). Labels are matched by substring so a copy tweak (e.g. the "(long /
 * short γ zones)" suffix) doesn't silently break the walk; each toggle is independent and try/catch'd.
 */
async function walkVectorChart(page, pageKey) {
  const trigger = page.locator('[data-testid="vector-indicator-trigger"]');
  // Chart-mount gate FIRST — do not attempt the menu until the trigger is visible (== mounted).
  if (!(await waitForChartMount(page, pageKey))) {
    note(pageKey, "vector:indicator-menu", "notfound", "chart never mounted (indicator trigger absent)");
    return;
  }
  const opened = await tryClick(pageKey, "vector:open-indicator-menu", trigger, page, `${pageKey}-indicators-menu-open`);
  if (!opened) return;

  // New layers to enable, matched by a label substring present in VECTOR_INDICATOR_GROUPS.
  // "Expected move" is the ±1σ/2σ band / time-converging cone (#1126); "Gamma regime" is the
  // long/short-γ boundary glow. Any additional cone-labelled toggle is attempted too, harmlessly
  // skipped as notfound if the shipped menu folds the cone into the single Expected-move toggle.
  const layers = [
    { action: "vector:enable-gamma-regime", label: "Gamma regime", shot: `${pageKey}-layer-gamma-regime` },
    { action: "vector:enable-expected-move", label: "Expected move", shot: `${pageKey}-layer-expected-move` },
    { action: "vector:enable-em-cone", label: "cone", shot: `${pageKey}-layer-em-cone` },
  ];
  for (const layer of layers) {
    // Re-assert the menu is open (enabling a toggle keeps it open, but an outside click during a
    // screenshot could have closed it) before targeting the next item.
    if (!(await page.locator(".vector-ind-panel").first().isVisible().catch(() => false))) {
      await tryClick(pageKey, "vector:reopen-indicator-menu", trigger, page, null);
    }
    const item = page.getByRole("menuitemcheckbox", { name: new RegExp(layer.label, "i") });
    if (!(await item.first().isVisible().catch(() => false))) {
      note(pageKey, layer.action, "notfound", `no toggle labelled ~"${layer.label}"`);
      continue;
    }
    // Skip if already checked (gex-heatmap defaults on; these default off, but be defensive).
    const already = (await item.first().getAttribute("aria-checked").catch(() => null)) === "true";
    if (already) {
      note(pageKey, layer.action, "found", "already enabled");
      await shot(page, layer.shot);
      continue;
    }
    await tryClick(pageKey, layer.action, item, page, layer.shot);
  }

  // Close the menu so the final chart capture shows the layers on the tape without the panel over it.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, `${pageKey}-chart-layers-on`);
}

/** SpxIntelRail Pulse ⇄ Largo toggle (role=tab, "⚡ Pulse" / "Largo") + a Pulse "→ chart" jump. */
async function walkIntelRail(page, pageKey) {
  const pulse = page.getByRole("tab", { name: /Pulse/i });
  const largo = page.getByRole("tab", { name: /^Largo$/i });
  if (!(await pulse.first().isVisible().catch(() => false)) && !(await largo.first().isVisible().catch(() => false))) {
    note(pageKey, "intel:pulse-largo-toggle", "notfound", "intel rail toggle not present");
    return;
  }
  await tryClick(pageKey, "intel:select-pulse", pulse, page, `${pageKey}-intel-pulse`);
  await tryClick(pageKey, "intel:select-largo", largo, page, `${pageKey}-intel-largo`);
  // Back to Pulse, then jump a Pulse row to the chart if the "→ chart" control exists.
  await tryClick(pageKey, "intel:reselect-pulse", pulse, page, null);
  const jump = page.getByRole("button", { name: /Jump to chart/i });
  await tryClick(pageKey, "intel:pulse-jump-to-chart", jump, page, `${pageKey}-intel-pulse-jump`);
}

/** Night Hawk board status tabs + play terminal Thesis/Management/PnL tabs (best-effort). */
async function walkNighthawk(page, pageKey, state) {
  if (state === "nighthawk-empty-board") {
    // Off-hours empty board — no briefing tabs / terminal to click. Recorded as expected, not a
    // failure, so the absence of board controls below reads correctly in the report.
    note(pageKey, "board:tabs", "notfound", "expected-empty board (off-hours) — no controls to walk");
    return;
  }
  // Board status tabs (open / watch / closed) if the board exposes them as tab/segment controls.
  for (const label of ["Open", "Watch", "Closed"]) {
    const tab = page.getByRole("tab", { name: new RegExp(`^${label}$`, "i") });
    await tryClick(pageKey, `board:tab-${label.toLowerCase()}`, tab, page, `${pageKey}-board-${label.toLowerCase()}`);
  }
  // Native segment fallback (ios-native-segment-btn) for the Night's Watch / Playbook split.
  for (const label of ["Night's Watch", "Playbook"]) {
    const seg = page.locator(".ios-native-segment-btn", { hasText: label });
    await tryClick(pageKey, `board:segment-${label.replace(/\W+/g, "-").toLowerCase()}`, seg, page, null);
  }
  // Play terminal tabs (nh-deck-tabs buttons: Thesis / Management / PnL) if a terminal is mounted.
  const deck = page.locator(".nh-deck-tabs");
  if (await deck.first().isVisible().catch(() => false)) {
    for (const label of ["Thesis", "Management", "PnL"]) {
      const btn = page.locator(".nh-deck-tabs button", { hasText: label });
      await tryClick(pageKey, `terminal:tab-${label.toLowerCase()}`, btn, page, `${pageKey}-terminal-${label.toLowerCase()}`);
    }
  } else {
    note(pageKey, "terminal:tabs", "notfound", "no play terminal mounted on the board");
  }
}

// Text/aria fragments that mark a control as UNSAFE to click in a bounded sweep (destructive,
// nav-away, sign-out, external, subscription). Matched case-insensitively against label + aria-label.
const UNSAFE_LABEL = /sign\s*out|log\s*out|delete|remove|cancel subscription|unsubscribe|upgrade|manage (billing|subscription)|open in|external/i;

/**
 * Bounded generic sweep — enumerate visible <button>/[role=tab]/[role=button] not already covered
 * by the targeted walks, skip anything destructive/nav-away, click a capped sample, and record any
 * that throw. The real payoff is coupling: a click that spikes console errors is flagged by the
 * per-page bug counters (collected globally), so this surfaces runtime bugs the targeted walk misses.
 */
async function sweepClickables(page, pageKey) {
  const CAP = 15;
  let handles;
  try {
    handles = await page.locator('button:visible, [role="tab"]:visible, [role="button"]:visible').all();
  } catch (e) {
    note(pageKey, "sweep:enumerate", "error", e.message);
    return;
  }
  let clicked = 0;
  let skipped = 0;
  for (const el of handles) {
    if (clicked >= CAP) break;
    let label = "";
    try {
      label = ((await el.getAttribute("aria-label")) || (await el.innerText()) || "").trim().replace(/\s+/g, " ");
    } catch {
      continue;
    }
    if (!label) continue;
    if (UNSAFE_LABEL.test(label)) {
      skipped++;
      continue;
    }
    if (!(await el.isVisible().catch(() => false))) continue;
    try {
      await el.click({ timeout: 5000 });
      clicked++;
      await page.waitForTimeout(200);
    } catch (e) {
      note(pageKey, `sweep:click "${label.slice(0, 40)}"`, "error", e.message);
    }
  }
  note(pageKey, "sweep", "clicked", `${clicked} clicked, ${skipped} skipped (unsafe) of ${handles.length} candidates`);
  await shot(page, `${pageKey}-sweep-done`);
}

// Known-benign request hosts/paths — analytics, telemetry, session beacons, RUM. Tagged, not
// dropped, so a real 4xx/5xx on an app route stands out from noise in the failedRequests list.
const BENIGN_REQUEST = /google-analytics|googletagmanager|gtag\/js|clarity\.ms|segment\.(io|com)|sentry\.io|\/ingest|doubleclick|facebook\.com\/tr|hotjar|amplitude|posthog|beacon|\/o\/e\?|stats\.g/i;

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  // Auth mint is a HARD prerequisite — without it there is no authenticated walk to run.
  console.error(`admin-ui-walkthrough: FATAL — could not mint admin session: ${session.reason}`);
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ ...report, fatal: session.reason }, null, 2));
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
// Plain DESKTOP context — NO iOS UA / device / init script — with the minted Clerk cookies.
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
await ctx.addCookies(session.cookies);

let pagesErrored = 0;
try {
  const page = await ctx.newPage();

  // Runtime-bug capture — attached ONCE, bucketed by the route being walked. These are the real
  // UI-bug signal: console errors, uncaught exceptions, and failed/4xx/5xx network requests.
  let currentPath = "_boot";
  const buckets = {
    consoleErrors: () => (report.consoleErrors[currentPath] ||= []),
    pageErrors: () => (report.pageErrors[currentPath] ||= []),
    failedRequests: () => (report.failedRequests[currentPath] ||= []),
  };
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const loc = m.location();
    buckets.consoleErrors().push({
      text: m.text().slice(0, 300),
      location: loc ? `${loc.url}:${loc.lineNumber}` : "",
    });
  });
  page.on("pageerror", (err) => {
    buckets.pageErrors().push(String(err?.stack || err?.message || err).slice(0, 300));
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    buckets.failedRequests().push({
      url: url.slice(0, 200),
      failure: req.failure()?.errorText || "failed",
      benign: BENIGN_REQUEST.test(url),
    });
  });
  page.on("response", (resp) => {
    const st = resp.status();
    if (st < 400) return;
    const url = resp.url();
    buckets.failedRequests().push({ url: url.slice(0, 200), status: st, benign: BENIGN_REQUEST.test(url) });
  });

  for (const { path, slug } of PAGES) {
    currentPath = path;
    console.log(`\n== ${path} ==`);
    let status = 0;
    try {
      const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60000 });
      status = resp?.status() ?? 0;
      // Wait for the authenticated Clerk client to hydrate (same signal the ios suite waits on) so
      // the shot isn't of a pre-auth skeleton; tolerate its absence rather than aborting the page.
      await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 45000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
    } catch (e) {
      pagesErrored++;
      report.pages.push({ path, status: "NAV_ERROR", error: String(e).slice(0, 160) });
      note(slug, "navigate", "error", e.message);
      continue;
    }

    const entryShot = await shot(page, `${slug}-page`);
    // Detect + record the render state BEFORE interacting so any "notfound" below is explained.
    const state = await detectPageState(page, slug);
    report.pages.push({ path, status, screenshot: entryShot, state });

    // Per-page interactions — each helper is internally try/catch'd per control.
    if (CHART_SLUGS.has(slug)) {
      await walkVectorChart(page, slug);
    }
    if (slug === "dashboard") {
      await walkIntelRail(page, slug);
    }
    if (slug === "nighthawk") {
      await walkNighthawk(page, slug, state);
    }

    // Bounded generic clickable sweep — surfaces runtime bugs the targeted walk misses (coupled to
    // the console-error counter). Skipped on a premium gate (nothing member-facing to sweep).
    if (state !== "premium-gate") {
      await sweepClickables(page, slug);
    }

    // Per-page runtime-bug roll-up.
    const ce = report.consoleErrors[path] || [];
    const pe = report.pageErrors[path] || [];
    const fr = report.failedRequests[path] || [];
    report.bugCounts[path] = {
      consoleErrors: ce.length,
      pageErrors: pe.length,
      failedRequests: fr.filter((r) => !r.benign).length,
      benignRequests: fr.filter((r) => r.benign).length,
    };
    const bc = report.bugCounts[path];
    console.log(
      `  bugs[${path}]: ${bc.consoleErrors} console-err, ${bc.pageErrors} pageerror, ` +
        `${bc.failedRequests} failed-req (+${bc.benignRequests} benign)`,
    );
  }
} finally {
  await browser.close().catch(() => {});
  await session.cleanup().catch(() => {});
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

const navOk = report.pages.filter((p) => typeof p.status === "number" && p.status < 400).length;
const totalConsoleErrors = Object.values(report.bugCounts).reduce((n, b) => n + b.consoleErrors, 0);
const totalPageErrors = Object.values(report.bugCounts).reduce((n, b) => n + b.pageErrors, 0);
const totalFailedReq = Object.values(report.bugCounts).reduce((n, b) => n + b.failedRequests, 0);
console.log(`\nadmin-ui-walkthrough: ${navOk}/${PAGES.length} pages OK, ${report.actions.length} interactions logged`);
console.log(`  runtime bugs: ${totalConsoleErrors} console-err, ${totalPageErrors} pageerror, ${totalFailedReq} failed-req`);
const premiumGated = report.states.filter((s) => s.state === "premium-gate").map((s) => s.route);
if (premiumGated.length) console.log(`  ⚠️ PREMIUM-GATED (tier didn't resolve): ${premiumGated.join(", ")}`);
console.log(`  screenshots + report: ${OUT}`);

// HARD failure only when EVERY page failed to load (auth mint already handled above). Runtime bugs
// and single missing controls are logged for the operator to read, not a process-level failure.
if (pagesErrored >= PAGES.length) {
  console.error("admin-ui-walkthrough: FATAL — every page errored");
  process.exit(1);
}
process.exit(0);
