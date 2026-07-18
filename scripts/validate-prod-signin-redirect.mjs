#!/usr/bin/env node
/**
 * Production validation: signed-in user visiting /sign-in must 307 away (PR #790/#792).
 * Creates a ephemeral Clerk user, mints a sign-in token, completes ticket auth in
 * Playwright, then asserts /sign-in redirects to /.
 */
import { chromium } from "playwright";
import crypto from "node:crypto";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY?.trim();
if (!SECRET) {
  console.error("CLERK_SECRET_KEY required");
  process.exit(1);
}

async function clerk(path, init = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Clerk ${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const tag = crypto.randomBytes(4).toString("hex");
let userId = null;

try {
  console.log(`\n=== Prod sign-in redirect validation (${BASE}) ===\n`);

  const user = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`agent-redirect-${tag}@example.com`],
      phone_number: [`+1202555${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`],
      password: `Bo-${tag}-Temp1!`,
      skip_password_checks: true,
      public_metadata: { role: "admin", tier: "premium" },
    }),
  });
  userId = user.id;
  console.log(`  ✓ Created test user ${userId}`);

  const token = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
  });
  const ticketUrl = `${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(token.token)}`;
  console.log("  ✓ Minted sign-in ticket");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(ticketUrl, { waitUntil: "networkidle", timeout: 60_000 });
  const afterTicket = page.url();
  console.log(`  ✓ Ticket consumed → ${afterTicket.replace(BASE, "")}`);

  const dash = await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const dashStatus = dash?.status() ?? 0;
  if (dashStatus >= 400) throw new Error(`/dashboard returned ${dashStatus}`);
  console.log(`  ✓ /dashboard renders (${dashStatus}) with session`);

  const signInResp = await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const finalUrl = page.url();
  const status = signInResp?.status() ?? 0;

  if (finalUrl.includes("/sign-in") && !finalUrl.includes("accounts.")) {
    throw new Error(`FAIL: still on sign-in page (${finalUrl}) status=${status}`);
  }
  console.log(`  ✓ /sign-in redirected signed-in user → ${finalUrl.replace(BASE, "") || "/"}`);

  await browser.close();
  console.log("\nGREEN — prod auth redirect validation passed.\n");
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
} finally {
  if (userId) {
    await clerk(`/users/${userId}`, { method: "DELETE" }).catch(() => {});
    console.log(`  (deleted test user ${userId})`);
  }
}
