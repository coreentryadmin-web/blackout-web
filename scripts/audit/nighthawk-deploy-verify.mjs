#!/usr/bin/env node
/** One-shot prod verify for Night Hawk command deck deploy (PR #1552). */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { createAuditClerkUser } from "./lib/clerk-audit-user.mjs";

const BASE = "https://blackouttrades.com";
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const EMAIL = `nh-deploy-${Date.now()}@blackouttrades.com`;
const PHONE = generateDefaultAuditPhone();

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {
    /* fall through */
  }
  return "https://clerk.blackouttrades.com";
}

const FAPI = fapiHost();
const checks = [];
const pass = (n, d = "") => {
  checks.push({ n, ok: true, d });
  console.log(`PASS ${n}${d ? `: ${d}` : ""}`);
};
const fail = (n, d = "") => {
  checks.push({ n, ok: false, d });
  console.log(`FAIL ${n}${d ? `: ${d}` : ""}`);
};

async function clerkBackend(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function fapi(path, init = {}, jar = {}) {
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const r = await fetch(`${FAPI}${path}`, {
    ...init,
    headers: {
      Origin: BASE,
      Referer: `${BASE}/`,
      ...(init.headers || {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const m = c.match(/^([^=]+)=([^;]+)/);
    if (m) jar[m[1]] = m[2];
  }
  const text = await r.text();
  try {
    return { json: JSON.parse(text), jar };
  } catch {
    return { json: null, text, jar };
  }
}

if (!SECRET) {
  console.error("CLERK_SECRET_KEY missing");
  process.exit(1);
}

// adopt:false — the e-mail is per-run unique, so only the random PHONE can collide; the
// shared helper redraws it rather than aborting the deploy verification.
const user = await createAuditClerkUser({ secret: SECRET, email: EMAIL, phone: PHONE, adopt: false });
const userId = user.userId;
if (!userId) {
  console.error("user create failed", String(user.error).slice(0, 200));
  process.exit(1);
}

const ticket = (await clerkBackend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
if (!ticket) {
  console.error("sign_in_token failed");
  process.exit(1);
}

let jar = {};
await fapi(
  `/v1/client/sign_ins?_clerk_js_version=${CJS}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ strategy: "ticket", ticket }).toString(),
  },
  jar,
);

const client = (await fapi(`/v1/client?_clerk_js_version=${CJS}`, {}, jar)).json;
const sid = client?.response?.last_active_session_id;
const clientUat = Math.floor(Date.now() / 1000);
const tok = (
  await fapi(
    `/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "" },
    jar,
  )
).json?.jwt;

const board = await fetch(`${BASE}/api/market/zerodte/board`, {
  headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" },
}).then((r) => r.json());

if (board?.available === true || Array.isArray(board?.setups)) {
  pass("zerodte board authed", `as_of=${board?.as_of ?? "n/a"} setups=${board?.setups?.length ?? 0}`);
} else {
  fail("zerodte board authed", board?.degraded ? "degraded" : JSON.stringify(board)?.slice(0, 120));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([
  { name: "__session", value: tok, domain: "blackouttrades.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" },
  { name: "__client_uat", value: String(clientUat), domain: "blackouttrades.com", path: "/", secure: true, httpOnly: false, sameSite: "Lax" },
]);
const page = await context.newPage();
await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(12_000);

const text = await page.locator("body").innerText();
const html = await page.content();

if (text.includes("Engine") && text.includes("Last Update")) pass("UI engine status labels");
else fail("UI engine status labels");

if (/Monitoring|Standby|Syncing|Offline/.test(text)) {
  pass("UI engine mode", text.match(/Monitoring|Standby|Syncing|Offline/)?.[0] ?? "");
} else {
  fail("UI engine mode");
}

if (text.includes("Opportunities") || text.includes("Top Rated")) pass("UI command center");
else fail("UI command center");

if (html.includes("nh-deck-engine-status") || html.includes("nh-deck-lc") || html.includes("nh-deck-cmd")) {
  pass("UI deck markers in DOM");
} else {
  fail("UI deck markers in DOM");
}

if (/sec ago|m ago|just now/i.test(text)) pass("UI relative age");
else fail("UI relative age");

const shot = "/opt/cursor/artifacts/nighthawk-deploy-verify.png";
await page.screenshot({ path: shot, fullPage: false });
pass("screenshot", shot);

await browser.close();
await clerkBackend("DELETE", `/users/${userId}`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n=== ${checks.length - failed.length}/${checks.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);
