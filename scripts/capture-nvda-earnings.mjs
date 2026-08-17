#!/usr/bin/env node
import { chromium } from "playwright";
import crypto from "node:crypto";
import { createAuditClerkUser } from "./audit/lib/clerk-audit-user.mjs";

const SECRET = process.env.CLERK_SECRET_KEY?.trim();
const ART = "/opt/cursor/artifacts/meridian-screenshots";

async function clerk(path, init = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  return res.json();
}

const tag = crypto.randomBytes(4).toString("hex");
const created = await createAuditClerkUser({
  secret: SECRET,
  email: `nvda-cap-${tag}@blackouttrades.com`,
  publicMetadata: { role: "admin", tier: "premium", tier_managed_by: "admin" },
  adopt: false,
  extraBody: { skip_password_checks: true },
});
const { token } = await clerk("/sign_in_tokens", {
  method: "POST",
  body: JSON.stringify({ user_id: created.userId, expires_in_seconds: 600 }),
});

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`https://blackouttrades.com/sign-in?__clerk_ticket=${encodeURIComponent(token)}`, {
  waitUntil: "domcontentloaded",
  timeout: 120_000,
});
await page.waitForTimeout(2000);
await page.goto("https://blackouttrades.com/meridian", { waitUntil: "networkidle", timeout: 120_000 });
await page.locator(".meridian-search-input").fill("NVDA");
await page.waitForTimeout(1000);
await page.locator(".meridian-timeline-row").filter({ hasText: "NVDA" }).first().click();
await page.waitForTimeout(12000);
await page.screenshot({ path: `${ART}/07-nvda-earnings-full.png`, fullPage: true });
console.log(`✓ ${ART}/07-nvda-earnings-full.png`);
console.log("Dark pool:", await page.locator(".meridian-data-card-label", { hasText: "Dark pool" }).count());
console.log("Thermal:", await page.locator(".meridian-data-card-label", { hasText: "Thermal king" }).count());
console.log("Flow:", await page.locator(".meridian-data-card-label", { hasText: "HELIX flow" }).count());
console.log("Play read:", await page.locator(".meridian-analytics-banner-label", { hasText: "Play read" }).count());
await browser.close();
await clerk(`/users/${created.userId}`, { method: "DELETE" });
