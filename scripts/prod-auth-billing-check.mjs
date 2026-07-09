#!/usr/bin/env node
import { chromium } from "playwright";

const BASE = "https://blackouttrades.com";
const pages = [
  { path: "/sign-in", name: "sign-in", ready: ".cl-card, .cl-rootBox, input[type=email], input[name=identifier]" },
  { path: "/sign-up", name: "sign-up", ready: ".cl-card, .cl-rootBox, input[type=email], input[name=emailAddress]" },
  { path: "/upgrade", name: "upgrade", ready: "a[href*='whop'], a[href*='checkout'], .plan-ladder, button" },
  { path: "/pricing", name: "pricing", ready: "a[href*='whop'], a[href*='checkout'], a[href*='sign']" },
];

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
let failed = 0;

for (const { path, name, ready } of pages) {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`));

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(7000);

  const readyCount = await page.locator(ready).count();
  const links = await page.locator("a[href]").evaluateAll((els) =>
    els.map((e) => ({
      text: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      href: e.getAttribute("href"),
    }))
  );
  const whopLinks = links.filter((l) => /whop|checkout/i.test(l.href || ""));
  const body = await page.locator("body").innerText();
  const offline = /checkout offline|stand by|billing@/i.test(body);

  console.log(`\n=== ${name} ===`);
  console.log(`ready elements: ${readyCount}`);
  console.log(`js errors: ${errors.length}`);
  if (errors.length) errors.slice(0, 6).forEach((e) => console.log(`  ERR: ${e.slice(0, 160)}`));
  console.log(`whop/checkout links: ${whopLinks.length}`);
  whopLinks.slice(0, 5).forEach((l) => console.log(`  ${l.text} -> ${l.href}`));
  if (offline) console.log("  WARN: checkout offline message visible");
  if (name.startsWith("sign") && readyCount === 0) failed++;
  if ((name === "upgrade" || name === "pricing") && whopLinks.length === 0 && offline) failed++;

  await page.screenshot({ path: `/opt/cursor/artifacts/billing-check-${name}.png`, fullPage: true });
  await page.close();
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
