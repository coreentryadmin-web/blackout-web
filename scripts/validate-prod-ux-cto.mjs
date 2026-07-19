#!/usr/bin/env node
/**
 * CTO-style prod UX validation — Clerk config, tier gates, auth surfaces, admin API.
 * Outputs report → audit-output/cto-ux-validation.json
 * Screenshots → /opt/cursor/artifacts/cto-ux-validation/
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY?.trim();
const ART = process.env.CTO_UX_ART ?? "/opt/cursor/artifacts/cto-ux-validation";
const ONBOARDING_KEY = "blackout:onboarding:v";
const ONBOARDING_VERSION = "2";

const rows = [];
const rec = (name, status, detail = "") => {
  rows.push({ name, status, detail, at: new Date().toISOString() });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : status === "SKIP" ? "○" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

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

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function runNpmScript(script) {
  return new Promise((resolve) => {
    const child = spawn("npm", ["run", script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ADMIN_E2E_BASE: BASE },
      cwd: process.cwd(),
    });
    let out = "";
    child.stdout?.on("data", (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr?.on("data", (d) => {
      out += d;
      process.stderr.write(d);
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, out }));
  });
}

async function mintTicketUser({ emailPrefix, metadata }) {
  const tag = crypto.randomBytes(4).toString("hex");
  const meta = { ...metadata };
  if (meta.tier === "premium" || meta.tier === "pro") {
    meta.tier_managed_by = "admin";
  }
  const user = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`${emailPrefix}-${tag}@blackouttrades.com`],
      phone_number: [generateDefaultAuditPhone()],
      skip_password_requirement: true,
      skip_password_checks: true,
      skip_legal_checks: true,
      public_metadata: meta,
    }),
  });
  const token = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: 600 }),
  });
  return { userId: user.id, ticket: token.token, tag };
}

async function browserWithTicket(ticket) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  return { browser, page, context };
}

async function main() {
  if (!SECRET) {
    console.error("CLERK_SECRET_KEY required");
    process.exit(1);
  }

  fs.mkdirSync(ART, { recursive: true });
  fs.mkdirSync("audit-output/cto-ux", { recursive: true });

  console.log(`\n=== CTO prod UX validation (${BASE}) ===\n`);

  // ── 1. Clerk config harness ───────────────────────────────────────────
  console.log("--- Clerk instance ---\n");
  const clerkVal = await runNpmScript("validate:clerk-config");
  rec("validate:clerk-config", clerkVal.code === 0 ? "PASS" : "FAIL", `exit ${clerkVal.code}`);

  // ── 2. Public surfaces (unsigned) ───────────────────────────────────────
  console.log("\n--- Public / marketing ---\n");
  for (const route of ["/", "/pricing", "/faq", "/track-record", "/sign-in", "/sign-up"]) {
    const r = await fetch(`${BASE}${route}`, { redirect: "follow" });
    const html = await r.text();
    rec(`GET ${route}`, r.ok ? "PASS" : "FAIL", String(r.status));
    if (route === "/sign-in") {
      rec("sign-in renders Clerk", /clerk|sign in|sign-in/i.test(html) ? "PASS" : "WARN");
    }
    if (route === "/sign-up") {
      rec("sign-up renders Clerk", /clerk|sign up|sign-up|create/i.test(html) ? "PASS" : "WARN");
    }
    if (route === "/track-record") {
      rec("/track-record → admin tab redirect", r.url.includes("admin") && r.url.includes("track-record") ? "PASS" : "WARN", r.url);
    }
  }

  // ── 3. Tier gates (free vs premium) ───────────────────────────────────
  console.log("\n--- Tier gates ---\n");
  let freeUserId = null;
  let premUserId = null;
  try {
    const free = await mintTicketUser({ emailPrefix: "cto-free", metadata: { tier: "free" } });
    freeUserId = free.userId;
    {
      const { browser, page } = await browserWithTicket(free.ticket);
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1500);
      const freeDash = page.url();
      rec("free tier /dashboard → /upgrade", freeDash.includes("/upgrade") ? "PASS" : "FAIL", freeDash);
      await page.screenshot({ path: path.join(ART, "01-free-upgrade-gate.png"), fullPage: false });

      await page.goto(`${BASE}/upgrade`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      rec("free user /upgrade loads", page.url().includes("/upgrade") ? "PASS" : "WARN", page.url());
      await page.screenshot({ path: path.join(ART, "02-free-upgrade-page.png"), fullPage: false });
      await browser.close();
    }

    const prem = await mintTicketUser({
      emailPrefix: "cto-prem",
      metadata: { tier: "premium", role: "admin" },
    });
    premUserId = prem.userId;
    {
      const { browser, page, context } = await browserWithTicket(prem.ticket);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const premDash = page.url();
    rec(
      "premium /dashboard access",
      premDash.includes("/dashboard") && !premDash.includes("/upgrade") ? "PASS" : "FAIL",
      premDash
    );
    await page.screenshot({ path: path.join(ART, "03-premium-dashboard.png"), fullPage: false });

    for (const route of ["/flows", "/terminal", "/admin"]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(800);
      const ok = !page.url().includes("/sign-in") && !page.url().includes("/upgrade");
      rec(`premium ${route}`, ok ? "PASS" : "FAIL", page.url());
    }
    await page.screenshot({ path: path.join(ART, "04-premium-admin.png"), fullPage: false });

    // JWT claims on premium session
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "__session")?.value;
    const payload = session ? decodeJwtPayload(session) : null;
    rec("session JWT has tier", payload && "tier" in payload ? "PASS" : "WARN", payload?.tier ?? "missing");
    rec("session JWT has role", payload && "role" in payload ? "PASS" : "WARN", payload?.role ?? "missing");
    rec(
      "premium JWT tier=premium",
      payload?.tier === "premium" ? "PASS" : "WARN",
      payload?.tier === "premium"
        ? "ok"
        : `JWT tier=${String(payload?.tier)} (metadata may still grant access via Backend fallback)`
    );

      await browser.close();
    }
  } finally {
    if (freeUserId) await clerk(`/users/${freeUserId}`, { method: "DELETE" }).catch(() => {});
    if (premUserId) await clerk(`/users/${premUserId}`, { method: "DELETE" }).catch(() => {});
  }

  // ── 4. Admin user management API ──────────────────────────────────────
  console.log("\n--- Admin user-management API ---\n");
  const apiVal = await runNpmScript("validate:admin-users-e2e");
  rec("validate:admin-users-e2e", apiVal.code === 0 ? "PASS" : "FAIL", `exit ${apiVal.code}`);

  // ── 5. Admin console UI ─────────────────────────────────────────────────
  console.log("\n--- Admin console UI ---\n");
  const uiVal = await runNpmScript("validate:prod-admin-ui");
  rec("validate:prod-admin-ui", uiVal.code === 0 ? "PASS" : "FAIL", `exit ${uiVal.code}`);

  // ── 6. Deploy smoke ───────────────────────────────────────────────────
  console.log("\n--- Deploy smoke ---\n");
  const health = await fetch(`${BASE}/api/health`);
  const ready = await fetch(`${BASE}/api/ready`);
  rec("/api/health", health.ok ? "PASS" : "FAIL", String(health.status));
  rec("/api/ready", ready.ok ? "PASS" : "FAIL", String(ready.status));

  const report = { base: BASE, at: new Date().toISOString(), rows };
  fs.writeFileSync("audit-output/cto-ux/validation-report.json", JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(ART, "validation-report.json"), JSON.stringify(report, null, 2));

  const fails = rows.filter((r) => r.status === "FAIL");
  console.log(`\n=== CTO summary ===`);
  console.log(`  ${rows.filter((r) => r.status === "PASS").length} pass, ${fails.length} fail, ${rows.filter((r) => r.status === "WARN").length} warn`);
  console.log(`  Report: audit-output/cto-ux/validation-report.json`);
  console.log(`  Screenshots: ${ART}/\n`);

  if (fails.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
