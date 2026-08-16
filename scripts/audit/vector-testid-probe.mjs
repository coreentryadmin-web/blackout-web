/**
 * How many elements carry each Vector data-testid, and which of them are actually laid out?
 *
 * WHY: the interaction harness resolved `[data-testid=X].first()` to a 0x0 element at 0,0 and
 * reported "click never landed" for six controls. Before that becomes a product finding it has to
 * be ruled out as a locator bug — a desk that renders BOTH a desktop and a phone toolbar has two
 * elements per testid, and `.first()` picks whichever is earlier in the DOM, hidden or not.
 */
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const IDS = [
  "vector-dte-0dte", "vector-dte-weekly", "vector-dte-monthly",
  "vector-draw-tools-trigger", "vector-indicator-trigger", "vector-enter-compare",
  "vector-ticker-search", "vector-tf-select", "vector-lens-gex", "vector-lens-vex",
  "vector-page-toolbar", "vector-draw-toolbar",
];

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`HARNESS/AUTH ERROR: ${session.reason}`); process.exitCode = 1; return; }
  let browser;
  try {
    const url = `${BASE}/vector?ticker=SPY`;
    const t = await createTunneledContext({ url, cookie: session.cookieHeader, viewport: "1440x900", desktop: true });
    browser = t.browser;
    const page = await t.ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(12_000);

    const rows = await page.evaluate((ids) => {
      const out = [];
      for (const id of ids) {
        const els = [...document.querySelectorAll(`[data-testid="${id}"]`)];
        out.push({
          id,
          count: els.length,
          instances: els.map((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            // Walk up to find the ancestor that is hiding it — that is the actionable detail.
            let hider = null;
            for (let n = el; n && n !== document.body; n = n.parentElement) {
              const cs = getComputedStyle(n);
              if (cs.display === "none" || cs.visibility === "hidden" || cs.contentVisibility === "hidden") {
                hider = `${n.tagName.toLowerCase()}.${String(n.className || "").split(/\s+/).slice(0, 3).join(".")} (${cs.display}/${cs.visibility})`;
                break;
              }
            }
            return {
              box: `${Math.round(r.width)}x${Math.round(r.height)}`,
              at: `${Math.round(r.left)},${Math.round(r.top)}`,
              disp: s.display,
              hider,
            };
          }),
        });
      }
      return out;
    }, IDS);

    for (const r of rows) {
      const laidOut = r.instances.filter((i) => i.box !== "0x0").length;
      console.log(`${r.id.padEnd(30)} count=${r.count} laidOut=${laidOut}`);
      r.instances.forEach((i, n) =>
        console.log(`   [${n}] ${i.box} at ${i.at} display=${i.disp}${i.hider ? `  HIDDEN-BY ${i.hider}` : ""}`)
      );
    }
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
}
main().catch((e) => { console.error("HARNESS ERROR:", e?.message || e); process.exitCode = 1; });
