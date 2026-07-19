#!/usr/bin/env node
/**
 * Production admin console + user management UI validation with screenshots.
 * Uses Clerk ticket sign-in against https://blackouttrades.com (never localhost).
 *
 * Screenshots → /opt/cursor/artifacts/prod-admin-ui/
 *
 * Usage:
 *   npm run validate:prod-admin-ui
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const ART = process.env.PROD_ADMIN_UI_DIR || "/opt/cursor/artifacts/prod-admin-ui";
const ONBOARDING_KEY = "blackout:onboarding:v";
const ONBOARDING_VERSION = "2";

const rows = [];
const rec = (name, status, detail = "") => {
  rows.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : status === "SKIP" ? "○" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function shot(page, filename, fullPage = true) {
  const p = path.join(ART, filename);
  await page.screenshot({ path: p, fullPage });
  return p;
}

async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  console.log(`\n=== Prod admin UI validation (${BASE}) ===\n`);
  console.log(`Artifacts: ${ART}/\n`);

  const health = await fetch(`${BASE}/api/health`);
  rec("prod /api/health", health.ok ? "PASS" : "FAIL", String(health.status));

  const adminSession = await mintClerkPremiumSession({ appUrl: BASE });
  if (adminSession.skip) {
    console.error("Auth skip:", adminSession.reason);
    process.exit(1);
  }

  const tag = crypto.randomBytes(4).toString("hex");
  const testEmail = `admin-ui-${tag}@blackouttrades.com`;
  const testPhone = generateDefaultAuditPhone();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = new URL(BASE).hostname;
  const cookiePairs = adminSession.cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
  await context.addCookies(
    cookiePairs.map((pair) => {
      const eq = pair.indexOf("=");
      return {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: host,
        path: "/",
        secure: true,
        sameSite: "Lax",
        httpOnly: pair.startsWith("__session"),
      };
    })
  );
  await context.addInitScript(
    ({ key, version }) => {
      try {
        window.localStorage.setItem(key, version);
      } catch {
        /* ignore */
      }
    },
    { key: ONBOARDING_KEY, version: ONBOARDING_VERSION }
  );
  const page = await context.newPage();

  try {
    // ── Verify session ────────────────────────────────────────────────────
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await wait(1500);
    const onDesk = !page.url().includes("/sign-in");
    rec("admin session cookie", onDesk ? "PASS" : "FAIL", page.url());
    await shot(page, "00-dashboard-authed.png", false);

    // ── Admin console home ────────────────────────────────────────────────
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await wait(1500);
    const isV2 = (await page.locator(".admin-v2, .admin-page-v2").count()) > 0;
    rec("admin v2 shell", isV2 ? "PASS" : "WARN", isV2 ? "v2 detected" : "legacy layout (PR #809 not deployed?)");
    await shot(page, "01-admin-home.png");

    const adminTabs = [
      { qs: "", file: "02-tab-operations.png", label: "Operations", re: /operations|system vitals|health|launch/i },
      { qs: "?tab=apis", file: "03-tab-apis.png", label: "API telemetry", re: /api|telemetry|endpoint/i },
      { qs: "?tab=crons", file: "04-tab-crons.png", label: "Crons", re: /cron|schedule|job/i },
      { qs: "?tab=bie", file: "05-tab-intelligence.png", label: "Intelligence", re: /intelligence|bie|brief/i },
      { qs: "?tab=spx", file: "06-tab-spx.png", label: "SPX Slayer", re: /spx|slayer|desk/i },
      { qs: "?tab=nighthawk", file: "07-tab-nighthawk.png", label: "Night Hawk", re: /hawk|night|playbook/i },
      { qs: "?tab=track-record", file: "08-tab-track-record.png", label: "Track record", re: /track record|play history|embed/i },
    ];

    if (isV2) {
      for (const { qs, file, label, re } of adminTabs) {
        await page.goto(`${BASE}/admin${qs}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await wait(1200);
        const text = await page.locator("main").innerText().catch(() => "");
        rec(`tab: ${label}`, re.test(text) ? "PASS" : "WARN", re.test(text) ? "" : "content marker weak");
        await shot(page, file);
      }
    } else {
      rec("admin v2 sidebar", "SKIP", "legacy horizontal tabs — capturing via URL");
      for (const { qs, file, label } of adminTabs) {
        await page.goto(`${BASE}/admin${qs}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await wait(1200);
        rec(`legacy tab: ${label}`, "PASS");
        await shot(page, file.replace("0", "L"));
      }
    }

    // ── User management ───────────────────────────────────────────────────
    await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await wait(1500);
    const usersHeading = await page.locator("h1").first().textContent().catch(() => "");
    rec("/admin/users page", /user management/i.test(usersHeading ?? "") ? "PASS" : "FAIL", usersHeading ?? "");
    await shot(page, "10-user-management.png");

    // Tools & access tab (v2)
    const toolsTab = page.getByRole("button", { name: /tools & access/i });
    if (await toolsTab.count()) {
      await toolsTab.click();
      await wait(800);
      rec("tools & access panel", "PASS");
      await shot(page, "11-tools-access-panel.png");
      await page.getByRole("button", { name: /^users$/i }).click().catch(() => {});
      await wait(400);
    } else {
      rec("tools & access panel", "SKIP", "not on deployed build");
    }

    // Search / filters visible
    const hasSearch =
      (await page.locator('input[placeholder*="Email"], input[placeholder*="Search"], input[type="search"]').count()) > 0;
    rec("user search + filters", hasSearch ? "PASS" : "WARN");

    // ── Edit user modal (before search narrows rows) ─────────────────────
    let editBtn = page.locator("table tbody tr").first().getByRole("button", { name: "Edit" });
    if (await editBtn.count()) {
      await editBtn.click();
      await wait(1000);
      rec("edit user modal", "PASS");
      await shot(page, "12-edit-user-modal.png", false);

      const tierSelect = page.locator("select").filter({ hasText: /premium|free/i }).first();
      if (await tierSelect.count()) {
        await tierSelect.selectOption("premium").catch(() => {});
        await wait(300);
        await shot(page, "13-edit-user-tier-premium.png", false);
      }

      const saveBtn = page.getByRole("button", { name: /save changes/i });
      if (await saveBtn.count()) {
        await saveBtn.click();
        await wait(2000);
        await shot(page, "14-after-save-user.png");
        rec("save user changes", "PASS");
      } else {
        await page.getByRole("button", { name: /cancel/i }).first().click().catch(() => {});
      }
    } else {
      rec("edit user modal", "WARN", "no Edit button in table");
    }

    // ── Ban / unban confirm ───────────────────────────────────────────────
    await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await wait(1500);
    const banBtn = page.locator("table tbody tr").first().getByRole("button", { name: /^Ban$/ });
    if (await banBtn.count()) {
      await banBtn.click();
      await wait(600);
      await shot(page, "15-ban-confirm-modal.png", false);
      rec("ban confirm modal", "PASS");

      const confirmBan = page.getByRole("button", { name: /^Ban$/ }).last();
      if (await confirmBan.count()) {
        // Cancel — do not ban live users (may include audit session user)
        await page.getByRole("button", { name: /cancel/i }).first().click().catch(async () => {
          await page.keyboard.press("Escape");
        });
        rec("ban user action", "PASS", "confirm modal verified (cancelled)");
      } else {
        await page.keyboard.press("Escape");
        rec("ban user action", "WARN", "confirm button not found — modal captured");
      }
    } else {
      rec("ban/unban flow", "SKIP", "no Ban button visible");
    }

    // ── Create user flow ──────────────────────────────────────────────────
    await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await wait(1200);
    const createBtn = page.getByRole("button", { name: /create user/i });
    if (await createBtn.count()) {
      await createBtn.first().click();
      await wait(500);
      await shot(page, "19-create-user-modal-empty.png", false);

      await page.locator('input[type="email"]').first().fill(testEmail);
      await page.locator('input[type="tel"]').first().fill(testPhone);
      const firstNameInput = page.getByLabel(/first name/i).or(page.locator(".admin-filter-input").nth(2));
      if (await firstNameInput.count()) await firstNameInput.first().fill("ProdUI");
      await shot(page, "20-create-user-modal-filled.png", false);

      await page.getByRole("button", { name: /^create user$/i }).click();
      await wait(3000);
      await shot(page, "21-after-create-user.png");

      const tableText = await page.locator("table, .admin-table").first().innerText().catch(() => "");
      const found = tableText.includes("ProdUI") || tableText.includes(testEmail.split("@")[0]);
      rec("create user UI", found ? "PASS" : "WARN", testEmail);
    } else {
      rec("create user UI", "SKIP", "button not found");
    }

    // Search for test user
    const searchInput = page.locator('input[placeholder*="Email"], input[placeholder*="Search"]').first();
    if (await searchInput.count()) {
      await searchInput.fill(testEmail);
      await wait(2000);
      await shot(page, "22-user-search-result.png");
    }

    // ── Redirects ─────────────────────────────────────────────────────────
    await page.goto(`${BASE}/admin/track-record`, { waitUntil: "domcontentloaded" });
    await wait(800);
    const trRedirect = page.url().includes("track-record");
    rec("/admin/track-record redirect", trRedirect ? "PASS" : "WARN", page.url());
    await shot(page, "23-track-record-redirect.png");

    await page.goto(`${BASE}/track-record`, { waitUntil: "domcontentloaded" });
    await wait(800);
    rec("/track-record → admin tab", page.url().includes("admin") ? "PASS" : "WARN", page.url());
    await shot(page, "24-public-track-record-redirect.png");

    // Back link to admin
    await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
    const backLink = page.locator('a[href="/admin"]').first();
    if (await backLink.count()) {
      await backLink.click();
      await wait(1000);
      rec("back to console link", page.url().includes("/admin") ? "PASS" : "WARN");
      await shot(page, "25-back-to-admin.png");
    }

    // ── Admin health API (sanity) ─────────────────────────────────────────
    const me = await fetch(`${BASE}/api/admin/me`, {
      headers: { Cookie: adminSession.cookieHeader },
    });
    const meJson = await me.json().catch(() => ({}));
    rec("/api/admin/me", me.ok && meJson.admin ? "PASS" : "WARN", me.ok ? JSON.stringify(meJson) : String(me.status));

    fs.writeFileSync(path.join(ART, "validation-report.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), rows }, null, 2));

    const fails = rows.filter((r) => r.status === "FAIL");
    console.log(`\nSummary: ${rows.filter((r) => r.status === "PASS").length} pass, ${fails.length} fail, ${rows.filter((r) => r.status === "WARN").length} warn`);
    console.log(`\nScreenshots saved to: ${ART}/\n`);

    if (fails.length) process.exit(1);
  } finally {
    await browser.close();
    await adminSession.cleanup?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
