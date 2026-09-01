/**
 * Clerk browser session for Playwright iOS UI probes.
 * FAPI ticket exchange + full Set-Cookie jar → Playwright context cookies.
 */
import { devices } from "playwright";
import { createAuditClerkUser } from "./clerk-audit-user.mjs";

const CJS = "5.57.0";
const ONBOARDING_KEY = "blackout:onboarding:v";
const ONBOARDING_DONE = "2";

const PRIMARY_ORIGIN = "https://blackouttrades.com";

function isStagingSatellite(appUrl) {
  try {
    return new URL(appUrl).hostname.includes("staging.");
  } catch {
    return false;
  }
}

/** Primary Clerk FAPI — ticket exchange always uses the primary domain, not satellite proxy. */
function fapiHost(publishableKey) {
  try {
    const decoded = Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (decoded.includes(".")) return `https://${decoded}`;
  } catch {
    /* fall through */
  }
  return "https://clerk.blackouttrades.com";
}

function collectRawSetCookies(res) {
  return typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
}

/** Parse Set-Cookie headers into Playwright cookie objects. */
export function playwrightCookiesFromSetCookie(rawHeaders, fallbackDomain) {
  return rawHeaders.flatMap((header) => {
    const parts = header.split(";").map((s) => s.trim());
    const eq = parts[0].indexOf("=");
    if (eq < 0) return [];
    const cookie = {
      name: parts[0].slice(0, eq),
      value: parts[0].slice(eq + 1),
      domain: fallbackDomain,
      path: "/",
      secure: true,
      sameSite: "Lax",
    };
    for (const p of parts.slice(1)) {
      const lower = p.toLowerCase();
      if (lower.startsWith("domain=")) {
        let d = p.slice(7);
        if (d.startsWith(".")) d = d.slice(1);
        cookie.domain = d;
      }
      if (lower.startsWith("path=")) cookie.path = p.slice(5);
      if (lower === "httponly") cookie.httpOnly = true;
    }
    return [cookie];
  });
}

/** Mint temp premium admin user + Playwright cookie jar for browser auth. */
export async function mintIosPlaywrightSession({ appUrl }) {
  const secret = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secret || !publishableKey) {
    return { skip: true, reason: "CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY not set" };
  }

  const email = process.env.AUDIT_EMAIL || `ios-ui-e2e-${Date.now()}@blackouttrades.com`;
  const satellite = isStagingSatellite(appUrl);
  const authOrigin = satellite ? PRIMARY_ORIGIN : appUrl;
  const fapi = fapiHost(publishableKey);
  const API = "https://api.clerk.com/v1";
  const backend = (method, path, body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  let userId = null;
  try {
    const created = await createAuditClerkUser({
      secret,
      email,
      publicMetadata: { role: "admin", tier: "premium" },
    });
    userId = created.userId;
    if (!userId) return { skip: true, reason: created.error ?? "could not create temp Clerk user" };

    const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
    const ticket = (await tokenRes.json().catch(() => null))?.token;
    if (!ticket) return { skip: true, reason: "sign_in_tokens mint failed" };

    const signInRes = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
      method: "POST",
      headers: {
        Origin: authOrigin,
        Referer: `${authOrigin}/`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ strategy: "ticket", ticket }),
    });
    const signInRaw = collectRawSetCookies(signInRes);
    const signInJson = await signInRes.json().catch(() => null);
    const sessionId = signInJson?.response?.created_session_id;
    if (!sessionId) {
      return {
        skip: true,
        reason: `FAPI ticket exchange failed: ${JSON.stringify(signInJson)?.slice(0, 120)}`,
      };
    }

    if (satellite) {
      const clientUat = Math.floor(Date.now() / 1000);
      const signInCookieHeader = signInRaw.map((h) => h.split(";")[0]).join("; ");
      const mintRes = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`, {
        method: "POST",
        headers: {
          Origin: authOrigin,
          Referer: `${authOrigin}/`,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: signInCookieHeader,
        },
      });
      const mintRaw = collectRawSetCookies(mintRes);
      const jwt = (await mintRes.json().catch(() => null))?.jwt;
      if (!jwt) return { skip: true, reason: "session token mint failed (satellite)" };

      const cookieDomain = new URL(appUrl).hostname;
      const cookies = [
        ...playwrightCookiesFromSetCookie(signInRaw, cookieDomain),
        ...playwrightCookiesFromSetCookie(mintRaw, cookieDomain),
        {
          name: "__session",
          value: jwt,
          domain: cookieDomain,
          path: "/",
          secure: true,
          sameSite: "Lax",
          httpOnly: true,
        },
        {
          name: "__client_uat",
          value: String(clientUat),
          domain: cookieDomain,
          path: "/",
          secure: true,
          sameSite: "Lax",
        },
      ];

      return {
        skip: false,
        satellite: true,
        cookies,
        cleanup: async () => {
          try {
            await backend("DELETE", `/users/${userId}`);
          } catch {
            /* best-effort */
          }
        },
      };
    }

    const clientUat = Math.floor(Date.now() / 1000);
    const signInCookieHeader = signInRaw.map((h) => h.split(";")[0]).join("; ");
    const mintRes = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`, {
      method: "POST",
      headers: {
        Origin: authOrigin,
        Referer: `${authOrigin}/`,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: signInCookieHeader,
      },
    });
    const mintRaw = collectRawSetCookies(mintRes);
    const jwt = (await mintRes.json().catch(() => null))?.jwt;
    if (!jwt) return { skip: true, reason: "session token mint failed" };

    const appDomain = new URL(appUrl).hostname;
    const cookies = [
      ...playwrightCookiesFromSetCookie(signInRaw, appDomain),
      ...playwrightCookiesFromSetCookie(mintRaw, appDomain),
      {
        name: "__session",
        value: jwt,
        domain: appDomain,
        path: "/",
        secure: true,
        sameSite: "Lax",
        httpOnly: true,
      },
      {
        name: "__client_uat",
        value: String(clientUat),
        domain: appDomain,
        path: "/",
        secure: true,
        sameSite: "Lax",
      },
    ];

    return {
      skip: false,
      cookies,
      cleanup: async () => {
        try {
          await backend("DELETE", `/users/${userId}`);
        } catch {
          /* best-effort */
        }
      },
    };
  } catch (e) {
    return { skip: true, reason: `Clerk browser auth failed: ${e.message}` };
  }
}

const IOS_UA_TOKEN = "BlackOutiOSApp";

function withBlackOutUa(deviceKey) {
  const base = devices[deviceKey];
  return {
    ...base,
    userAgent: base.userAgent.replace("Mobile/", `${IOS_UA_TOKEN} Mobile/`),
  };
}

/** Capacitor WKWebView — iPhone 16 Pro (402×874, primary QA target). */
export function iosPlaywrightDevicePro16() {
  return {
    deviceName: "iPhone 16 Pro",
    tierClass: "ios-tier-pro",
    contextOptions: withBlackOutUa("iPhone 16 Pro"),
  };
}

/** Capacitor WKWebView — iPhone 16 Pro Max (440×956). */
export function iosPlaywrightDeviceProMax16() {
  return {
    deviceName: "iPhone 16 Pro Max",
    tierClass: "ios-tier-pro-max",
    contextOptions: withBlackOutUa("iPhone 16 Pro Max"),
  };
}

/** Default iOS E2E device — iPhone 16 Pro. */
export function iosPlaywrightDevice() {
  return iosPlaywrightDevicePro16();
}

/** Skip onboarding modal before first paint. */
export function onboardingInitScript() {
  return `try{localStorage.setItem(${JSON.stringify(ONBOARDING_KEY)},${JSON.stringify(ONBOARDING_DONE)})}catch(e){}`;
}

/** Dismiss onboarding / modal scrims that block chart pointer events. */
export async function dismissDeskModals(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const skip = page.getByRole("button", { name: /^skip$/i });
    if (await skip.isVisible({ timeout: 800 }).catch(() => false)) {
      await skip.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    const close = page.getByRole("button", { name: /^(close|got it|done)$/i });
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(200);
    }
    const scrim = page.locator(".fixed.inset-0.z-\\[100\\]").first();
    if (!(await scrim.isVisible({ timeout: 400 }).catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
  }
}

/** Wait until native iOS product shell is active. */
export async function waitForNativeShell(page, timeoutMs = 45_000) {
  await page.waitForFunction(
    () =>
      document.documentElement.classList.contains("ios-app") &&
      document.documentElement.classList.contains("ios-native-shell") &&
      document.documentElement.classList.contains("ios-tab-bar"),
    { timeout: timeoutMs }
  );
}

export async function readShellProbe(page) {
  return page.evaluate(() => ({
    iosApp: document.documentElement.classList.contains("ios-app"),
    nativeShell: document.documentElement.classList.contains("ios-native-shell"),
    tabBar: document.documentElement.classList.contains("ios-tab-bar"),
    route: document.documentElement.getAttribute("data-ios-route"),
    signedIn: Boolean(window.Clerk?.user?.id),
  }));
}
