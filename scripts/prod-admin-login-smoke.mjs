#!/usr/bin/env node
/**
 * Mint prod Clerk admin session + browser login smoke test.
 * Usage: CLERK_SECRET_KEY=... NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=... node scripts/prod-admin-login-smoke.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const BASE = "https://blackouttrades.com";
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const OUT = "/opt/cursor/artifacts/prod-admin-login";
mkdirSync(OUT, { recursive: true });

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();

function backend(method, path, json) {
  const args = [
    "-sS",
    "-X",
    method,
    "-H",
    `Authorization: Bearer ${SECRET}`,
    "-H",
    "Content-Type: application/json",
    "--data",
    JSON.stringify(json),
    `${API}${path}`,
  ];
  const out = execFileSync("curl", args, { encoding: "utf8" });
  return JSON.parse(out);
}

async function main() {
  if (!SECRET) throw new Error("CLERK_SECRET_KEY required");
  const email = `prod-login-smoke-${Date.now()}@example.com`;
  const report = { base: BASE, email, steps: [], ok: false };

  let userId;
  try {
    const user = backend("POST", "/users", {
      email_address: [email],
      phone_number: [process.env.AUDIT_PHONE || generateDefaultAuditPhone()],
      public_metadata: { role: "admin", tier: "premium" },
      skip_password_requirement: true,
      skip_legal_checks: true,
    });
    userId = user.id;
    if (!userId) throw new Error(`user create failed: ${JSON.stringify(user).slice(0, 200)}`);
    report.steps.push({ step: "create_user", ok: true, userId });

    const { token: ticket } = backend("POST", "/sign_in_tokens", {
      user_id: userId,
      expires_in_seconds: 600,
    });
    if (!ticket) throw new Error("sign_in_token failed");
    report.steps.push({ step: "mint_ticket", ok: true });

    const signInUrl = `${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`;
    report.signInUrl = signInUrl.replace(ticket, "<redacted>");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err.message || err)));

    page.on("response", (res) => {
      if (res.url().includes("/dashboard") && res.request().resourceType() === "document") {
        report.dashboardDoc = { status: res.status(), url: res.url() };
      }
    });

    await page.goto(signInUrl, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(OUT, "01-after-ticket.png"), fullPage: true });

    const afterTicketUrl = page.url();
    report.steps.push({ step: "ticket_landing", ok: !afterTicketUrl.includes("sign-in") || afterTicketUrl.includes("dashboard"), url: afterTicketUrl });

    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(12000);

    const nextData = await page.evaluate(() => {
      const el = document.querySelector("#__NEXT_DATA__");
      if (!el) return null;
      try {
        return JSON.parse(el.textContent || "{}");
      } catch {
        return null;
      }
    });
    report.nextError = nextData?.err || null;
    report.nextDigest = nextData?.props?.pageProps?.digest || null;
    await page.screenshot({ path: join(OUT, "02-dashboard.png"), fullPage: true });

    const bodyText = await page.locator("body").innerText();
    const hasErrorBoundary =
      /couldn't load this page|something went wrong|internal server error/i.test(bodyText);
    const onDashboard = page.url().includes("/dashboard");
    report.steps.push({
      step: "dashboard",
      ok: onDashboard && !hasErrorBoundary,
      url: page.url(),
      hasErrorBoundary,
    });

    const meRes = await page.request.get(`${BASE}/api/admin/me`);
    report.adminMe = { status: meRes.status(), body: await meRes.json().catch(() => null) };

    const flowsRes = await page.request.get(`${BASE}/api/market/flows?limit=5`);
    report.flowsApi = { status: flowsRes.status() };

    report.consoleErrors = consoleErrors.filter((e) => !/favicon|ResizeObserver|chunk/i.test(e)).slice(0, 10);
    report.ok =
      report.steps.every((s) => s.ok !== false) &&
      report.adminMe.status === 200 &&
      report.adminMe.body?.role === "admin" &&
      !hasErrorBoundary;

    await browser.close();
    writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
  } finally {
    if (userId && SECRET) {
      execFileSync("curl", ["-sS", "-X", "DELETE", "-H", `Authorization: Bearer ${SECRET}`, `${API}/users/${userId}`]);
      report.steps.push({ step: "cleanup_user", ok: true, userId });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
