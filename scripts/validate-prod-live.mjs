#!/usr/bin/env node
/**
 * Live prod smoke: deployed SHA markers, auth nav, Night Hawk v2 assets.
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

const failures = [];
const tag = crypto.randomBytes(4).toString("hex");
let userId = null;

function check(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

try {
  console.log(`\n=== Live prod validation (${BASE}) ===\n`);

  // Static asset markers (no auth)
  const homeHtml = await (await fetch(`${BASE}/`, { redirect: "follow" })).text();
  check("Homepage loads", homeHtml.includes("BLACKOUT"));

  const nhHtml = await (await fetch(`${BASE}/nighthawk`, { redirect: "follow" })).text();
  const hasNhV2Css = /nighthawk-v2\.css/.test(nhHtml);
  check("Night Hawk v2 CSS linked on /nighthawk", hasNhV2Css, hasNhV2Css ? "found" : "missing — #786 not deployed");

  const signInHtml = await (await fetch(`${BASE}/sign-in`, { redirect: "follow" })).text();
  check("/sign-in page loads", signInHtml.toLowerCase().includes("sign"));

  const user = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({
      email_address: [`agent-live-${tag}@example.com`],
      phone_number: [`+1202555${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`],
      password: `Bo-${tag}-Temp1!`,
      skip_password_checks: true,
      public_metadata: { role: "admin", tier: "premium" },
    }),
  });
  userId = user.id;

  const token = await clerk("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
  });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext().then((c) => c.newPage());

  await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(token.token)}`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  // Homepage nav after auth (#794)
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const homeNav = await page.locator(".mkt-nav-auth").innerText().catch(() => "");
  const showsOpenDesk = /open desk/i.test(homeNav);
  const showsSignIn = /sign in/i.test(homeNav);
  check("Signed-in homepage shows Open desk (not Sign in)", showsOpenDesk && !showsSignIn, homeNav.trim() || "(empty nav)");

  // /sign-in redirect (#790/#792/#794)
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const signInUrl = page.url();
  check("/sign-in redirects when signed in", !signInUrl.includes("/sign-in") || signInUrl.includes("accounts."), signInUrl.replace(BASE, ""));

  // Night Hawk UI markers (#786)
  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const nhBody = await page.content();
  check("Night Hawk page has nh-v2 styles", nhBody.includes("nh-v2") || nhBody.includes("nighthawk-v2"), "nh-v2 class/css");

  await browser.close();

  if (failures.length) {
    console.log(`\nRED — ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("\nGREEN — live prod validation passed.\n");
  }
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
} finally {
  if (userId) {
    await clerk(`/users/${userId}`, { method: "DELETE" }).catch(() => {});
  }
}
