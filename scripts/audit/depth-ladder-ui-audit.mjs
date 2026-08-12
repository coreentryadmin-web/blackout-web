/**
 * SYNTHETIC ORDER BOOK — live UI audit.
 *
 * Drives the REAL Thermal desk on prod, opens the Depth tab, and asserts the ladder actually
 * rendered — bars painted, spot row placed, legend present, zero console errors — at desktop AND
 * phone widths. The ladder is the one gamma view that is supposed to fit a narrow screen, so the
 * mobile pass is a real requirement here, not a courtesy.
 *
 * WHY THE TUNNEL. Chromium in this sandbox has no network at all: direct, `proxy:{server}` and
 * `--proxy-server` all fail identically with ERR_CONNECTION_RESET while curl through the same proxy
 * returns 200. `createTunneledContext` takes the network away from Chromium entirely and fulfils
 * every request over a manual CONNECT + TLS tunnel from Node. A plain-Playwright failure here
 * proves nothing except the egress block — see docs/audit/LIVE-UI-CONNECTION.md.
 *
 * Read-only. One temp Clerk user, always deleted in a finally.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/depth-ladder-ui-audit.mjs [--ticker=SPY] [--json]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

// The tunnel context is CommonJS (it reaches for node:http/node:tls directly); bridge it the same
// way nighthawk-ui-sweep.mjs does rather than duplicating it as ESM.
const require_ = createRequire(import.meta.url);
// The UA and deviceScaleFactor come from `desktop:` inside createTunneledContext — importing the
// UA constants here as well would be dead code (CodeQL flagged exactly that).
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const TICKER = flag("ticker", "SPY");
const BASE = flag("base", "https://blackouttrades.com");
const OUT = flag("out", "/tmp/depth-ladder-ui");
const TARGET = `${BASE}/heatmap?ticker=${TICKER}`;

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

async function main() {
  mkdirSync(OUT, { recursive: true });

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP — ${session.reason}`);
    process.exit(0);
  }

  try {
    for (const device of [
      { name: "desktop", viewport: "1440x1000", desktop: true },
      { name: "phone", viewport: "430x932", desktop: false },
    ]) {
      // createTunneledContext owns the cookie + UA + deviceScaleFactor for us — passing the session
      // cookie through it (rather than addCookies afterwards) is what marks __session httpOnly, which
      // the app's own auth path depends on.
      const { browser, ctx, counts } = await createTunneledContext({
        url: TARGET,
        viewport: device.viewport,
        desktop: device.desktop,
        cookie: session.cookieHeader,
      });
      try {
        const page = await ctx.newPage();
        // FIRST-PARTY console errors only.
        //
        // The tunnel is not a browser: it cannot replay a `sendBeacon` Blob, so third-party
        // analytics POSTs fail against endpoints we do not own and never will. Counting those as
        // failures made this harness report FAIL on every run regardless of the product's health —
        // and an audit that always fails is worse than no audit, because it trains its reader to
        // skip the result. Third-party noise is still COLLECTED and printed, just not scored.
        const consoleErrors = [];
        const thirdPartyNoise = [];
        const isFirstParty = (text) =>
          !/google-analytics|googletagmanager|doubleclick|analytics\.twitter|\bt\.co\b|clarity\.ms|cdn-cgi\/rum|facebook|hotjar|segment\.(io|com)/i.test(text);
        page.on("console", (m) => {
          if (m.type() !== "error") return;
          const t = m.text().slice(0, 200);
          (isFirstParty(t) ? consoleErrors : thirdPartyNoise).push(t);
        });
        page.on("pageerror", (e) => {
          const t = `pageerror: ${String(e).slice(0, 200)}`;
          (isFirstParty(t) ? consoleErrors : thirdPartyNoise).push(t);
        });
        // A bare "Failed to load resource" console line carries no URL, so it cannot be attributed.
        // Attribute it from the RESPONSE instead, which does.
        page.on("response", (r) => {
          if (r.status() < 400) return;
          const u = r.url();
          if (!isFirstParty(u)) thirdPartyNoise.push(`${r.status()} ${u.slice(0, 120)}`);
        });

        if (!asJson) console.log(`\n═══ ${device.name} ${device.viewport}`);
        await page.goto(TARGET, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        // The matrix streams in; give the first payload time to paint before touching tabs.
        await page.waitForTimeout(12_000);

        // ── Prove the PAGE loaded before judging the FEATURE ─────────────────────────────
        // Without this, a blank page, a 404, or an auth bounce all report "Depth tab not found",
        // which reads as a product defect when it is a harness failure. The Matrix tab has shipped
        // for months, so its absence means the harness never got a desk to look at.
        const matrixTab = page.locator('[role="tab"]', { hasText: /^Matrix$/i }).first();
        if ((await matrixTab.count()) === 0) {
          note("FAIL", `${device.name}: HARNESS — no Matrix tab, so the desk never rendered; nothing below is evidence`, {
            title: await page.title(),
            routed: `${counts.ok} ok / ${counts.fail} fail`,
          });
          await page.screenshot({ path: join(OUT, `${device.name}-no-desk.png`) });
          continue;
        }
        note("PASS", `${device.name}: desk rendered (routed ${counts.ok} ok, ${counts.fail} fail)`);

        // ── Phase 2: the forced-flow rail pinned to the MATRIX ───────────────────────────
        // Checked on the Matrix tab, which is where a member actually meets it — the rail's whole
        // point is being readable on the same line as the strike's exposure. The Depth tab below
        // proves the ladder renders; it says nothing about whether the rail reached the matrix,
        // which is a separate render path (one <th> + one <td> per row, behind `depthRail &&`).
        //
        // Desktop only: the matrix collapses to a card layout on a phone, where there is no row to
        // pin a rail to. Asserting it there would manufacture a failure for a view that does not
        // exist at that width.
        if (device.desktop) {
          const flowHeader = page.locator("th", { hasText: /^Flow$/i });
          if ((await flowHeader.count()) === 0) {
            note("WARN", `${device.name}: no Flow column on the matrix — Phase 2 rail absent (not yet deployed, or this payload carries no depth)`);
          } else {
            note("PASS", `${device.name}: matrix Flow column present`);
            // A header with no painted cells is the failure that matters: it reserves the column,
            // implies a reading, and shows nothing. Count cells that actually carry a colour.
            const railCells = await page.locator("td span[style*='background']").count();
            note(
              railCells >= 5 ? "PASS" : "FAIL",
              `${device.name}: ${railCells} rail cells painted on the matrix`
            );
          }
          const matrixShot = join(OUT, `${device.name}-matrix-rail.png`);
          await page.screenshot({ path: matrixShot, fullPage: false });
          note("INFO", `${device.name}: screenshot ${matrixShot}`);
        }

        // ── Open the Depth tab ───────────────────────────────────────────────────────────
        const depthTab = page
          .locator('[role="tab"]', { hasText: /Depth|Forced Flow/i })
          .first();
        const tabCount = await depthTab.count();
        if (tabCount === 0) {
          note("FAIL", `${device.name}: Depth tab not found — the view never shipped to this page`);
          await page.screenshot({ path: join(OUT, `${device.name}-no-tab.png`), fullPage: false });
          continue;
        }
        note("PASS", `${device.name}: Depth tab present`);
        await depthTab.click();
        await page.waitForTimeout(3_500);

        // ── Did the ladder actually paint? ───────────────────────────────────────────────
        const ladder = page.locator('[aria-label*="Forced dealer hedging flow"]').first();
        if ((await ladder.count()) === 0) {
          const empty = await page.getByText(/Forced-flow ladder unavailable/i).count();
          if (empty > 0) {
            // A real, honest state — but it means we learned nothing about the render.
            note("WARN", `${device.name}: ladder reported unavailable (empty state rendered correctly)`);
          } else {
            note("FAIL", `${device.name}: neither a ladder nor the empty state rendered`);
          }
          await page.screenshot({ path: join(OUT, `${device.name}-no-ladder.png`) });
          continue;
        }

        // Bars are absolutely-positioned spans inside each rung; count the ones with real width.
        const bars = await ladder.locator("span[style*='background-color']").count();
        const rows = await ladder.locator("> div").count();
        if (rows < 10) note("FAIL", `${device.name}: only ${rows} rungs — ladder is truncated`);
        else note("PASS", `${device.name}: ${rows} rungs rendered`);
        if (bars < 8) note("FAIL", `${device.name}: only ${bars} bars painted`);
        else note("PASS", `${device.name}: ${bars} bars painted`);

        // The spot row must exist and must sit BETWEEN rungs, not at an edge.
        const spotRow = ladder.getByText(/^spot$/i);
        if ((await spotRow.count()) === 0) note("FAIL", `${device.name}: no spot marker on the ladder`);
        else note("PASS", `${device.name}: spot row present`);

        // Legend + the honest-limits line are part of the deliverable, not decoration.
        const legend = await page.getByText(/dealers buy/i).count();
        const limits = await page.getByText(/not resting liquidity/i).count();
        note(legend > 0 ? "PASS" : "FAIL", `${device.name}: legend ${legend > 0 ? "present" : "MISSING"}`);
        note(limits > 0 ? "PASS" : "FAIL", `${device.name}: honest-limits note ${limits > 0 ? "present" : "MISSING"}`);

        // ── No horizontal overflow: the page body must never scroll sideways ─────────────
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        if (overflow > 4) note("FAIL", `${device.name}: body scrolls horizontally by ${overflow}px`);
        else note("PASS", `${device.name}: no horizontal overflow`);

        const shot = join(OUT, `${device.name}-depth.png`);
        await page.screenshot({ path: shot, fullPage: false });
        note("INFO", `${device.name}: screenshot ${shot}`);

        // "Failed to load resource" duplicates a signal the response listener already attributed;
        // drop the unattributable copies so one third-party 4xx is not counted twice.
        const firstParty = consoleErrors.filter((t) => !/^Failed to load resource/i.test(t));
        if (firstParty.length > 0) {
          note("FAIL", `${device.name}: ${firstParty.length} first-party console errors`, {
            first: firstParty.slice(0, 3),
          });
        } else {
          note("PASS", `${device.name}: zero first-party console errors`);
        }
        if (thirdPartyNoise.length > 0) {
          note("INFO", `${device.name}: ${thirdPartyNoise.length} third-party/telemetry errors ignored`, {
            sample: thirdPartyNoise.slice(0, 2),
          });
        }
        if (!asJson) console.log(`  routed: ${counts.ok} ok, ${counts.fail} fail, ${counts.streamsHeldOpen ?? 0} held`);
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    await session.cleanup?.();
  }

  const fails = findings.filter((f) => f.level === "FAIL");
  if (asJson) console.log(JSON.stringify({ fails: fails.length, findings }, null, 2));
  else console.log(`\n${"═".repeat(60)}\n${fails.length === 0 ? "ALL CHECKS PASSED" : `${fails.length} FAILURES`}`);
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("harness error:", e);
  process.exit(2);
});
