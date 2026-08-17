#!/usr/bin/env node
/**
 * Admin auth → Meridian desk + Features dropdown screenshots.
 * Output: /opt/cursor/artifacts/meridian-screenshots/
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
    email: `meridian-cap-${tag}@blackouttrades.com`,
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

  try {
    await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForTimeout(3000);

    await page.goto(`${BASE}/meridian`, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${ART}/meridian-desk-full.png`, fullPage: true });
    console.log(`✓ ${ART}/meridian-desk-full.png`);

    const title = await page.locator(".meridian-hero-title-main, .meridian-rail-title").first().textContent().catch(() => null);
    const earnRow = page.locator('.meridian-timeline-row[data-kind="earnings"], .meridian-row[data-kind="earnings"]');
    const rows = page.locator(".meridian-timeline-row, .meridian-row");
    const clickTarget = (await earnRow.count()) > 0 ? earnRow.first() : rows.first();
    if ((await clickTarget.count()) > 0) {
      await clickTarget.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${ART}/meridian-event-detail.png`, fullPage: true });
      console.log(`✓ ${ART}/meridian-event-detail.png`);
      const playRead = await page.locator(".meridian-analytics-banner-label", { hasText: "Play read" }).count();
      const darkPool = await page.locator(".meridian-data-card-label", { hasText: "Dark pool" }).count();
      console.log(`Play read banner visible: ${playRead > 0 ? "yes" : "no"}`);
      console.log(`Dark pool card visible: ${darkPool > 0 ? "yes" : "no"}`);
    }

    const analyticsTab = page.getByRole("tab", { name: /Analytics grid/i });
    if ((await analyticsTab.count()) > 0) {
      await analyticsTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${ART}/meridian-analytics-grid.png`, fullPage: true });
      console.log(`✓ ${ART}/meridian-analytics-grid.png`);
    }

    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByRole("button", { name: /Features/i }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${ART}/meridian-features-dropdown.png`, fullPage: false });
    console.log(`✓ ${ART}/meridian-features-dropdown.png`);

    const meridianCard = page.locator('a[href="/meridian"]');
    console.log(`Meridian in dropdown: ${(await meridianCard.count()) > 0 ? "yes" : "no"}`);
    console.log(`Page title visible: ${title ?? "(check screenshot)"}`);
  } finally {
    await browser.close();
    try {
      await clerk(`/users/${userId}`, { method: "DELETE" });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
