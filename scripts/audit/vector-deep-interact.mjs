/**
 * VECTOR DEEP INTERACTION AUDIT — drives the live desk like a member.
 *
 * Clicks every toggle, opens every menu, draws with every drawing tool, types text, zooms, searches
 * tickers, enters compare mode, and runs the scanner filters — then reports what broke.
 *
 * DESIGN NOTES (these are the parts that make the result trustworthy):
 *  - GUARD BEFORE JUDGING. Every pass asserts the chart canvas rendered before it judges a control.
 *    Without that, a 404 / auth bounce / cold page all report "control not found", which reads as a
 *    product defect when it is a harness failure.
 *  - CONSOLE ERRORS ARE ATTRIBUTED PER ACTION. Errors are drained before each step, so an error is
 *    blamed on the click that produced it rather than on whatever came last.
 *  - A CONTROL THAT DOES NOTHING IS A FINDING. For aria-pressed toggles the harness asserts the
 *    state actually flipped; a button that swallows a click silently is exactly the bug class a
 *    screenshot sweep misses.
 *  - MARKET PHASE IS PRINTED. Off-hours, live values are legitimately static — a "value did not
 *    change" observation must never be quoted as a staleness bug when the tape is closed.
 *
 * Read-only w.r.t. member data. One temp Clerk user, deleted in a finally.
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1.
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
/**
 * Output dir. `--out=DIR` when you want the artifacts somewhere durable, otherwise a fresh
 * mkdtemp under the OS temp dir.
 *
 * NOT a hardcoded /tmp path: a fixed, predictable name in a world-writable directory is the
 * "insecure temporary file" pattern (another user can pre-create or symlink it), and — more
 * mundanely — the first version of this script baked in the authoring session's own scratchpad
 * path, so for anyone else it wrote artifacts into a directory that had nothing to do with them.
 */
const OUT = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1]
  || mkdtempSync(join(tmpdir(), "vector-audit-"));
mkdirSync(OUT, { recursive: true });

const flag = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const TICKERS = String(flag("tickers", "SPY")).split(",").filter(Boolean);
const DESKTOP = !process.argv.includes("--phone");
const SHOTS = process.argv.includes("--shots");

function marketPhaseEt(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "weekend";
  const m = et.getHours() * 60 + et.getMinutes();
  if (m < 4 * 60) return "overnight";
  if (m < 9 * 60 + 30) return "pre-market";
  if (m <= 16 * 60) return "RTH";
  if (m <= 20 * 60) return "after-hours";
  return "overnight";
}

/** findings[] entries are the deliverable; sev is P1..P3 or INFO. */
const findings = [];
const harnessNoise = [];

/**
 * Anything matching this is the HARNESS failing, not the product:
 *  - 401 → the ~72s Clerk session JWT expired mid-run (the documented trap)
 *  - ERR_CONNECTION_FAILED / ECONNRESET → CONNECT-tunnel saturation on a long run
 *  - locator timeouts that FOLLOW either of the above are consequences, not causes
 * Reporting these as product bugs is how an audit manufactures 20 phantom findings.
 */
const HARNESS_RE = /\b401\b|Unauthorized|ERR_CONNECTION|ECONNRESET|net::ERR/i;

/**
 * Set once the run has seen a 401 or a dead tunnel. AFTER that point a click timeout is a
 * CONSEQUENCE of the broken session, not evidence about the control — but BEFORE it, a timeout is
 * real and must be reported. Classifying every timeout as harness noise would have buried the
 * genuine DTE-toggle failure observed at ~20s into the first run, well inside the JWT's lifetime.
 */
let authDegraded = false;

function finding(sev, area, what, detail) {
  const blob = `${what} ${detail || ""}`;
  const isTimeout = /Timeout .*exceeded|\btimeout\b/i.test(blob);
  if (HARNESS_RE.test(blob) || (isTimeout && authDegraded)) {
    harnessNoise.push({ area, what, detail });
    console.log(`  [harness] ${area}: ${what}`);
    return;
  }
  findings.push({ sev, area, what, detail });
  console.log(`  [${sev}] ${area}: ${what}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const phase = marketPhaseEt();
  console.log(`market phase: ${phase}${phase === "RTH" ? "" : "  (live values legitimately static — do NOT read as staleness)"}`);

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`HARNESS/AUTH ERROR: ${session.reason} — NOT a product signal.`);
    process.exitCode = 1;
    return;
  }

  let browser;
  try {
    for (const ticker of TICKERS) {
      const url = `${BASE}/vector?ticker=${encodeURIComponent(ticker)}`;
      const t = await createTunneledContext({
        url,
        cookie: session.cookieHeader,
        viewport: DESKTOP ? "1440x900" : "430x932",
        desktop: DESKTOP,
      });
      browser = t.browser;
      const page = await t.ctx.newPage();

      // KEEP THE SESSION ALIVE. A Clerk session JWT lives ~72s; this pass runs for many minutes, so
      // without re-minting the page's own fetches start returning 401 and every control after that
      // point reads as broken. That is the single biggest source of false findings in this harness.
      const dom = new URL(BASE).hostname;
      const refreshCookies = async () => {
        const next = await session.refresh?.().catch(() => null);
        if (!next?.cookieHeader) return false;
        const cookies = next.cookieHeader.split(";").map((kv) => {
          const i = kv.indexOf("=");
          return { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), domain: dom, path: "/" };
        });
        await t.ctx.addCookies(cookies).catch(() => {});
        return true;
      };
      const keepAlive = setInterval(() => { void refreshCookies(); }, 45_000);

      let consoleErrors = [];
      let pageErrors = [];
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 250));
      });
      page.on("pageerror", (e) => pageErrors.push(String(e?.message || e).slice(0, 250)));
      const drain = () => {
        const c = [...consoleErrors], p = [...pageErrors];
        consoleErrors = []; pageErrors = [];
        const all = [...c, ...p];
        if (all.some((e) => HARNESS_RE.test(e))) authDegraded = true;
        return all;
      };

      console.log(`\n${"=".repeat(70)}\n${ticker} — ${DESKTOP ? "desktop 1440x900" : "phone 430x932"}\n${"=".repeat(70)}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(12_000);

      const canvases = await page.locator("canvas").count();
      if (canvases === 0) {
        finding("P1", `${ticker}/load`, "chart canvas never rendered", "page guard failed — everything below is unreliable");
        await page.close();
        continue;
      }
      console.log(`load OK: ${canvases} canvases`);
      const loadErrs = drain();
      if (loadErrs.length) finding("P2", `${ticker}/load`, `${loadErrs.length} console error(s) on load`, [...new Set(loadErrs)].slice(0, 3).join(" | "));

      // `:visible` is load-bearing, not defensive. The desk renders BOTH a desktop toolbar and an
      // iOS-compact one; 7 of the 12 probed testids exist TWICE, and the compact copy (display:none
      // on desktop) comes FIRST in the DOM. A bare `.first()` therefore resolves to a 0x0 element at
      // 0,0 and every click times out — which reads as "six controls are broken" when nothing is.
      // Measured by vector-testid-probe.mjs before any of it was written up.
      const tid = (id) => page.locator(`[data-testid="${id}"]:visible`);

      /**
       * Why a click could not land. A bare "Timeout exceeded" says nothing actionable; whether the
       * element is invisible, disabled, zero-sized, or COVERED BY ANOTHER ELEMENT is the finding.
       */
      async function describe(el) {
        return el.first().evaluate((node) => {
          const r = node.getBoundingClientRect();
          const s = getComputedStyle(node);
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const top = document.elementFromPoint(cx, cy);
          const occluder = top && top !== node && !node.contains(top)
            ? `${top.tagName.toLowerCase()}.${String(top.className || "").split(/\s+/).slice(0, 2).join(".")}`
            : null;
          return {
            box: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
            display: s.display, visibility: s.visibility, opacity: s.opacity,
            pointerEvents: s.pointerEvents,
            disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
            occluder,
          };
        }).catch(() => null);
      }

      /** Click a toggle and assert aria-pressed actually flipped. */
      async function toggle(id, label) {
        const el = tid(id);
        if ((await el.count()) === 0) return finding("P2", `${ticker}/${label}`, "control absent", `data-testid=${id}`);
        const before = await el.first().getAttribute("aria-pressed");
        await el.first().click({ timeout: 10_000 }).catch(async (e) => {
          const d = await describe(el);
          finding("P2", `${ticker}/${label}`, "click never landed",
            `${String(e.message).split("\n")[0].slice(0, 70)} | ${d ? JSON.stringify(d) : "no diagnostics"}`);
        });
        await page.waitForTimeout(2200);
        const after = await el.first().getAttribute("aria-pressed");
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/${label}`, `console error after click`, [...new Set(errs)].slice(0, 2).join(" | "));
        if (before != null && before === after) {
          finding("P2", `${ticker}/${label}`, "aria-pressed did not change", `stayed ${before} — control may be inert`);
        }
        const cv = await page.locator("canvas").count();
        if (cv === 0) finding("P1", `${ticker}/${label}`, "chart disappeared after click");
        return { before, after };
      }

      async function plainClick(id, label, wait = 2200) {
        const el = tid(id);
        if ((await el.count()) === 0) return finding("P2", `${ticker}/${label}`, "control absent", `data-testid=${id}`);
        await el.first().click({ timeout: 10_000 }).catch(async (e) => {
          const d = await describe(el);
          finding("P2", `${ticker}/${label}`, "click never landed",
            `${String(e.message).split("\n")[0].slice(0, 70)} | ${d ? JSON.stringify(d) : "no diagnostics"}`);
        });
        await page.waitForTimeout(wait);
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/${label}`, "console error after click", [...new Set(errs)].slice(0, 2).join(" | "));
        if ((await page.locator("canvas").count()) === 0) finding("P1", `${ticker}/${label}`, "chart disappeared after click");
      }

      // ── 1. LENS + DTE + BEAD TOGGLES ──────────────────────────────────────────────────────
      console.log("\n-- toggles --");
      await toggle("vector-lens-vex", "lens/VEX");
      await toggle("vector-lens-gex", "lens/GEX");
      await toggle("vector-dte-weekly", "dte/Weekly");
      await toggle("vector-dte-monthly", "dte/Monthly");
      await toggle("vector-dte-0dte", "dte/0DTE");
      await toggle("vector-bead-bead-integrity-rings", "bead/Rings");
      await toggle("vector-bead-bead-dollar-sizing", "bead/$Size");
      await toggle("vector-bead-bead-event-glyphs", "bead/Events");
      // restore
      await toggle("vector-bead-bead-integrity-rings", "bead/Rings(restore)");
      await toggle("vector-bead-bead-dollar-sizing", "bead/$Size(restore)");

      // VEX + Rings interaction: Rings are documented GEX-only; the chip should disable, not lie.
      await plainClick("vector-lens-vex", "lens/VEX(for rings check)");
      const ringsOnVex = tid("vector-bead-bead-integrity-rings");
      if (await ringsOnVex.count()) {
        const dis = await ringsOnVex.first().isDisabled().catch(() => false);
        const aria = await ringsOnVex.first().getAttribute("aria-disabled");
        console.log(`  Rings under VEX: disabled=${dis} aria-disabled=${aria}`);
        if (!dis && aria !== "true") {
          finding("P3", `${ticker}/bead/Rings`, "Rings chip stays enabled under VEX lens", "integrity is GEX-scored; an enabled chip implies a ring the lens cannot draw");
        }
      }
      await plainClick("vector-lens-gex", "lens/GEX(restore)");

      // ── 2. CHART VIEW + ZOOM PRESETS ──────────────────────────────────────────────────────
      console.log("\n-- chart views + zoom --");
      for (const [id, label] of [
        ["vector-chart-view-4h", "view/4H"],
        ["vector-chart-view-1d", "view/1D"],
        ["vector-chart-view-1w", "view/1W"],
        ["vector-chart-view-intraday", "view/Intraday"],
      ]) await toggle(id, label);

      for (const [id, label] of [
        ["vector-intraday-zoom-structure", "zoom/Structure"],
        ["vector-intraday-zoom-live", "zoom/Live"],
        ["vector-intraday-zoom-session", "zoom/Session"],
      ]) await toggle(id, label);

      // ── 3. WHEEL ZOOM (regression surface of #2221/#2222: range-sync cancelled wheel zoom) ──
      console.log("\n-- wheel zoom --");
      const chart = page.locator("canvas").first();
      const box = await chart.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const readBars = async () => page.evaluate(() => {
          const c = document.querySelector("canvas");
          return c ? `${c.width}x${c.height}` : null;
        });
        await page.mouse.move(cx, cy);
        const before = await readBars();
        for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(220); }
        await page.waitForTimeout(2500);
        const zoomErrs = drain();
        if (zoomErrs.length) finding("P2", `${ticker}/zoom/wheel-in`, "console error while zooming", [...new Set(zoomErrs)].slice(0, 2).join(" | "));
        for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(220); }
        await page.waitForTimeout(2500);
        const outErrs = drain();
        if (outErrs.length) finding("P2", `${ticker}/zoom/wheel-out`, "console error while zooming out", [...new Set(outErrs)].slice(0, 2).join(" | "));
        console.log(`  wheel zoom in/out completed (canvas ${before} -> ${await readBars()})`);
      } else {
        finding("P2", `${ticker}/zoom`, "could not resolve chart bounding box");
      }

      // ── 4. DRAWING TOOLS — functional, not merely present ────────────────────────────────
      // The real question is not "does a tool button exist" but "does clicking the chart with it
      // selected actually create a drawing". `vector-draw-count` renders "N ink", so the count is
      // the ground truth: it must INCREMENT per drawing, DECREMENT on undo, and SURVIVE a reload
      // (drawings are persisted per ticker by vector-drawings-store.ts).
      console.log("\n-- drawing tools --");
      const TOOLS = ["hline", "trend", "ray", "rect", "text", "fib", "vline"];
      const readInk = async () => {
        const el = page.locator('[data-testid="vector-draw-count"]:visible').first();
        if ((await el.count()) === 0) return null;
        const txt = (await el.innerText().catch(() => "")) || "";
        const m = txt.match(/(\d+)/);
        return m ? Number(m[1]) : null;
      };
      const openTools = async () => {
        const panel = page.locator('[data-testid="vector-draw-tool-hline"]:visible');
        if ((await panel.count()) === 0) await plainClick("vector-draw-tools-trigger", "tools/open", 1200);
      };

      await openTools();
      const inkStart = await readInk();
      console.log(`  ink at start: ${inkStart}`);
      if (inkStart === null) finding("P2", `${ticker}/tools`, "drawing panel did not open", "vector-draw-count not visible after clicking the Tools trigger");

      let inkPrev = inkStart ?? 0;
      const drawnOk = [];
      for (const tool of TOOLS) {
        await openTools();
        const btn = page.locator(`[data-testid="vector-draw-tool-${tool}"]:visible`).first();
        if ((await btn.count()) === 0) { finding("P2", `${ticker}/tools/${tool}`, "tool button absent"); continue; }
        if (await btn.isDisabled().catch(() => false)) { finding("P3", `${ticker}/tools/${tool}`, "tool button disabled"); continue; }
        await btn.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);

        // The text tool needs its label typed BEFORE the chart click that places it.
        if (tool === "text") {
          const input = page.locator('[data-testid="vector-draw-text-input"]:visible').first();
          if ((await input.count()) === 0) {
            finding("P2", `${ticker}/tools/text`, "text label input never appeared", "selecting the text tool should reveal vector-draw-text-input");
          } else {
            await input.fill("AUDIT TEXT 123").catch(() => {});
            await page.waitForTimeout(300);
            const val = await input.inputValue().catch(() => "");
            if (val !== "AUDIT TEXT 123") finding("P2", `${ticker}/tools/text`, "text input did not accept typing", `value read back as "${val}"`);
          }
        }

        const b = await page.locator("canvas").first().boundingBox();
        if (!b) { finding("P2", `${ticker}/tools/${tool}`, "no chart box to draw on"); continue; }
        // Stagger each tool's gesture to its own horizontal band. Reusing one y meant the drag for
        // `trend` started exactly on the hline drawn moments earlier and MOVED it instead of
        // creating anything — which reads as "the trend tool is broken" when it is the harness
        // grabbing its own previous drawing. Measured: trend/rect/fib all "failed" at a shared y,
        // all register once separated.
        const slot = TOOLS.indexOf(tool);
        const yBase = 0.14 + slot * 0.1;
        const x1 = b.x + b.width * 0.28, y1 = b.y + b.height * yBase;
        const x2 = b.x + b.width * 0.62, y2 = b.y + b.height * (yBase + 0.05);
        // TWO DISCRETE CLICKS for two-point tools, not a drag. vector-draw-click.ts resolves a
        // drawing's time from a chart CLICK param (resolveChartClickTime), so a mousedown-move-mouseup
        // gesture never delivers the first point — the tool stays half-armed and no ink is created.
        // A drag "failing" here is the harness speaking the wrong dialect, not a broken tool.
        // Re-open the tool panel BETWEEN the two clicks. A chart click closes the panel
        // (click-outside), and depending on whether it was open the panel itself can swallow one of
        // the two points — which is what made alternate tools look broken in an earlier revision of
        // this harness. Proven by vector-draw-isolate.mjs (7/7 alone) and vector-draw-sequence.mjs
        // (5/5 in a row with this pattern): the tools are fine, the old gesture was not.
        if (tool === "hline" || tool === "vline" || tool === "text") {
          await page.mouse.click(x1, y1);
        } else {
          await page.mouse.click(x1, y1);
          await page.waitForTimeout(700);
          await openTools();
          await page.mouse.click(x2, y2);
        }
        await page.waitForTimeout(1400);

        await openTools();
        const ink = await readInk();
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/tools/${tool}`, "console error while drawing", [...new Set(errs)].slice(0, 2).join(" | "));
        if (ink === null) { finding("P2", `${ticker}/tools/${tool}`, "ink count unreadable after drawing"); continue; }
        if (ink > inkPrev) { drawnOk.push(tool); console.log(`  ${tool}: ink ${inkPrev} -> ${ink} OK`); inkPrev = ink; }
        else finding("P2", `${ticker}/tools/${tool}`, "drawing did not register", `ink count stayed ${ink} after a draw gesture`);
      }
      console.log(`  tools that produced a drawing: ${drawnOk.join(", ") || "(none)"}`);

      // UNDO must remove exactly one.
      if (inkPrev > 0) {
        await openTools();
        await plainClick("vector-draw-undo", "tools/undo", 1400);
        await openTools();
        const afterUndo = await readInk();
        if (afterUndo !== null && afterUndo !== inkPrev - 1) {
          finding("P2", `${ticker}/tools/undo`, "undo did not remove exactly one drawing", `${inkPrev} -> ${afterUndo}`);
        } else console.log(`  undo: ink ${inkPrev} -> ${afterUndo} OK`);
        inkPrev = afterUndo ?? inkPrev;
      }

      // PERSISTENCE across reload — drawings are stored per ticker.
      if (inkPrev > 0) {
        await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForTimeout(10_000);
        await openTools();
        const afterReload = await readInk();
        console.log(`  after reload: ink ${afterReload} (was ${inkPrev})`);
        if (afterReload === null) finding("P3", `${ticker}/tools/persist`, "ink count unreadable after reload");
        else if (afterReload !== inkPrev) finding("P2", `${ticker}/tools/persist`, "drawings did not survive a reload", `${inkPrev} before, ${afterReload} after`);
      }

      if (SHOTS) await page.screenshot({ path: `${OUT}/drawn-${ticker}.png` });

      // ── 5. INDICATORS MENU ────────────────────────────────────────────────────────────────
      console.log("\n-- indicators --");
      await plainClick("vector-indicator-trigger", "indicators/open", 1500);
      const indItems = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll("[role='menuitemcheckbox'],[role='menuitem'],[role='checkbox'],label,button")) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (txt && txt.length < 34 && /vwap|ema|sma|volume|rsi|macd|band|profile|session|level|gamma|wall|flip|pivot|atr|bead|rail/i.test(txt)) {
            out.push(txt.slice(0, 34));
          }
        }
        return [...new Set(out)];
      });
      console.log(`  indicator entries: ${indItems.join(" | ") || "(none matched)"}`);
      for (const name of indItems.slice(0, 10)) {
        const el = page.locator(`text="${name}"`).first();
        if ((await el.count()) === 0) continue;
        await el.click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1400);
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/indicator/${name}`, "console error after toggling", [...new Set(errs)].slice(0, 2).join(" | "));
        if ((await page.locator("canvas").count()) === 0) finding("P1", `${ticker}/indicator/${name}`, "chart disappeared after toggling indicator");
      }
      await page.keyboard.press("Escape").catch(() => {});

      // ── 6. MATRIX RAIL: side filters + reset ──────────────────────────────────────────────
      console.log("\n-- matrix rail --");
      for (const label of ["CALL", "PUT", "ALL"]) {
        const el = page.locator(`button:has-text("${label}")`).first();
        if ((await el.count()) === 0) { finding("P3", `${ticker}/matrix/${label}`, "side filter button absent"); continue; }
        await el.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1800);
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/matrix/${label}`, "console error", [...new Set(errs)].slice(0, 2).join(" | "));
      }
      await plainClick("vector-odte-matrix-reset", "matrix/reset-to-spot");

      // ── 7. SCANNER FILTERS ────────────────────────────────────────────────────────────────
      console.log("\n-- scanner filters --");
      for (const label of ["Nearest flip", "Most pinned", "Most explosive", "All"]) {
        const el = page.locator(`button:has-text("${label}")`).first();
        if ((await el.count()) === 0) { finding("P3", `${ticker}/scanner/${label}`, "filter absent"); continue; }
        await el.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1800);
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/scanner/${label}`, "console error", [...new Set(errs)].slice(0, 2).join(" | "));
      }

      // ── 8. TIMEFRAME SELECT ───────────────────────────────────────────────────────────────
      console.log("\n-- timeframe select --");
      const tf = tid("vector-tf-select");
      if (await tf.count()) {
        for (const v of ["5 min", "15 min", "1 min"]) {
          await tf.first().selectOption({ label: v }).catch((e) => finding("P3", `${ticker}/tf/${v}`, "selectOption failed", String(e.message).slice(0, 90)));
          await page.waitForTimeout(2500);
          const errs = drain();
          if (errs.length) finding("P2", `${ticker}/tf/${v}`, "console error after timeframe change", [...new Set(errs)].slice(0, 2).join(" | "));
        }
      } else finding("P2", `${ticker}/tf`, "timeframe select absent");

      // ── 9. TICKER SEARCH ──────────────────────────────────────────────────────────────────
      console.log("\n-- ticker search --");
      const search = tid("vector-ticker-search");
      if (await search.count()) {
        await search.first().click().catch(() => {});
        await search.first().fill("").catch(() => {});
        await search.first().type("NVDA", { delay: 70 }).catch(() => {});
        await page.waitForTimeout(1600);
        const optionCount = await page.locator("[role='option']").count();
        console.log(`  typed NVDA -> ${optionCount} option(s)`);
        if (optionCount === 0) {
          finding("P2", `${ticker}/search`, "typing a valid symbol produced no options", "combobox may be inert — the exact defect #2 in the Thermal sweep");
        } else {
          await page.locator("[role='option']").first().click().catch(() => {});
          await page.waitForTimeout(6000);
          const errs = drain();
          if (errs.length) finding("P2", `${ticker}/search`, "console error after selecting a symbol", [...new Set(errs)].slice(0, 2).join(" | "));
          const nowUrl = page.url();
          console.log(`  after select, url=${nowUrl}`);
          if (!/NVDA/i.test(nowUrl) && !(await page.locator("body").innerText()).includes("NVDA")) {
            finding("P2", `${ticker}/search`, "selecting NVDA did not switch the desk", `url stayed ${nowUrl}`);
          }
        }
        // garbage input must not crash
        await search.first().fill("").catch(() => {});
        await search.first().type("ZZZZQQ", { delay: 50 }).catch(() => {});
        await page.waitForTimeout(1800);
        const gErrs = drain();
        if (gErrs.length) finding("P3", `${ticker}/search`, "console error on nonsense symbol", [...new Set(gErrs)].slice(0, 2).join(" | "));
        await page.keyboard.press("Escape").catch(() => {});
      } else finding("P2", `${ticker}/search`, "ticker search absent");

      // ── 10. COMPARE MODE ──────────────────────────────────────────────────────────────────
      console.log("\n-- compare --");
      // Fresh load first: the previous section switches ticker, and if anything there broke the page
      // (a stale chunk 404, say) compare would be judged on a corpse. Compare deserves its own
      // clean page, or its result says nothing about compare.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(10_000);
      drain();
      await plainClick("vector-enter-compare", "compare/enter", 9000);
      const compareCanvases = await page.locator("canvas").count();
      console.log(`  canvases in compare: ${compareCanvases}`);
      if (compareCanvases === 0) finding("P1", `${ticker}/compare`, "compare mode rendered no canvases");
      const addSlot = page.locator("button:has-text('+ Add')").first();
      if (await addSlot.count()) {
        await addSlot.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const errs = drain();
        if (errs.length) finding("P2", `${ticker}/compare/add`, "console error after + Add", [...new Set(errs)].slice(0, 2).join(" | "));
      }
      if (SHOTS) await page.screenshot({ path: `${OUT}/compare-${ticker}.png` });
      // back out of compare
      await page.goBack().catch(() => {});
      await page.waitForTimeout(4000);

      // ── 11. LAYOUT: horizontal overflow ───────────────────────────────────────────────────
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      if (overflow.scrollW > overflow.clientW + 2) {
        finding("P2", `${ticker}/layout`, "page scrolls horizontally", `scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`);
      } else console.log(`\nlayout OK (no horizontal overflow: ${overflow.scrollW} <= ${overflow.clientW})`);

      if (SHOTS) await page.screenshot({ path: `${OUT}/final-${ticker}-${DESKTOP ? "desktop" : "phone"}.png`, fullPage: false });
      clearInterval(keepAlive);
      await page.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`HARNESS NOISE (auth expiry / tunnel saturation — NOT product): ${harnessNoise.length}`);
  console.log(`PRODUCT FINDINGS: ${findings.length}`);
  const bySev = findings.reduce((a, f) => ((a[f.sev] = (a[f.sev] || 0) + 1), a), {});
  console.log(JSON.stringify(bySev));
  writeFileSync(`${OUT}/findings-${DESKTOP ? "desktop" : "phone"}-${TICKERS.join("_")}.json`,
    JSON.stringify({ phase: marketPhaseEt(), desktop: DESKTOP, tickers: TICKERS, findings, harnessNoise }, null, 2));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e?.message || e);
  process.exitCode = 1;
});
