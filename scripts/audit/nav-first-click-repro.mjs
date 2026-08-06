#!/usr/bin/env node
/** Reproduce first-click dead zone on Sign in / Open desk (website). */
import { chromium } from "playwright";

const BASE = process.env.VALIDATE_BASE ?? "https://blackouttrades.com";
const AUTH_SEL = ".mkt-nav-auth, .nav-auth";

async function navState(page) {
  const root = page.locator(AUTH_SEL).first();
  const signIn = await root.getByRole("link", { name: /^sign in$/i }).count();
  const openDesk = await root.getByRole("link", { name: /open desk/i }).count();
  const getAccess = await root.getByRole("link", { name: /get access/i }).count();
  const empty = ((await root.innerHTML().catch(() => "")) || "").trim().length === 0;
  return { signIn, openDesk, getAccess, empty, hasTarget: signIn + openDesk + getAccess > 0 };
}

async function clickFirstAuthLink(page) {
  const root = page.locator(AUTH_SEL).first();
  const link = root.getByRole("link").first();
  if ((await link.count()) === 0) return { clicked: false, url: page.url() };
  const before = page.url();
  await link.click({ timeout: 1000 });
  await page.waitForTimeout(600);
  return { clicked: true, url: page.url(), navigated: page.url() !== before };
}

async function probe(path, delays) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(); // fresh = signed out
  const page = await context.newPage();
  const rows = [];

  for (const ms of delays) {
    await page.goto(`${BASE}${path}`, { waitUntil: "commit" });
    if (ms > 0) await page.waitForTimeout(ms);
    const state = await navState(page);
    const click = state.hasTarget ? await clickFirstAuthLink(page) : { clicked: false, navigated: false };
    rows.push({ ms, ...state, ...click });
    await context.clearCookies();
  }

  await browser.close();
  return rows;
}

async function probeSignedInMismatch() {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) return { skipped: true };

  const { createOrAdoptAuditUser } = await import("./lib/clerk-audit-user.mjs");
  const email = `nav-repro-${Date.now()}@example.com`;
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

  // No adoptByEmail callback (per-run timestamped e-mail); the shared helper redraws the
  // random +1415555XXXX phone if some other live temp user already holds it.
  const created = await createOrAdoptAuditUser({
    createUser: async (phone) =>
      (
        await fetch("https://api.clerk.com/v1/users", {
          method: "POST",
          headers,
          body: JSON.stringify({
            email_address: [email],
            phone_numbers: [{ phone_number: phone }],
            password: "AuditTestPass123!@#",
            public_metadata: { tier: "premium" },
          }),
        })
      )
        .json()
        .catch(() => null),
  });
  const user = { id: created.userId };
  if (!user.id) return { skipped: true, reason: String(created.error).slice(0, 160) };
  const tokenRes = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: user.id }),
  });
  const { token } = await tokenRes.json();

  const ticketRes = await fetch(
    "https://clerk.blackouttrades.com/v1/client/sign_ins?__clerk_api_version=2025-04-30&_clerk_js_version=5.57.0",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ strategy: "ticket", ticket: token }),
      redirect: "manual",
    },
  );
  const cookies = ticketRes.headers.getSetCookie?.() ?? [];
  const jar = Object.fromEntries(
    cookies.map((c) => {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    }),
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    { name: "__client_uat", value: jar.__client_uat ?? "1", domain: "blackouttrades.com", path: "/" },
    ...(jar.__session
      ? [{ name: "__session", value: jar.__session, domain: "blackouttrades.com", path: "/" }]
      : []),
  ]);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  const heroSignIn = await page.locator(".cta-row").getByRole("link", { name: /get access|open desk/i }).innerText().catch(() => "?");
  const nav0 = await navState(page);
  await page.waitForTimeout(700);
  const nav700 = await navState(page);

  let bounceUrl = null;
  if (nav0.signIn > 0) {
    await page.locator(AUTH_SEL).first().getByRole("link", { name: /^sign in$/i }).click();
    await page.waitForTimeout(800);
    bounceUrl = page.url();
  }

  await fetch(`https://api.clerk.com/v1/users/${user.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {});
  await browser.close();

  return { skipped: false, heroSignIn, nav0, nav700, bounceUrl };
}

async function main() {
  console.log(`\n=== Website Sign in / Open desk first-click repro ===\n`);

  const marketing = await probe("/", [0, 50, 150, 400, 1000]);
  console.log("Marketing nav (/) signed-out:");
  for (const r of marketing) {
    console.log(
      `  t=${String(r.ms).padStart(4)}ms empty=${r.empty} signIn=${r.signIn} openDesk=${r.openDesk} getAccess=${r.getAccess} navigated=${r.navigated ?? false}`,
    );
  }

  const desk = await probe("/dashboard", [0, 50, 150, 400, 1500]);
  console.log("\nDesk nav (/dashboard) signed-out:");
  for (const r of desk) {
    console.log(
      `  t=${String(r.ms).padStart(4)}ms empty=${r.empty} signIn=${r.signIn} openDesk=${r.openDesk} getAccess=${r.getAccess} navigated=${r.navigated ?? false}`,
    );
  }

  const signedIn = await probeSignedInMismatch();
  if (signedIn.skipped) {
    console.log("\nSigned-in mismatch: skipped (no CLERK_SECRET_KEY)");
  } else {
    console.log("\nSigned-in CTA mismatch (/)");
    console.log(`  hero CTA text: ${signedIn.heroSignIn}`);
    console.log(`  nav@0ms:`, signedIn.nav0);
    console.log(`  nav@700ms:`, signedIn.nav700);
    if (signedIn.bounceUrl) console.log(`  click Sign in while signed-in → ${signedIn.bounceUrl}`);
  }

  const deadZone =
    marketing.some((r) => r.ms <= 150 && r.empty) ||
    desk.some((r) => r.ms <= 150 && r.empty) ||
    desk.some((r) => r.ms <= 400 && !r.hasTarget);

  console.log(`\nVerdict: ${deadZone ? "REPRODUCED — auth buttons missing on early clicks" : "inconclusive"}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
