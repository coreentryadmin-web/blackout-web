/**
 * ONE DRAWING TOOL PER PAGE LOAD.
 *
 * The batch harness reported trend/rect/fib failing and hline/ray/text/vline passing — a perfect
 * alternation by position in the loop, which is the signature of state leaking between iterations
 * rather than of three independently broken tools. This isolates each tool on its own fresh page so
 * the result describes the TOOL and nothing else.
 */
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const TOOLS = (process.argv.find((a) => a.startsWith("--tools="))?.split("=")[1] || "hline,trend,ray,rect,text,fib,vline").split(",");
const TICKER = process.argv.find((a) => a.startsWith("--ticker="))?.split("=")[1] || "SPY";

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`HARNESS/AUTH ERROR: ${session.reason}`); process.exitCode = 1; return; }
  const url = `${BASE}/vector?ticker=${TICKER}`;
  let browser;
  const results = [];
  try {
    const t = await createTunneledContext({ url, cookie: session.cookieHeader, viewport: "1440x900", desktop: true });
    browser = t.browser;
    const dom = new URL(BASE).hostname;
    setInterval(async () => {
      const n = await session.refresh?.().catch(() => null);
      if (n?.cookieHeader) {
        await t.ctx.addCookies(n.cookieHeader.split(";").map((kv) => {
          const i = kv.indexOf("="); return { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), domain: dom, path: "/" };
        })).catch(() => {});
      }
    }, 45_000).unref?.();

    for (const tool of TOOLS) {
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
          await page.waitForTimeout(1000);
        }
      };

      await openTools();
      const before = await readInk();
      const btn = page.locator(`[data-testid="vector-draw-tool-${tool}"]:visible`).first();
      if ((await btn.count()) === 0) { results.push({ tool, verdict: "TOOL BUTTON ABSENT" }); await page.close(); continue; }
      await btn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);

      if (tool === "text") {
        const inp = page.locator('[data-testid="vector-draw-text-input"]:visible').first();
        if (await inp.count()) { await inp.fill("ISO TEXT").catch(() => {}); await page.waitForTimeout(300); }
      }

      const b = await page.locator("canvas").first().boundingBox();
      const x1 = b.x + b.width * 0.35, y1 = b.y + b.height * 0.45;
      const x2 = b.x + b.width * 0.62, y2 = b.y + b.height * 0.58;
      const onePoint = tool === "hline" || tool === "vline" || tool === "text";
      await page.mouse.click(x1, y1);
      await page.waitForTimeout(600);
      if (!onePoint) { await page.mouse.click(x2, y2); await page.waitForTimeout(600); }
      await page.waitForTimeout(1200);

      await openTools();
      const after = await readInk();
      const verdict = after != null && before != null && after > before ? "OK" : "NO INK";
      results.push({ tool, before, after, verdict, points: onePoint ? 1 : 2, errs: [...new Set(errs)].slice(0, 2) });
      console.log(`${tool.padEnd(7)} ${String(before)} -> ${String(after)}  ${verdict}${verdict === "OK" ? "" : `   errs=${[...new Set(errs)].slice(0, 1).join("|") || "none"}`}`);
      await page.close();
    }
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
  const bad = results.filter((r) => r.verdict !== "OK");
  console.log(`\nISOLATED RESULT: ${results.length - bad.length}/${results.length} tools create a drawing`);
  if (bad.length) console.log(`FAILING IN ISOLATION: ${bad.map((b) => b.tool).join(", ")}`);
}
main().catch((e) => { console.error("HARNESS ERROR:", e?.message || e); process.exitCode = 1; });
