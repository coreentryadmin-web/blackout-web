/**
 * SEQUENTIAL DRAWING — does the SECOND drawing in a row land?
 *
 * Every tool creates a drawing when tested alone (vector-draw-isolate.mjs: 7/7). In a sequence on
 * one page, alternate tools produced no ink. Members draw several annotations in a row, so if the
 * sequential case is broken that is a genuine product bug, not a harness artifact — and if instead
 * the harness needs an extra click to clear selection, that must be established rather than assumed.
 *
 * This records the ink count after EVERY individual click so the lost click can be located.
 */
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const SEQ = (process.argv.find((a) => a.startsWith("--seq="))?.split("=")[1] || "hline,trend,rect,fib").split(",");
const TICKER = process.argv.find((a) => a.startsWith("--ticker="))?.split("=")[1] || "SPY";

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`HARNESS/AUTH ERROR: ${session.reason}`); process.exitCode = 1; return; }
  const url = `${BASE}/vector?ticker=${TICKER}`;
  let browser;
  try {
    const t = await createTunneledContext({ url, cookie: session.cookieHeader, viewport: "1440x900", desktop: true });
    browser = t.browser;
    const page = await t.ctx.newPage();
    const errs = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(11_000);

    const readInk = async () => {
      const el = page.locator('[data-testid="vector-draw-count"]:visible').first();
      if ((await el.count()) === 0) return null;
      const m = ((await el.innerText().catch(() => "")) || "").match(/(\d+)/);
      return m ? Number(m[1]) : null;
    };
    const openTools = async () => {
      if ((await page.locator('[data-testid="vector-draw-tool-hline"]:visible').count()) === 0) {
        await page.locator('[data-testid="vector-draw-tools-trigger"]:visible').first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(900);
      }
    };
    const activeTool = async () => page.evaluate(() => {
      const el = document.querySelector('[data-testid^="vector-draw-tool-"][aria-pressed="true"]');
      return el ? el.getAttribute("data-testid").replace("vector-draw-tool-", "") : null;
    });

    await openTools();
    console.log(`start ink=${await readInk()} activeTool=${await activeTool()}`);

    const b = await page.locator("canvas").first().boundingBox();
    let step = 0;
    for (const tool of SEQ) {
      step += 1;
      await openTools();
      await page.locator(`[data-testid="vector-draw-tool-${tool}"]:visible`).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      const armed = await activeTool();
      if (tool === "text") {
        const inp = page.locator('[data-testid="vector-draw-text-input"]:visible').first();
        if (await inp.count()) await inp.fill(`SEQ ${step}`).catch(() => {});
      }
      const yb = 0.18 + step * 0.11;
      const x1 = b.x + b.width * 0.3, y1 = b.y + b.height * yb;
      const x2 = b.x + b.width * 0.6, y2 = b.y + b.height * (yb + 0.04);
      const onePoint = tool === "hline" || tool === "vline" || tool === "text";

      const inkBefore = await readInk();
      await page.mouse.click(x1, y1);
      await page.waitForTimeout(900);
      await openTools();
      const inkAfter1 = await readInk();
      let inkAfter2 = inkAfter1;
      if (!onePoint) {
        await page.mouse.click(x2, y2);
        await page.waitForTimeout(900);
        await openTools();
        inkAfter2 = await readInk();
      }
      const ok = inkAfter2 != null && inkBefore != null && inkAfter2 > inkBefore;
      console.log(
        `${step}. ${tool.padEnd(6)} armed=${String(armed).padEnd(6)} ink ${inkBefore} -> click1 ${inkAfter1}` +
        `${onePoint ? "" : ` -> click2 ${inkAfter2}`}   ${ok ? "OK" : "*** NO INK ***"}`
      );
    }
    console.log(`\nconsole errors: ${[...new Set(errs)].slice(0, 3).join(" | ") || "none"}`);
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
}
main().catch((e) => { console.error("HARNESS ERROR:", e?.message || e); process.exitCode = 1; });
