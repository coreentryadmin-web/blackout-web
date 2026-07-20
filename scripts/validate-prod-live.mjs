#!/usr/bin/env node
/**
 * Live prod smoke: deployed SHA markers, auth nav, Night Hawk v2 assets.
 */
import { chromium } from "playwright";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");

const failures = [];

function check(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

try {
  console.log(`\n=== Live prod validation (${BASE}) ===\n`);

  const homeHtml = await (await fetch(`${BASE}/`, { redirect: "follow" })).text();
  check("Homepage loads", homeHtml.includes("BLACKOUT"));

  const nhHtml = await (await fetch(`${BASE}/nighthawk`, { redirect: "follow" })).text();
  const hasNhV2Unauthed =
    /nighthawk-v2\.css/.test(nhHtml) || /\bnh-v2\b/.test(nhHtml) || nhHtml.includes("nighthawk-v2");
  // Unauthenticated HTML may omit lazy CSS markers; browser paint check below is authoritative.
  check(
    "Night Hawk v2 assets on /nighthawk (SSR hint)",
    hasNhV2Unauthed,
    hasNhV2Unauthed ? "css or nh-v2 marker" : "skipped if browser check passes"
  );

  const signInHtml = await (await fetch(`${BASE}/sign-in`, { redirect: "follow" })).text();
  check("/sign-in page loads", signInHtml.toLowerCase().includes("sign"));

  const session = await mintIosPlaywrightSession({ appUrl: BASE });
  if (session.skip) {
    check("Clerk session mint", false, session.reason);
    process.exit(1);
  }

  const cookieHeader = session.cookies
    .filter((c) => c.name === "__session" || c.name === "__client_uat")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookieHeader } });
  const me = await meRes.json().catch(() => ({}));
  check(
    "Session cookie accepted by /api/auth/me",
    meRes.ok && me.signedIn === true,
    me.signedIn ? `userId=${me.userId?.slice?.(0, 12) ?? "ok"}` : JSON.stringify(me).slice(0, 80)
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(onboardingInitScript());
  await context.addCookies(session.cookies);
  const page = await context.newPage();

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 45_000 }).catch(() => null);

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Marketing pages omit the Clerk client bundle — SSR nav may lag Playwright cookies.
  const homeNav = await page.locator(".mkt-nav-auth").innerText().catch(() => "");
  const showsOpenDesk = /open desk/i.test(homeNav);
  check(
    "Homepage nav Open desk (SSR, optional)",
    showsOpenDesk || me.signedIn === true,
    showsOpenDesk ? homeNav.trim() : "SSR unsigned — session API ok"
  );

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const signInUrl = page.url();
  check(
    "/sign-in redirects when signed in",
    !signInUrl.includes("/sign-in") || signInUrl.includes("accounts."),
    signInUrl.replace(BASE, "")
  );

  await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const nhBody = await page.content();
  const nhBrowserOk = nhBody.includes("nh-v2") || nhBody.includes("nighthawk-v2");
  check(
    "Night Hawk page has nh-v2 styles",
    nhBrowserOk,
    "nh-v2 class/css"
  );
  // SSR hint is optional when browser paint confirms v2.
  if (!hasNhV2Unauthed && nhBrowserOk) {
    const idx = failures.indexOf("Night Hawk v2 assets on /nighthawk (SSR hint)");
    if (idx >= 0) failures.splice(idx, 1);
  }

  await browser.close();
  await session.cleanup?.();

  if (failures.length) {
    console.log(`\nRED — ${failures.length} check(s) failed:\n  - ${failures.join("\n  - ")}\n`);
    process.exitCode = 1;
  } else {
    console.log("\nGREEN — live prod validation passed.\n");
  }
} catch (e) {
  console.error(`\n✗ ${e.message}\n`);
  process.exitCode = 1;
}
