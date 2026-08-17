#!/usr/bin/env node
/**
 * Extended Meridian live capture — search bar, earnings intel cards, OpEx.
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import { createAuditClerkUser } from "./audit/lib/clerk-audit-user.mjs";

const BASE = (process.env.VALIDATE_BASE ?? "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY?.trim();
const ART = process.env.MERIDIAN_ART ?? "/opt/cursor/artifacts/meridian-screenshots";

async function clerk(apiPath, init = {}) {
  const res = await fetch(`https://api.clerk.com/v1${apiPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${apiPath} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function mintAdminTicket() {
  const tag = crypto.randomBytes(4).toString("hex");
  const created = await createAuditClerkUser({
    secret: SECRET,
    email: `meridian-live-${tag}@blackouttrades.com`,
    publicMetadata: { role: "admin", tier: "premium", tier_managed_by: "admin" },
    adopt: false,
    extraBody: { skip_password_checks: true },
  });
  if (!created.userId) throw new Error(String(created.error));
  const token = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: created.userId, expires_in_seconds: 600 }),
  });
  return { userId: created.userId, ticket: token.token };
}

async function main() {
  if (!SECRET) {
    console.error("CLERK_SECRET_KEY required");
    process.exit(1);
  }

  fs.mkdirSync(ART, { recursive: true });
  const { userId, ticket } = await mintAdminTicket();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("blackout:onboarding:v", "2");
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();

  const report = [];

  try {
    await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForTimeout(2500);

    await page.goto(`${BASE}/meridian`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(4000);

    const searchVisible = (await page.locator(".meridian-search-input").count()) > 0;
    report.push(`Search bar: ${searchVisible ? "YES" : "NO"}`);
    await page.screenshot({ path: `${ART}/01-meridian-desk-search.png`, fullPage: true });
    console.log(`✓ ${ART}/01-meridian-desk-search.png`);

    if (searchVisible) {
      await page.locator(".meridian-search-input").fill("NVDA");
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${ART}/02-meridian-search-nvda.png`, fullPage: true });
      console.log(`✓ ${ART}/02-meridian-search-nvda.png`);
      await page.locator(".meridian-search-clear").click().catch(() => {});
      await page.waitForTimeout(500);
    }

    const earningsPill = page.getByRole("tab", { name: /Earnings/i });
    if ((await earningsPill.count()) > 0) {
      await earningsPill.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${ART}/03-meridian-earnings-filter.png`, fullPage: true });
      console.log(`✓ ${ART}/03-meridian-earnings-filter.png`);
    }

    const earnRow = page.locator(".meridian-timeline-row").filter({ hasText: /earnings/i }).first();
    if ((await earnRow.count()) === 0) {
      await page.locator(".meridian-timeline-row").first().click();
    } else {
      await earnRow.click();
    }
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${ART}/04-meridian-earnings-detail-top.png`, fullPage: false });
    console.log(`✓ ${ART}/04-meridian-earnings-detail-top.png`);

    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${ART}/05-meridian-earnings-detail-intel.png`, fullPage: false });
    console.log(`✓ ${ART}/05-meridian-earnings-detail-intel.png`);

    const verdict = await page.locator(".meridian-report-verdict").first().textContent().catch(() => null);
    const playRead = (await page.locator(".meridian-analytics-banner-label", { hasText: "Play read" }).count()) > 0;
    const darkPool = (await page.locator(".meridian-data-card-label", { hasText: "Dark pool" }).count()) > 0;
    const thermal = (await page.locator(".meridian-data-card-label", { hasText: "Thermal king" }).count()) > 0;
    const flow = (await page.locator(".meridian-data-card-label", { hasText: "HELIX flow" }).count()) > 0;
    report.push(`Report verdict: ${verdict ?? "not visible"}`);
    report.push(`Play read: ${playRead ? "YES" : "NO"}`);
    report.push(`Dark pool card: ${darkPool ? "YES" : "NO"}`);
    report.push(`Thermal card: ${thermal ? "YES" : "NO"}`);
    report.push(`HELIX flow card: ${flow ? "YES" : "NO"}`);

    const opexPill = page.getByRole("tab", { name: /^OpEx/i });
    if ((await opexPill.count()) > 0) {
      await opexPill.click();
      await page.waitForTimeout(1000);
      const opexRow = page.locator(".meridian-timeline-row").first();
      if ((await opexRow.count()) > 0) {
        await opexRow.click();
        await page.waitForTimeout(4000);
        await page.screenshot({ path: `${ART}/06-meridian-opex-cross-market.png`, fullPage: true });
        console.log(`✓ ${ART}/06-meridian-opex-cross-market.png`);
        report.push(`OpEx cross-market: ${(await page.locator(".meridian-opex-table").count()) > 0 ? "YES" : "NO"}`);
      }
    }

    console.log("\n--- Live UI report ---");
    for (const line of report) console.log(line);
  } finally {
    await browser.close();
    try {
      await clerk(`/users/${userId}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
