/**
 * Admin E2E session minting — prod Clerk (cloud/prod URL) or keyless localhost.
 */
import { mintClerkPremiumSession } from "./prod-clerk-session.mjs";
import {
  mintClerkSession,
  mintSessionForUserId,
  clerkBackend,
  createClerkUser,
} from "./keyless-clerk-session.mjs";

export { mintSessionForUserId, clerkBackend, createClerkUser };

function prodKeysConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

function isLocalhost(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Complete ticket sign-in in a headless browser — works for keyless + prod. */
export async function mintClerkSessionViaPlaywright({
  appUrl,
  signInUrl,
  cookieDomain,
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2500);
  const cookies = await context.cookies();
  await browser.close();

  const domain = cookieDomain ?? new URL(appUrl).hostname;
  const session = cookies.find((c) => c.name === "__session" && (c.domain.includes(domain) || domain.includes(c.domain.replace(/^\./, ""))));
  const clientUat = cookies.find((c) => c.name === "__client_uat");
  if (!session?.value) {
    return { skip: true, reason: "Playwright ticket sign-in did not set __session cookie" };
  }
  const uat = clientUat?.value ?? String(Math.floor(Date.now() / 1000));
  return {
    skip: false,
    cookieHeader: `__session=${session.value}; __client_uat=${uat}`,
  };
}

/** Visit keyless dev origin once so Clerk dev-browser cookies exist for Backend API sign-in. */
async function bootstrapKeylessDevBrowser(appUrl) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2000);
  const cookies = await context.cookies();
  await browser.close();
  const clerkCookies = cookies.filter(
    (c) => c.name.startsWith("__clerk") || c.name.includes("clerk")
  );
  return clerkCookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Mint an admin session for admin E2E probes.
 * - Production URL + prod keys → temp admin via prod-clerk-session
 * - Localhost → keyless (with optional Playwright dev-browser bootstrap)
 */
export async function mintAdminE2ESession({ appUrl, emailPrefix = "admin-e2e" }) {
  const local = isLocalhost(appUrl);

  if (!local && prodKeysConfigured()) {
    const prod = await mintClerkPremiumSession({ appUrl });
    if (!prod.skip) {
      return {
        ...prod,
        mode: "prod",
        secret: process.env.CLERK_SECRET_KEY,
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      };
    }
    return prod;
  }

  if (local) {
    let devBrowserCookie = "";
    try {
      devBrowserCookie = await bootstrapKeylessDevBrowser(appUrl);
    } catch (e) {
      return {
        skip: true,
        reason: `keyless dev-browser bootstrap failed: ${e instanceof Error ? e.message : e}`,
      };
    }

    const keyless = await mintClerkSession({
      appUrl,
      metadata: { role: "admin", tier: "premium" },
      emailPrefix,
      devBrowserCookie,
    });
    if (!keyless.skip) return { ...keyless, mode: "keyless" };
    return keyless;
  }

  if (prodKeysConfigured()) {
    return mintClerkPremiumSession({ appUrl });
  }

  return { skip: true, reason: "No auth path — set ADMIN_E2E_BASE or Clerk keys" };
}

/** Mint a non-admin member session (for 403 probes). */
export async function mintMemberE2ESession({ appUrl, emailPrefix = "admin-e2e-member" }) {
  if (prodKeysConfigured() && !isLocalhost(appUrl)) {
    const { mintClerkPremiumSession: mint } = await import("./prod-clerk-session.mjs");
    // Create without admin role — prod helper always sets admin; use keyless-style create instead
    const secret = process.env.CLERK_SECRET_KEY;
    const backend = await clerkBackend(secret);
    const { generateDefaultAuditPhone } = await import("./audit-phone.mjs");
    const email = `${emailPrefix}-${Date.now()}@example.com`;
    const createRes = await backend("POST", "/users", {
      email_address: [email],
      phone_number: [generateDefaultAuditPhone()],
      public_metadata: { tier: "premium" },
      skip_password_requirement: true,
      skip_password_checks: true,
      skip_legal_checks: true,
    });
    const userId = createRes.json?.id;
    if (!userId) return { skip: true, reason: "member user create failed" };

    const { mintSessionForUserId: mintExisting } = await import("./keyless-clerk-session.mjs");
    const session = await mintExisting({
      userId,
      appUrl,
      secret,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    });
    if (session.skip) {
      await backend("DELETE", `/users/${userId}`);
      return session;
    }
    return {
      ...session,
      cleanup: async () => {
        try {
          await backend("DELETE", `/users/${userId}`);
        } catch {
          /* ignore */
        }
      },
    };
  }

  const devBrowserCookie = isLocalhost(appUrl) ? await bootstrapKeylessDevBrowser(appUrl) : "";
  return mintClerkSession({
    appUrl,
    metadata: { tier: "premium" },
    emailPrefix,
    devBrowserCookie,
  });
}
