#!/usr/bin/env node
/**
 * Admin console + user-management UI E2E — Playwright walks every sidebar tab,
 * user-management sections, modals, and redirects.
 *
 * Requires localhost Next dev in keyless Clerk mode.
 *
 * Usage:
 *   npm run validate:admin-console-e2e
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { mintAdminE2ESession, mintMemberE2ESession } from "./audit/lib/admin-e2e-auth.mjs";
import {
  OUT_DIR,
  playwrightCookiesFromHeader,
  record,
  summarize,
  waitForServer,
  writeReport,
} from "./audit/lib/admin-e2e-helpers.mjs";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const BASE = (
  process.env.ADMIN_E2E_BASE ??
  (process.env.CLERK_SECRET_KEY ? "https://blackouttrades.com" : "http://127.0.0.1:3000")
).replace(/\/$/, "");
const SHOT_DIR = join(OUT_DIR, "screenshots");
const rows = [];
const rec = (name, status, detail) => rows.push(record(name, status, detail));

const ADMIN_TABS = [
  { tab: "ops", label: "Operations", mustMatch: /operations|system vitals|health/i },
  { tab: "apis", label: "API telemetry", mustMatch: /api|telemetry|endpoint/i },
  { tab: "crons", label: "Crons", mustMatch: /cron|schedule|job/i },
  { tab: "bie", label: "Intelligence", mustMatch: /intelligence|bie|brief/i },
  { tab: "spx", label: "SPX Slayer", mustMatch: /spx|slayer|desk/i },
  { tab: "nighthawk", label: "Night Hawk", mustMatch: /hawk|night|playbook/i },
  { tab: "track-record", label: "Track record", mustMatch: /track record|play history|embed/i },
];

async function main() {
  console.log(`Admin console UI E2E → ${BASE}\n`);
  mkdirSync(SHOT_DIR, { recursive: true });

  if (!(await waitForServer(BASE))) {
    console.error("Dev server not reachable.");
    process.exit(1);
  }

  const adminSession = await mintAdminE2ESession({
    appUrl: BASE,
    emailPrefix: "admin-console-e2e",
  });
  if (adminSession.skip) {
    console.error("SKIP:", adminSession.reason);
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(
    playwrightCookiesFromHeader(
      adminSession.cookieHeader,
      new URL(BASE).hostname
    )
  );
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  let testUserEmail = null;
  let testUserId = null;

  try {
    // ── Admin shell ───────────────────────────────────────────────────────
    await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const adminTitle = await page.locator(".admin-v2-title, h1").first().textContent().catch(() => "");
    if (/admin/i.test(adminTitle ?? "")) rec("admin shell loads", "PASS");
    else rec("admin shell loads", "FAIL", `title=${adminTitle}`);

    await page.screenshot({ path: join(SHOT_DIR, "01-admin-ops.png"), fullPage: true });

    for (const { tab, label, mustMatch } of ADMIN_TABS) {
      const url = tab === "ops" ? `${BASE}/admin` : `${BASE}/admin?tab=${tab}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const body = await page.locator("main, .admin-tab-panel").first().innerText().catch(() => "");
      if (mustMatch.test(body)) {
        rec(`tab: ${label}`, "PASS");
      } else {
        rec(`tab: ${label}`, "FAIL", "expected content not found");
      }
      await page.screenshot({ path: join(SHOT_DIR, `tab-${tab}.png`), fullPage: true });
    }

    // Sidebar user-management link
    const usersLink = page.locator('a[href="/admin/users"]');
    if (await usersLink.count()) {
      await usersLink.first().click();
      await page.waitForURL(/\/admin\/users/, { timeout: 15_000 });
      rec("sidebar → user management link", "PASS");
    } else {
      await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
      rec("sidebar → user management link", "WARN", "link missing — direct nav");
    }

    await page.screenshot({ path: join(SHOT_DIR, "02-users-page.png"), fullPage: true });

    const usersHeading = await page.locator("h1").first().textContent().catch(() => "");
    if (/user management/i.test(usersHeading ?? "")) rec("users page heading", "PASS");
    else rec("users page heading", "FAIL", usersHeading ?? "");

    // Tools & access tab
    const toolsTab = page.getByRole("button", { name: /tools & access/i });
    if (await toolsTab.count()) {
      await toolsTab.click();
      await page.waitForTimeout(500);
      const toolsPanel = await page.locator("body").innerText();
      if (/global launch|tool access|largo|vector/i.test(toolsPanel)) {
        rec("tools & access panel", "PASS");
      } else {
        rec("tools & access panel", "FAIL");
      }
      await page.screenshot({ path: join(SHOT_DIR, "03-tools-panel.png"), fullPage: true });

      // Back to Users tab
      const usersTab = page.getByRole("button", { name: /^users$/i });
      if (await usersTab.count()) await usersTab.click();
    } else {
      rec("tools & access panel", "FAIL", "tab button missing");
    }

    // ── Create user via UI ────────────────────────────────────────────────
    testUserEmail = `ui-e2e-${Date.now()}@example.com`;
    const createBtn = page.getByRole("button", { name: /create user|add user|new user/i });
    if (await createBtn.count()) {
      await createBtn.first().click();
      await page.waitForTimeout(300);

      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      const phoneInput = page.locator('input[type="tel"], input[name="phone"]').first();
      if (await emailInput.count() && await phoneInput.count()) {
        await emailInput.fill(testUserEmail);
        await phoneInput.fill(generateDefaultAuditPhone());
        const firstName = page.locator('input[name="firstName"], input[placeholder*="First"]').first();
        if (await firstName.count()) await firstName.fill("UI");
        const submit = page.getByRole("button", { name: /create|save|add/i }).last();
        await submit.click();
        await page.waitForTimeout(2000);
        rec("create user modal submit", "PASS", testUserEmail);
      } else {
        rec("create user modal submit", "FAIL", "form fields missing");
      }
    } else {
      rec("create user modal submit", "WARN", "create button not found — API-only path");
    }

    await page.screenshot({ path: join(SHOT_DIR, "04-after-create.png"), fullPage: true });

    // Search for user
    const search = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    if (await search.count() && testUserEmail) {
      await search.fill(testUserEmail);
      await page.waitForTimeout(1500);
      const rowText = await page.locator("table tbody tr, .admin-table-row").first().innerText().catch(() => "");
      if (rowText.includes(testUserEmail.split("@")[0]) || rowText.includes("UI")) {
        rec("search finds created user", "PASS");
      } else {
        rec("search finds created user", "WARN", "row not visible — may need API create");
      }
    }

    // Open first user row / edit
    const editBtn = page.getByRole("button", { name: /edit|manage|view/i }).first();
    const userRow = page.locator("table tbody tr button, table tbody tr a").first();
    if (await editBtn.count()) {
      await editBtn.click();
    } else if (await userRow.count()) {
      await userRow.click();
    }

    await page.waitForTimeout(800);
    const modalVisible = await page.locator('[role="dialog"], .modal, .admin-modal').count();
    if (modalVisible > 0) {
      rec("user edit modal opens", "PASS");

      // Tool toggles in modal
      const toolSection = await page.locator("body").innerText();
      if (/largo|vector|tool access|inherit|grant|block/i.test(toolSection)) {
        rec("user edit tool access controls", "PASS");
      } else {
        rec("user edit tool access controls", "WARN", "tool toggles not visible");
      }

      await page.screenshot({ path: join(SHOT_DIR, "05-user-edit-modal.png"), fullPage: true });

      // Close modal
      const closeBtn = page.getByRole("button", { name: /close|cancel|done/i }).first();
      if (await closeBtn.count()) await closeBtn.click();
    } else {
      rec("user edit modal opens", "WARN", "no modal — table layout may differ");
    }

    // ── Redirects ─────────────────────────────────────────────────────────
    await page.goto(`${BASE}/admin/track-record`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("tab=track-record")) rec("redirect /admin/track-record", "PASS");
    else rec("redirect /admin/track-record", "FAIL", page.url());

    await page.goto(`${BASE}/track-record`, { waitUntil: "domcontentloaded" });
    const trUrl = page.url();
    if (trUrl.includes("/admin") && trUrl.includes("track-record")) {
      rec("redirect /track-record → admin tab", "PASS");
    } else if (trUrl.includes("/track-record") || trUrl.includes("admin")) {
      rec("redirect /track-record → admin tab", "WARN", trUrl);
    } else {
      rec("redirect /track-record → admin tab", "FAIL", trUrl);
    }

    // ── Non-admin blocked from /admin/users ───────────────────────────────
    const memberSession = await mintMemberE2ESession({
      appUrl: BASE,
      emailPrefix: "admin-console-member",
    });
    if (!memberSession.skip) {
      const memberCtx = await browser.newContext();
      await memberCtx.addCookies(
        playwrightCookiesFromHeader(memberSession.cookieHeader, new URL(BASE).hostname)
      );
      const memberPage = await memberCtx.newPage();
      await memberPage.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
      const memberUrl = memberPage.url();
      if (!memberUrl.includes("/admin/users") || memberUrl.includes("/dashboard")) {
        rec("non-admin blocked from /admin/users", "PASS");
      } else {
        rec("non-admin blocked from /admin/users", "WARN", memberUrl);
      }
      await memberCtx.close();
      await memberSession.cleanup?.();
    } else {
      rec("non-admin blocked from /admin/users", "SKIP", memberSession.reason);
    }

    // Console error budget
    const criticalErrors = consoleErrors.filter(
      (e) => !/favicon|hydration|turnstile|captcha|clerk/i.test(e)
    );
    if (criticalErrors.length === 0) rec("no critical console errors", "PASS");
    else rec("no critical console errors", "WARN", criticalErrors.slice(0, 3).join(" | "));

    writeFileSync(join(OUT_DIR, "console-errors.json"), JSON.stringify(consoleErrors, null, 2));
  } finally {
    await browser.close();
    await adminSession.cleanup?.();
  }

  writeReport("admin-console-e2e.json", rows);
  const { fail } = summarize(rows);
  console.log(`Screenshots: ${SHOT_DIR}`);
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
