/**
 * VECTOR DEEP UI AUDIT — stage 1: CONTROL DISCOVERY.
 *
 * Enumerates what is actually on the live /vector desk (buttons, roles, labels, canvases, inputs)
 * so the interaction pass that follows drives REAL selectors instead of guessed ones. Guessing a
 * selector and reporting "control not found" as a product defect is the single easiest way to
 * manufacture a phantom bug — the harness must prove the page loaded before it judges a feature.
 *
 * Read-only. One temp Clerk user, deleted in a finally.
 * Run from the REPO ROOT with NODE_USE_ENV_PROXY=1.
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const require = createRequire(import.meta.url);
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = "/tmp/claude-0/-home-user/4e81061a-28b0-5b7a-b55b-1ebd214f8951/scratchpad/vector-audit";
mkdirSync(OUT, { recursive: true });

const TICKER = process.argv.find((a) => a.startsWith("--ticker="))?.split("=")[1] || "SPY";
const DESKTOP = !process.argv.includes("--phone");

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

async function main() {
  console.log(`market phase: ${marketPhaseEt()}`);
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`HARNESS/AUTH ERROR — could not mint a session: ${session.reason}. NOT a product signal.`);
    process.exitCode = 1;
    return;
  }

  let browser;
  try {
    const url = `${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`;
    const t = await createTunneledContext({
      url,
      cookie: session.cookieHeader,
      viewport: DESKTOP ? "1440x900" : "430x932",
      desktop: DESKTOP,
    });
    browser = t.browser;
    const page = await t.ctx.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(12_000); // charts + SSE seed

    // GUARD FIRST: prove the desk rendered before judging any feature. Without this, a 404, an auth
    // bounce and a genuinely missing control are indistinguishable — all three read as "not found".
    const title = await page.title();
    const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
    const canvasCount = await page.locator("canvas").count();
    const loaded = canvasCount > 0;
    console.log(`title: ${title}`);
    console.log(`canvases: ${canvasCount}  -> page ${loaded ? "LOADED" : "DID NOT RENDER A CHART"}`);
    if (!loaded) {
      console.log(`body head: ${bodyText.replace(/\s+/g, " ").slice(0, 300)}`);
    }

    const inventory = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const label = (el) =>
        (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
      const out = { buttons: [], selects: [], inputs: [], roles: {}, canvases: [], testids: [] };
      for (const el of document.querySelectorAll("button")) {
        if (!vis(el)) continue;
        out.buttons.push({
          label: label(el),
          pressed: el.getAttribute("aria-pressed"),
          expanded: el.getAttribute("aria-expanded"),
          disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
          cls: (el.className || "").toString().split(/\s+/).slice(0, 3).join(" "),
        });
      }
      for (const el of document.querySelectorAll("select")) {
        if (!vis(el)) continue;
        out.selects.push({ label: label(el), options: [...el.options].map((o) => o.text).slice(0, 20) });
      }
      for (const el of document.querySelectorAll("input")) {
        if (!vis(el)) continue;
        out.inputs.push({ type: el.type, placeholder: el.placeholder, label: label(el) });
      }
      for (const el of document.querySelectorAll("[role]")) {
        if (!vis(el)) continue;
        const r = el.getAttribute("role");
        out.roles[r] = (out.roles[r] || 0) + 1;
      }
      for (const el of document.querySelectorAll("canvas")) {
        const r = el.getBoundingClientRect();
        out.canvases.push({ w: Math.round(r.width), h: Math.round(r.height) });
      }
      for (const el of document.querySelectorAll("[data-testid]")) {
        if (vis(el)) out.testids.push(el.getAttribute("data-testid"));
      }
      return out;
    });

    console.log(`\n=== BUTTONS (${inventory.buttons.length}) ===`);
    inventory.buttons.forEach((b, i) =>
      console.log(
        `${String(i).padStart(3)} "${b.label}"${b.pressed != null ? ` pressed=${b.pressed}` : ""}` +
          `${b.expanded != null ? ` expanded=${b.expanded}` : ""}${b.disabled ? " DISABLED" : ""}`
      )
    );
    console.log(`\n=== SELECTS (${inventory.selects.length}) ===`);
    inventory.selects.forEach((s) => console.log(`  "${s.label}" -> ${s.options.join(" | ")}`));
    console.log(`\n=== INPUTS (${inventory.inputs.length}) ===`);
    inventory.inputs.forEach((s) => console.log(`  type=${s.type} ph="${s.placeholder}" label="${s.label}"`));
    console.log(`\n=== ROLES ===\n  ${JSON.stringify(inventory.roles)}`);
    console.log(`\n=== CANVASES ===\n  ${inventory.canvases.map((c) => `${c.w}x${c.h}`).join(", ")}`);
    console.log(`\n=== data-testid (${inventory.testids.length}) ===\n  ${[...new Set(inventory.testids)].join(", ")}`);

    console.log(`\n=== CONSOLE ERRORS (${consoleErrors.length}) ===`);
    [...new Set(consoleErrors)].slice(0, 15).forEach((e) => console.log(`  ${e}`));
    console.log(`=== PAGE ERRORS (${pageErrors.length}) ===`);
    [...new Set(pageErrors)].slice(0, 15).forEach((e) => console.log(`  ${e}`));

    await page.screenshot({ path: `${OUT}/discovery-${TICKER}-${DESKTOP ? "desktop" : "phone"}.png` });
    writeFileSync(`${OUT}/inventory-${TICKER}.json`, JSON.stringify(inventory, null, 2));
    console.log(`\nscreenshot + inventory written to ${OUT}`);
  } finally {
    await browser?.close().catch(() => {});
    await session.cleanup?.().catch(() => {});
  }
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e?.message || e);
  process.exitCode = 1;
});
