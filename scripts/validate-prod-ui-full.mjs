#!/usr/bin/env node
/**
 * Full prod UI smoke — auth, marketing nav, core routes, Night Hawk v2 markers.
 * Requires CLERK_SECRET_KEY. Screenshots → /opt/cursor/artifacts/prod-ui-e2e/
 */
import { chromium } from "playwright";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY?.trim();
const ART = "/opt/cursor/artifacts/prod-ui-e2e";
const ONBOARDING_KEY = "blackout:onboarding:v";
const ONBOARDING_VERSION = "2";

if (!SECRET) {
  console.error("CLERK_SECRET_KEY required");
  process.exit(1);
}

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

const failures = [];
const tag = crypto.randomBytes(4).toString("hex");
let userId = null;

function check(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** NY weekday RTH window — live 0DTE cards only exist when plays are OPEN. */
function isLikelyRthLiveWindow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  const weekday = !["Sat", "Sun"].includes(wd);
  return weekday && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

try {
  fs.mkdirSync(ART, { recursive: true });
  console.log(`\n=== Prod UI full validation (${BASE}) ===\n`);

  for (const route of ["/api/health", "/api/ready"]) {
    const r = await fetch(`${BASE}${route}`);
    check(`${route} ok`, r.ok, String(r.status));
  }

  const user = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`agent-ui-${tag}@example.com`],
      phone_number: [`+1202555${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`],
      password: `Bo-${tag}-Temp1!`,
      skip_password_checks: true,
      public_metadata: { role: "admin", tier: "premium" },
    }),
  });
  userId = user.id;

  const token = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 600 }),
  });

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

  await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(token.token)}`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  check("Ticket sign-in lands off /sign-in", !page.url().includes("/sign-in") || page.url().includes("accounts."));

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 60_000 });
  const homeNav = await page.locator(".mkt-nav-auth").innerText().catch(() => "");
  check("Homepage: Open desk (signed in)", /open desk/i.test(homeNav) && !/sign in/i.test(homeNav), homeNav.trim());
  await page.screenshot({ path: path.join(ART, "01-home-signed-in.png"), fullPage: false });

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  check("/sign-in redirects when signed in", !page.url().includes("/sign-in") || page.url().includes("accounts."));

  for (const route of ["/dashboard", "/flows", "/nighthawk"]) {
    const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    check(`${route} loads`, (resp?.status() ?? 0) < 400, String(resp?.status()));
  }

  await page.goto(`${BASE}/nighthawk`, { waitUntil: "networkidle", timeout: 90_000 });

  // Dismiss onboarding if it still opened (storage race on first paint).
  const skipBtn = page.getByRole("button", { name: /^skip$/i });
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(400);
  }

  const nh = await page.content();
  check("Night Hawk: nh-v2 surface", /nh-v2/.test(nh));
  check("Night Hawk: playbook board", /playbook|PLAYBOOK/i.test(nh) || (await page.locator("[class*='playbook']").count()) > 0);
  check("Night Hawk: 0DTE column markers", /0DTE|nh-v2-zerodte|Zero/i.test(nh));

  const hasLiveDot = nh.includes("nh-v2-live-dot");
  const hasZeroDteCard = nh.includes("nh-v2-zerodte-card");
  const hasZeroDtePane = /0DTE|nh-v2-zerodte|Zero/i.test(nh);
  if (isLikelyRthLiveWindow()) {
    check("Night Hawk: live 0DTE card (RTH)", hasLiveDot || hasZeroDteCard);
  } else {
    check(
      "Night Hawk: 0DTE pane present (off-hours)",
      hasZeroDtePane || hasZeroDteCard || /no plays|recap only|building/i.test(nh),
      hasLiveDot ? "live dot present" : "no open plays expected"
    );
  }

  const marketContext = await page.locator('[aria-label="Market context"]').innerText().catch(() => "");
  const rawEntities = /&#\d+;|&[a-z]+;/i.test(marketContext);
  check("Night Hawk: market context has no raw HTML entities", !rawEntities, marketContext.slice(0, 120));

  await page.screenshot({ path: path.join(ART, "02-nighthawk-desk.png"), fullPage: true });

  const briefingBtn = page.locator('[aria-label^="Open briefing for"]').first();
  if (await briefingBtn.count()) {
    await briefingBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const modal = page.locator(".nh-v2-briefing-tabs, [role='dialog']");
    check("Night Hawk: briefing tabs on play click", (await modal.count()) > 0);
    await page.screenshot({ path: path.join(ART, "03-nighthawk-briefing.png"), fullPage: false });
  } else {
    console.log("  · Night Hawk: no playbook plays to open briefing (recap-only/off-hours)");
  }

  await page.goto(`${BASE}/sign-up`, { waitUntil: "domcontentloaded" });
  check("/sign-up redirects when signed in", !page.url().includes("/sign-up") || page.url().includes("accounts."));

  await browser.close();

  if (failures.length) {
    console.log(`\nRED — ${failures.length} failed:\n  - ${failures.join("\n  - ")}\n`);
    console.log(`Screenshots: ${ART}/`);
    process.exitCode = 1;
  } else {
    console.log(`\nGREEN — prod UI validation passed.\nScreenshots: ${ART}/\n`);
  }
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
} finally {
  if (userId) await clerk(`/users/${userId}`, { method: "DELETE" }).catch(() => {});
}
