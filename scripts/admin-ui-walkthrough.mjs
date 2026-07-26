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
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mintIosPlaywrightSession } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.ADMIN_WALKTHROUGH_DIR || "./artifacts/admin-ui-walkthrough";
mkdirSync(OUT, { recursive: true });

/** Authenticated desk pages to walk (order matters — screenshots are prefixed by index). */
const PAGES = [
  { path: "/nighthawk", slug: "nighthawk" },
  { path: "/dashboard", slug: "dashboard" },
  { path: "/vector", slug: "vector" },
  { path: "/vector?ticker=SPX", slug: "vector-spx" },
];

const report = { base: BASE, at: new Date().toISOString(), pages: [], actions: [], consoleErrors: {} };

/** Record a per-page interaction outcome (found / clicked / notfound / error) — never throws. */
function note(page, action, status, detail = "") {
  report.actions.push({ page, action, status, detail: String(detail).slice(0, 160) });
  console.log(`    [${status}] ${page} · ${action}${detail ? ` — ${String(detail).slice(0, 100)}` : ""}`);
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
    await el.click({ timeout: 8000 });
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
 * Vector chart layer walk — open the indicator menu (the `Indicators` trigger carries
 * data-testid="vector-indicator-trigger"), screenshot the open menu (all toggles visible), then
 * enable each NEW positioning/expected-move layer by its menu label and screenshot the chart after
 * each. Menu items are role="menuitemcheckbox" whose text is the label from vector-indicators-config
 * (VECTOR_INDICATOR_GROUPS). Labels are matched by substring so a copy tweak (e.g. the "(long /
 * short γ zones)" suffix) doesn't silently break the walk; each toggle is independent and try/catch'd.
 */
async function walkVectorChart(page, pageKey) {
  const trigger = page.locator('[data-testid="vector-indicator-trigger"]');
  if (!(await trigger.first().isVisible().catch(() => false))) {
    note(pageKey, "vector:indicator-menu", "notfound", "no Vector chart / indicator trigger on this page");
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
async function walkNighthawk(page, pageKey) {
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
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  });

  for (const { path, slug } of PAGES) {
    consoleErrors.length = 0;
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
    report.pages.push({ path, status, screenshot: entryShot });

    // Per-page interactions — each helper is internally try/catch'd per control.
    if (slug === "vector" || slug === "vector-spx" || slug === "dashboard") {
      await walkVectorChart(page, slug);
    }
    if (slug === "dashboard") {
      await walkIntelRail(page, slug);
    }
    if (slug === "nighthawk") {
      await walkNighthawk(page, slug);
    }

    report.consoleErrors[path] = [...consoleErrors];
  }
} finally {
  await browser.close().catch(() => {});
  await session.cleanup().catch(() => {});
}

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

const navOk = report.pages.filter((p) => typeof p.status === "number" && p.status < 400).length;
console.log(`\nadmin-ui-walkthrough: ${navOk}/${PAGES.length} pages OK, ${report.actions.length} interactions logged`);
console.log(`  screenshots + report: ${OUT}`);

// HARD failure only when EVERY page failed to load (auth mint already handled above).
if (pagesErrored >= PAGES.length) {
  console.error("admin-ui-walkthrough: FATAL — every page errored");
  process.exit(1);
}
process.exit(0);
