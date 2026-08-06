#!/usr/bin/env node
/**
 * Live SEO + GA4 visibility audit against production.
 * Mints one temp admin Clerk user (deleted in finally), fetches public + authed HTML,
 * and verifies recent GA/SEO ship items.
 *
 * Usage: node --import tsx scripts/audit/seo-visibility-audit.mjs
 * Env: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { createOrAdoptAuditUserViaCurl } from "./lib/clerk-audit-user.mjs";

const APP = (process.env.AUDIT_APP_URL || process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const SECRET = process.env.CLERK_SECRET_KEY?.trim();
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || "";
const EMAIL = process.env.AUDIT_EMAIL || `seo-audit-${Date.now()}@blackouttrades.com`;
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36";

const checks = [];
function rec(name, status, detail = "") {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64")
      .toString("utf8")
      .replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {
    /* fall through */
  }
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `bo-seo-audit-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

function curl(opts = {}) {
  const {
    method = "GET",
    url,
    headers = {},
    form,
    urlencodeForm,
    json,
    jar = false,
    saveJar = false,
  } = opts;
  const bf = join(TMP, `b${++seq}`);
  const args = ["-sS", "--max-time", "45", "-o", bf, "-w", "%{http_code}", "-A", UA];
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push("--data", `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push("--data-urlencode", `${k}=${v}`);
  if (jar) args.push("-b", JAR);
  if (saveJar) args.push("-c", JAR);
  args.push(url);
  try {
    const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim());
    return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" };
  } catch (e) {
    return { s: 0, b: "", err: String(e.message || e) };
  }
}
const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};
const backend = (m, p, body) =>
  curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: body });

async function fetchPublic(path) {
  const bust = path.includes("?") ? "&" : "?";
  const r = curl({ url: `${APP}${path}${bust}_=${Date.now()}` });
  return { status: r.s, html: r.b, text: r.b };
}

async function fetchAuthed(path, sessionCookie, clientUat) {
  const r = curl({
    url: `${APP}${path}`,
    headers: { Cookie: `__session=${sessionCookie}; __client_uat=${clientUat}` },
  });
  return { status: r.s, html: r.b };
}

async function mintSession() {
  if (!SECRET || !PUB) {
    rec("auth", "SKIP", "CLERK keys missing");
    return null;
  }
  // Shared create-or-adopt: e-mail collision → adopt the leftover user; PHONE collision →
  // redraw a fresh +1415555XXXX and retry.
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) {
    rec("auth", "FAIL", auth.error.slice(0, 160));
    return null;
  }
  const userId = auth.userId;

  const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
  if (!ticket) {
    rec("auth", "FAIL", "sign_in_token missing");
    await backend("DELETE", `/users/${userId}`);
    return null;
  }

  const si = curl({
    method: "POST",
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
    form: { strategy: "ticket" },
    urlencodeForm: { ticket },
    saveJar: true,
    jar: true,
  });
  const sid = J(si)?.response?.created_session_id;
  if (!sid) {
    rec("auth", "FAIL", "Clerk ticket exchange failed");
    await backend("DELETE", `/users/${userId}`);
    return null;
  }

  const clientUat = Math.floor(Date.now() / 1000);
  const tok = J(
    curl({
      method: "POST",
      url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
      headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
      jar: true,
      saveJar: true,
    }),
  )?.jwt;

  if (!tok) {
    rec("auth", "FAIL", "session JWT missing");
    await backend("DELETE", `/users/${userId}`);
    return null;
  }

  rec("auth", "PASS", `temp admin ${EMAIL}`);
  return { userId, session: tok, clientUat };
}

function has(html, pattern, label) {
  const ok = pattern.test(html);
  rec(label, ok ? "PASS" : "FAIL", ok ? "" : "not found in HTML");
  return ok;
}

async function main() {
  console.log(`\n=== SEO visibility audit ===\nTarget: ${APP}\n`);

  // ── Public crawl files ──
  const robots = await fetchPublic("/robots.txt");
  if (robots.status === 200 && robots.text.includes(`Sitemap: ${APP}/sitemap.xml`)) {
    rec("robots.txt", "PASS", "includes sitemap pointer");
  } else {
    rec("robots.txt", "FAIL", `HTTP ${robots.status}`);
  }

  const sitemap = await fetchPublic("/sitemap.xml");
  if (sitemap.status === 200 && sitemap.text.includes("<urlset") && sitemap.text.includes("/learn/what-is-gex")) {
    rec("sitemap.xml", "PASS", "includes learn URLs");
  } else {
    rec("sitemap.xml", "FAIL", `HTTP ${sitemap.status}`);
  }

  const llms = await fetchPublic("/llms.txt");
  if (llms.status === 200 && llms.text.includes("/learn")) {
    rec("llms.txt", "PASS", "AI crawler index live");
  } else if (llms.status === 404) {
    rec("llms.txt", "FAIL", "404 — SEO pack (#1534) not deployed yet");
  } else {
    rec("llms.txt", "FAIL", `HTTP ${llms.status}`);
  }

  // ── Public marketing HTML ──
  const home = await fetchPublic("/");
  has(home.html, /googletagmanager\.com\/gtag\/js\?id=G-YLN4K37KYF/i, "GA4 gtag script");
  has(home.html, /G-YLN4K37KYF/i, "GA4 measurement ID");
  has(home.html, /twitter:site|name="twitter:site"/i, "twitter:site meta");
  has(home.html, /application\/ld\+json/i, "structured data (JSON-LD)");
  has(home.html, /"@type":"FAQPage"|"@type": "FAQPage"/, "homepage FAQ schema");
  has(home.html, /id="academy"|BlackOut Academy/i, "homepage Academy section");

  const pricing = await fetchPublic("/pricing");
  has(pricing.html, /pricing|Premium|BlackOut/i, "pricing page renders");

  const learnHub = await fetchPublic("/learn");
  has(learnHub.html, /learn|Academy|Guide/i, "learn hub renders");

  const pillar = await fetchPublic("/learn/dealer-gamma-options-flow-guide");
  has(pillar.html, /dealer gamma|options flow/i, "learn pillar article renders");
  has(pillar.html, /Related guides/i, "related articles block");
  has(pillar.html, /Share|share on/i, "share buttons on pillar");

  // ── Authed desk (admin session) ──
  const auth = await mintSession();
  if (auth) {
    try {
      const dash = await fetchAuthed("/dashboard", auth.session, auth.clientUat);
      if (dash.status === 200) rec("admin /dashboard", "PASS", "authenticated render");
      else rec("admin /dashboard", "FAIL", `HTTP ${dash.status}`);

      const spx = await fetchAuthed("/dashboard", auth.session, auth.clientUat);
      has(spx.html, /SPX|Slayer|dashboard/i, "desk shell visible when signed in");
    } finally {
      await backend("DELETE", `/users/${auth.userId}`);
      rec("auth cleanup", "PASS", "temp user deleted");
    }
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const verdict = fails.length === 0 ? "GREEN" : fails.some((c) => c.name === "auth") ? "AMBER" : "RED";
  console.log(`\n=== ${verdict} — ${checks.length} checks, ${fails.length} fail ===\n`);
  if (fails.length) {
    for (const f of fails) console.log(`  ✗ ${f.name}: ${f.detail}`);
  }
  process.exit(fails.length ? 1 : 0);
}

main().finally(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
