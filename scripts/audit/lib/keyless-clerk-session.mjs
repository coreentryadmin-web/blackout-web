/**
 * Keyless/local Clerk session minting for localhost admin E2E.
 * Reads secret from CLERK_SECRET_KEY or .clerk/.tmp/keyless.json after dev boot.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./audit-phone.mjs";

const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";

function loadClerkSecrets({ preferKeyless = false } = {}) {
  const keylessPath = join(process.cwd(), ".clerk/.tmp/keyless.json");
  if (preferKeyless && existsSync(keylessPath)) {
    const raw = JSON.parse(readFileSync(keylessPath, "utf8"));
    if (raw.secretKey && raw.publishableKey) {
      return { secret: raw.secretKey, publishableKey: raw.publishableKey };
    }
  }
  if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return {
      secret: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    };
  }
  if (existsSync(keylessPath)) {
    const raw = JSON.parse(readFileSync(keylessPath, "utf8"));
    if (raw.secretKey && raw.publishableKey) {
      return { secret: raw.secretKey, publishableKey: raw.publishableKey };
    }
  }
  return null;
}

function isLocalAppUrl(appUrl) {
  try {
    const h = new URL(appUrl).hostname;
    return h === "localhost" || h === "127.0.0.1";
  } catch {
    return false;
  }
}

function fapiHost(publishableKey) {
  try {
    const decoded = Buffer.from(publishableKey.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (decoded.includes(".")) return `https://${decoded}`;
  } catch {
    /* default */
  }
  return "https://clerk.blackouttrades.com";
}

function collectSetCookies(res) {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]).filter(Boolean);
}

/** Keyless dev instances reject FAPI without dev-browser auth — use Backend API sessions instead. */
async function mintSessionJwtViaBackend(secret, userId) {
  const res = await fetch(`${API}/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  const sess = await res.json().catch(() => null);
  const sessionId = sess?.id;
  if (!sessionId) return null;
  const tokRes = await fetch(`${API}/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  });
  const tok = await tokRes.json().catch(() => null);
  return tok?.jwt ?? null;
}

async function mintSessionCookieViaFapi({
  appUrl,
  fapi,
  ticket,
  devBrowserCookie,
}) {
  const signInRes = await fetch(`${fapi}/v1/client/sign_ins?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: {
      Origin: appUrl,
      Referer: `${appUrl}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(devBrowserCookie ? { Cookie: devBrowserCookie } : {}),
    },
    body: new URLSearchParams({ strategy: "ticket", ticket }),
  });
  const signInCookies = collectSetCookies(signInRes);
  const signInJson = await signInRes.json().catch(() => null);
  const sessionId = signInJson?.response?.created_session_id;
  if (!sessionId) return null;

  const mintRes = await fetch(`${fapi}/v1/client/sessions/${sessionId}/tokens?_clerk_js_version=${CJS}`, {
    method: "POST",
    headers: {
      Origin: appUrl,
      Referer: `${appUrl}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: signInCookies.join("; "),
    },
  });
  return (await mintRes.json().catch(() => null))?.jwt ?? null;
}

export async function mintClerkSession({
  appUrl,
  metadata = { role: "admin", tier: "premium" },
  emailPrefix = "admin-e2e",
  devBrowserCookie = "",
}) {
  const creds = loadClerkSecrets({ preferKeyless: isLocalAppUrl(appUrl) });
  if (!creds) {
    return { skip: true, reason: "No Clerk keys — set env or run dev in keyless mode first" };
  }

  const { secret, publishableKey } = creds;
  const email = `${emailPrefix}-${Date.now()}@example.com`;
  const phone = generateDefaultAuditPhone();
  const fapi = fapiHost(publishableKey);

  const backend = (method, path, body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  async function createUserWithOptionalPhone() {
    const withPhone = {
      email_address: [email],
      phone_number: [phone],
      public_metadata: metadata,
      skip_password_requirement: true,
      skip_password_checks: true,
      skip_legal_checks: true,
    };
    let createRes = await backend("POST", "/users", withPhone);
    let created = await createRes.json().catch(() => null);
    if (created?.id) return created;

    const phoneDisabled = /phone_number is not a valid parameter/i.test(
      JSON.stringify(created?.errors ?? "")
    );
    if (phoneDisabled) {
      createRes = await backend("POST", "/users", {
        email_address: [email],
        public_metadata: metadata,
        skip_password_requirement: true,
        skip_password_checks: true,
        skip_legal_checks: true,
      });
      created = await createRes.json().catch(() => null);
      if (created?.id) return created;
    }
    return created;
  }

  let userId = null;
  try {
    const created = await createUserWithOptionalPhone();
    if (!created?.id) {
      return { skip: true, reason: `Clerk user create failed: ${JSON.stringify(created)?.slice(0, 200)}` };
    }
    userId = created.id;

    const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
    const ticket = (await tokenRes.json().catch(() => null))?.token;
    if (!ticket) return { skip: true, reason: "sign_in_tokens mint failed" };

    let jwt =
      isLocalAppUrl(appUrl)
        ? await mintSessionJwtViaBackend(secret, userId)
        : null;
    if (!jwt) {
      jwt = await mintSessionCookieViaFapi({ appUrl, fapi, ticket, devBrowserCookie });
    }
    if (!jwt && !isLocalAppUrl(appUrl)) {
      jwt = await mintSessionJwtViaBackend(secret, userId);
    }
    if (!jwt) return { skip: true, reason: "session JWT mint failed" };

    const clientUat = Math.floor(Date.now() / 1000);
    let cookieHeader = `__session=${jwt}; __client_uat=${clientUat}`;

    if (isLocalAppUrl(appUrl)) {
      const signInUrl = `${appUrl}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`;
      const pwCookie = await mintSessionCookieViaPlaywright({ appUrl, signInUrl });
      if (pwCookie) cookieHeader = pwCookie;
    }

    return {
      skip: false,
      userId,
      email,
      cookieHeader,
      signInUrl: `${appUrl}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`,
      secret,
      publishableKey,
      cleanup: async () => {
        try {
          await backend("DELETE", `/users/${userId}`);
        } catch {
          /* best-effort */
        }
      },
    };
  } catch (e) {
    if (userId) {
      try {
        await backend("DELETE", `/users/${userId}`);
      } catch {
        /* ignore */
      }
    }
    return { skip: true, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function mintSessionCookieViaPlaywright({ appUrl, signInUrl }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(signInUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2500);
  const cookies = await context.cookies();
  await browser.close();
  const session = cookies.find((c) => c.name === "__session");
  const clientUat = cookies.find((c) => c.name === "__client_uat");
  if (!session?.value) return null;
  const uat = clientUat?.value ?? String(Math.floor(Date.now() / 1000));
  return `__session=${session.value}; __client_uat=${uat}`;
}

export async function clerkBackend(secret) {
  const backend = async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
  return backend;
}

/** Mint a browser session cookie for an existing Clerk user (keyless or env secret). */
export async function mintSessionForUserId({
  userId,
  appUrl,
  secret,
  publishableKey,
  metadata,
  devBrowserCookie = "",
}) {
  const backend = await clerkBackend(secret);
  if (metadata) {
    await backend("PATCH", `/users/${userId}/metadata`, { public_metadata: metadata });
  }

  const tokenRes = await backend("POST", "/sign_in_tokens", { user_id: userId });
  const ticket = tokenRes.json?.token;
  if (!ticket) {
    return { skip: true, reason: "sign_in_tokens mint failed for existing user" };
  }

  const fapi = fapiHost(publishableKey);
  let jwt = isLocalAppUrl(appUrl) ? await mintSessionJwtViaBackend(secret, userId) : null;
  if (!jwt) {
    jwt = await mintSessionCookieViaFapi({ appUrl, fapi, ticket, devBrowserCookie });
  }
  if (!jwt) jwt = await mintSessionJwtViaBackend(secret, userId);
  if (!jwt) return { skip: true, reason: "session JWT mint failed for existing user" };

  let cookieHeader = `__session=${jwt}; __client_uat=${Math.floor(Date.now() / 1000)}`;
  if (isLocalAppUrl(appUrl)) {
    const signInUrl = `${appUrl}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`;
    const pwCookie = await mintSessionCookieViaPlaywright({ appUrl, signInUrl });
    if (pwCookie) cookieHeader = pwCookie;
  }

  return {
    skip: false,
    userId,
    cookieHeader,
    signInUrl: `${appUrl}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`,
  };
}

export async function createClerkUser({
  secret,
  emailPrefix = "admin-e2e-user",
  metadata = { tier: "premium" },
}) {
  const backend = await clerkBackend(secret);
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const phone = generateDefaultAuditPhone();
  let createRes = await backend("POST", "/users", {
    email_address: [email],
    phone_number: [phone],
    public_metadata: metadata,
    skip_password_requirement: true,
    skip_password_checks: true,
    skip_legal_checks: true,
  });
  if (createRes.status >= 400 && /phone_number is not a valid parameter/i.test(JSON.stringify(createRes.json))) {
    createRes = await backend("POST", "/users", {
      email_address: [email],
      public_metadata: metadata,
      skip_password_requirement: true,
      skip_password_checks: true,
      skip_legal_checks: true,
    });
  }
  if (createRes.status >= 400 || !createRes.json?.id) {
    return { ok: false, reason: JSON.stringify(createRes.json)?.slice(0, 200) };
  }
  return { ok: true, userId: createRes.json.id, email, phone };
}
