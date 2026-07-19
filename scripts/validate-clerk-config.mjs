#!/usr/bin/env node
/**
 * Validate Clerk instance config against BlackOut expectations.
 *
 * Usage:
 *   npm run validate:clerk-config
 */
import { mintClerkPremiumSession } from "./audit/lib/prod-clerk-session.mjs";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const API = "https://api.clerk.com/v1";
const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");

const rows = [];
const rec = (name, status, detail = "") => {
  rows.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

async function clerkGet(secret, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  console.log(`\n=== Clerk config validation ===\n`);

  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) {
    rec("CLERK_SECRET_KEY", "FAIL", "not set");
    process.exit(1);
  }

  const inst = await clerkGet(secret, "/instance");
  rec("instance API", inst.status === 200 ? "PASS" : "FAIL", String(inst.status));

  const origins = inst.json?.allowed_origins ?? [];
  for (const o of ["https://blackouttrades.com", "https://staging.blackouttrades.com"]) {
    rec(`allowed_origin ${o}`, origins.includes(o) ? "PASS" : "FAIL");
  }

  const domains = await clerkGet(secret, "/domains");
  const names = (domains.json?.data ?? []).map((d) => d.name);
  rec("primary domain", names.includes("blackouttrades.com") ? "PASS" : "FAIL", names.join(", "));
  rec(
    "staging satellite",
    (domains.json?.data ?? []).some((d) => d.name === "staging.blackouttrades.com" && d.is_satellite)
      ? "PASS"
      : "WARN"
  );

  const redirects = await clerkGet(secret, "/redirect_urls");
  const urls = (Array.isArray(redirects.json) ? redirects.json : []).map((r) => r.url);
  rec(
    "prod redirect URL",
    urls.some((u) => u.startsWith("https://blackouttrades.com")) ? "PASS" : "WARN",
    `${urls.length} total`
  );

  const wh = await fetch(`${BASE}/api/webhooks/clerk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  rec(
    "webhook endpoint + secret",
    wh.status === 400 ? "PASS" : wh.status === 500 ? "FAIL" : "WARN",
    `HTTP ${wh.status} (400 = secret ok, missing svix)`
  );

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    rec("session JWT claims probe", "SKIP", session.reason);
  } else {
    const sessionCookie = session.cookieHeader
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("__session="));
    const jwt = sessionCookie?.slice("__session=".length);
    const payload = jwt ? decodeJwtPayload(jwt) : null;
    const hasTier = payload && Object.prototype.hasOwnProperty.call(payload, "tier");
    const hasRole = payload && Object.prototype.hasOwnProperty.call(payload, "role");
    if (hasTier && hasRole) {
      rec("JWT tier claim present", "PASS", String(payload.tier ?? ""));
      rec("JWT role claim present", "PASS", String(payload.role ?? ""));
    } else {
      rec(
        "JWT tier+role claims",
        "WARN",
        "not in session token — paste claims from npm run clerk:recommendations-apply"
      );
    }

    const tag = Date.now();
    const probeUser = await fetch(`${API}/users`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: [`jwt-probe-${tag}@blackouttrades.com`],
        phone_number: [generateDefaultAuditPhone()],
        public_metadata: { tier: "premium", role: "admin", tier_managed_by: "admin" },
        skip_password_requirement: true,
        skip_password_checks: true,
        skip_legal_checks: true,
      }),
    });
    const created = await probeUser.json();
    const probeId = created?.id;
    if (probeId) {
      const tokRes = await fetch(`${API}/sign_in_tokens`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: probeId, expires_in_seconds: 120 }),
      });
      const tok = await tokRes.json();
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`${BASE}/sign-in?__clerk_ticket=${encodeURIComponent(tok.token)}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(2000);
      const cookies = await page.context().cookies();
      const probeJwt = cookies.find((c) => c.name === "__session")?.value;
      const probePayload = probeJwt ? decodeJwtPayload(probeJwt) : null;
      await browser.close();
      await fetch(`${API}/users/${probeId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (probePayload?.tier === "premium") {
        rec("JWT tier mirrors metadata (premium probe)", "PASS");
      } else {
        rec(
          "JWT tier mirrors metadata (premium probe)",
          "FAIL",
          `metadata premium but JWT tier=${String(probePayload?.tier)} — use {{user.public_metadata.tier}} in Dashboard session claims (not a literal "free")`
        );
      }
    }
    await session.cleanup?.();
  }

  const org = await clerkGet(secret, "/instance/organization_settings");
  rec("organizations disabled", org.json?.enabled === false ? "PASS" : "WARN");

  const fails = rows.filter((r) => r.status === "FAIL");
  console.log(`\nSummary: ${rows.filter((r) => r.status === "PASS").length} pass, ${fails.length} fail, ${rows.filter((r) => r.status === "WARN").length} warn\n`);
  if (fails.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
