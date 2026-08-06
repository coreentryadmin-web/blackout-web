#!/usr/bin/env node
/**
 * tier-access-e2e.mjs — CTO-level end-to-end verification of the three-tier access matrix.
 *
 * Creates THREE temp Clerk users (free, community, premium), authenticates each via
 * FAPI ticket exchange, and hits every protected route to verify:
 *   - Free:      blocked from /dashboard and all desk pages → redirect to /upgrade
 *   - Community:  allowed on /dashboard, blocked from /flows /heatmap /vector /terminal /nighthawk
 *   - Premium:   allowed everywhere
 *
 * IMPORTANT: The Clerk user.created webhook on production triggers a Whop membership
 * sync that would overwrite manually-set tiers to 'free' (no Whop membership exists for
 * temp users). We block this by setting `tier_managed_by: "admin"` in the metadata, AND
 * re-patching the metadata after a delay to ensure the webhook doesn't race us.
 *
 * Usage:  node --import tsx scripts/audit/tier-access-e2e.mjs [--json] [--quiet]
 * Env:    CLERK_SECRET_KEY (required)
 * Exit:   0 = all pass, 1 = any fail
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomInt } from "node:crypto";

import { createOrAdoptAuditUserViaCurl } from "./lib/clerk-audit-user.mjs";

const SECRET = process.env.CLERK_SECRET_KEY?.trim();
if (!SECRET) { console.error("CLERK_SECRET_KEY is required"); process.exit(1); }

const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const FAPI = "https://clerk.blackouttrades.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const JSON_OUT = process.argv.includes("--json");

const TMP = join(tmpdir(), `bo-tier-e2e-${process.pid}`);
mkdirSync(TMP, { recursive: true });
let seq = 0;

function curl({ method = "GET", url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false, jarFile, followRedirects = false }) {
  const bf = join(TMP, `b${++seq}`);
  const hf = join(TMP, `h${seq}`);
  const jarPath = jarFile || join(TMP, "cookies.txt");
  const args = ["-sS", "--max-time", "30", "-o", bf, "-w", "%{http_code}", "-A", UA, "-D", hf];
  if (followRedirects) args.push("-L");
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push("--data", `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push("--data-urlencode", `${k}=${v}`);
  if (jar) args.push("-b", jarPath);
  if (saveJar) args.push("-c", jarPath);
  args.push(url);
  try {
    const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }).trim());
    const b = existsSync(bf) ? readFileSync(bf, "utf8") : "";
    const hdrs = existsSync(hf) ? readFileSync(hf, "utf8") : "";
    return { s, b, hdrs };
  } catch (e) {
    return { s: 0, b: "", hdrs: "", err: String(e.message || e).split("\n")[0] };
  }
}

const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class TierUser {
  constructor(tier, role = "member") {
    this.tier = tier;
    this.role = role;
    this.email = `claude-e2e-${tier}-${randomInt(100000, 999999)}@blackouttrades.com`;
    this.phone = `+1415555${String(randomInt(0, 10000)).padStart(4, "0")}`;
    this.userId = null;
    this.sid = null;
    this.tok = null;
    this.clientUat = 0;
    this.jarFile = join(TMP, `jar-${tier}.txt`);
  }

  metadata() {
    return {
      tier: this.tier,
      role: this.role,
      tier_managed_by: "admin",
      ...(this.tier === "community" ? { membership_kind: "community" } : {}),
    };
  }

  // async because the shared create-or-adopt helper is (it awaits the transport so the same
  // implementation serves both the spawnSync-curl and fetch harnesses).
  async create() {
    // Shared create-or-adopt: e-mail collision → adopt the leftover user; PHONE collision →
    // redraw a fresh +1415555XXXX and retry. This suite mints THREE users per run, so it is
    // the harness most exposed to a phone clash inside a single pass.
    const auth = await createOrAdoptAuditUserViaCurl({
      curl,
      api: API,
      secret: SECRET,
      email: this.email,
      phone: this.phone,
      publicMetadata: this.metadata(),
    });
    if (auth.error) {
      console.error(`  [${this.tier}] Failed to create user:`, auth.error.slice(0, 220));
      return false;
    }
    this.userId = auth.userId;
    return true;
  }

  repatch() {
    if (!this.userId) return;
    backend("PATCH", `/users/${this.userId}`, { public_metadata: this.metadata() });
  }

  verifyMeta() {
    if (!this.userId) return { ok: false, meta: {} };
    const r = J(curl({ url: `${API}/users/${this.userId}`, headers: { Authorization: `Bearer ${SECRET}` } }));
    const meta = r?.public_metadata || {};
    return { ok: meta.tier === this.tier, meta };
  }

  establish() {
    const ticket = J(backend("POST", "/sign_in_tokens", { user_id: this.userId }))?.token;
    if (!ticket) return false;
    const si = curl({
      method: "POST",
      url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
      headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
      form: { strategy: "ticket" },
      urlencodeForm: { ticket },
      saveJar: true, jar: true,
      jarFile: this.jarFile,
    });
    const newSid = J(si)?.response?.created_session_id;
    if (!newSid) return false;
    this.sid = newSid;
    this.clientUat = Math.floor(Date.now() / 1000);
    return this.mint();
  }

  mint() {
    if (!this.sid) return false;
    const r = curl({
      method: "POST",
      url: `${FAPI}/v1/client/sessions/${this.sid}/tokens?_clerk_js_version=${CJS}`,
      headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
      jar: true, saveJar: true,
      jarFile: this.jarFile,
    });
    this.tok = J(r)?.jwt ?? null;
    return !!this.tok;
  }

  fetch(path) {
    if (!this.tok) this.mint();
    return curl({
      url: `${APP}${path}`,
      headers: {
        Cookie: `__session=${this.tok}; __client_uat=${this.clientUat}`,
      },
    });
  }

  delete() {
    if (this.userId) {
      backend("DELETE", `/users/${this.userId}`);
      this.userId = null;
    }
  }
}

// "blocked" = redirect to /upgrade or /sign-in; "allowed" = 200 with page content
function classifyResponse(r) {
  // 307/302/303 redirect — check Location header
  if (r.s === 307 || r.s === 302 || r.s === 303) {
    const loc = r.hdrs.match(/[Ll]ocation:\s*(\S+)/);
    if (loc && (loc[1].includes("/upgrade") || loc[1].includes("/sign"))) return "blocked";
    return "redirect";
  }
  // Next.js App Router sometimes returns 200 with a redirect body (RSC payload)
  if (r.s === 200) {
    if (r.b.includes("NEXT_REDIRECT") && r.b.includes("/upgrade")) return "blocked";
    if (r.b.length > 200) return "allowed";
  }
  if (r.s === 401 || r.s === 403) return "blocked";
  return `http_${r.s}`;
}

const ROUTES = [
  { path: "/dashboard",  label: "SPX Slayer Desk", free: "blocked", community: "allowed", premium: "allowed" },
  { path: "/flows",      label: "HELIX Flow",      free: "blocked", community: "blocked", premium: "allowed" },
  { path: "/heatmap",    label: "Thermal Heatmap",  free: "blocked", community: "blocked", premium: "allowed" },
  { path: "/vector",     label: "Vector",           free: "blocked", community: "blocked", premium: "allowed" },
  { path: "/terminal",   label: "Largo Terminal",   free: "blocked", community: "blocked", premium: "allowed" },
  { path: "/nighthawk",  label: "Night Hawk",       free: "blocked", community: "blocked", premium: "allowed" },
];

const users = [];
const results = [];
let anyFail = false;

async function main() {
  console.log();
  console.log("  ╔══════════════════════════════════════════════════════════════╗");
  console.log("  ║   TIER ACCESS MATRIX — END-TO-END VERIFICATION (PROD)       ║");
  console.log("  ║   Three temp users × six desk routes + API gate             ║");
  console.log("  ╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // ── Phase 1: Create users ──
  console.log("  PHASE 1 — Create temp Clerk users");
  console.log("  ─────────────────────────────────────────────");
  const tiers = [
    { tier: "free",      role: "member" },
    { tier: "community", role: "member" },
    { tier: "premium",   role: "member" },
  ];

  for (const { tier, role } of tiers) {
    const u = new TierUser(tier, role);
    users.push(u);
    process.stdout.write(`    ${tier.padEnd(10)} create... `);
    if (!(await u.create())) { console.log("FAIL"); anyFail = true; continue; }
    console.log(`OK  (${u.userId})`);
  }

  // Wait for Clerk webhooks to fire, then re-patch metadata
  console.log("    waiting 4s for Clerk webhook to fire...");
  await sleep(4000);
  for (const u of users) {
    u.repatch();
  }
  console.log("    re-patched metadata with tier_managed_by=admin lock");

  // ── Phase 2: Authenticate ──
  console.log();
  console.log("  PHASE 2 — Authenticate via FAPI ticket exchange");
  console.log("  ─────────────────────────────────────────────");
  for (const u of users) {
    if (!u.userId) continue;
    process.stdout.write(`    ${u.tier.padEnd(10)} auth...   `);
    if (!u.establish()) { console.log("FAIL"); anyFail = true; continue; }
    console.log("OK");
  }

  // Re-patch AGAIN after auth (sign-in may trigger another webhook)
  await sleep(2000);
  for (const u of users) u.repatch();

  // Re-mint tokens to pick up the re-patched metadata in JWT claims
  for (const u of users) {
    if (u.sid) {
      u.tok = null;
      u.mint();
    }
  }

  // ── Phase 3: Verify metadata survived ──
  console.log();
  console.log("  PHASE 3 — Verify Clerk metadata");
  console.log("  ─────────────────────────────────────────────");
  for (const u of users) {
    const { ok, meta } = u.verifyMeta();
    const mark = ok ? "✓" : "FAIL";
    if (!ok) anyFail = true;
    console.log(`    ${u.tier.padEnd(10)} tier=${String(meta.tier).padEnd(10)} managed_by=${meta.tier_managed_by || "—"}  ${mark}`);
  }

  // ── Phase 4: Test access matrix ──
  const [freeUser, communityUser, premiumUser] = users;
  console.log();
  console.log("  PHASE 4 — Access matrix (page gates)");
  console.log("  ┌────────────────────┬────────────────────┬──────────┬────────────┬──────────┐");
  console.log("  │ Route              │ Label              │   Free   │ Community  │ Premium  │");
  console.log("  ├────────────────────┼────────────────────┼──────────┼────────────┼──────────┤");

  for (const route of ROUTES) {
    const row = { route: route.path, label: route.label, checks: {} };
    const tierUsers = [
      { user: freeUser,      key: "free" },
      { user: communityUser, key: "community" },
      { user: premiumUser,   key: "premium" },
    ];

    const cells = [];
    for (const { user, key } of tierUsers) {
      const expect = route[key];
      if (!user?.tok) {
        cells.push({ key, actual: "no_auth", expect, pass: false });
        row.checks[key] = { actual: "no_auth", expect, pass: false };
        continue;
      }
      const r = user.fetch(route.path);
      const actual = classifyResponse(r);
      const pass = actual === expect;
      if (!pass) anyFail = true;
      cells.push({ key, actual, expect, pass, status: r.s });
      row.checks[key] = { actual, expect, pass, status: r.s };
    }

    const fmt = (c) => {
      if (c.pass) return c.expect === "allowed" ? " ALLOWED ✓" : " BLOCKED ✓";
      return ` ${c.actual.toUpperCase().slice(0, 8).padEnd(8)} ✗`;
    };

    const routeCol = route.path.padEnd(18);
    const labelCol = route.label.padEnd(18);
    const failMark = cells.every(c => c.pass) ? "" : "  ← FAIL";
    console.log(`  │ ${routeCol} │ ${labelCol} │${fmt(cells[0])}│${fmt(cells[1])}  │${fmt(cells[2])}│${failMark}`);

    results.push(row);
  }
  console.log("  └────────────────────┴────────────────────┴──────────┴────────────┴──────────┘");

  // ── Phase 5: API gate ──
  console.log();
  console.log("  PHASE 5 — Market data API gate");
  console.log("  ─────────────────────────────────────────────");

  // Two API tiers: authorizeMarketDeskApi (community+) and requireTierApi("premium")
  const apiTests = [
    { path: "/api/market/indices", label: "Indices (community+) ", free: 403, community: 200, premium: 200 },
    { path: "/api/market/anomalies", label: "Anomalies (premium)  ", free: 403, community: 403, premium: 200 },
  ];

  let apiTotal = 0, apiPassed = 0;
  for (const test of apiTests) {
    for (const u of [freeUser, communityUser, premiumUser]) {
      if (!u?.tok) continue;
      const r = u.fetch(test.path);
      const expectStatus = test[u.tier];
      const pass = r.s === expectStatus || (expectStatus === 200 && r.s < 400) || (expectStatus === 403 && r.s >= 400);
      apiTotal++;
      if (pass) apiPassed++;
      else anyFail = true;
      const mark = pass ? "✓" : "✗";
      console.log(`    ${u.tier.padEnd(10)} ${test.label.padEnd(24)} → ${r.s}  (expect ${expectStatus})  ${mark}`);
    }
  }

  // ── Summary ──
  console.log();
  const pageTotal = results.reduce((n, r) => n + Object.keys(r.checks).length, 0);
  const pagePassed = results.reduce((n, r) => n + Object.values(r.checks).filter(v => v.pass).length, 0);
  const total = pageTotal + apiTotal;
  const passed = pagePassed + apiPassed;
  console.log("  ═══════════════════════════════════════════════════════════════");
  if (anyFail) {
    console.log(`  RESULT: ${passed}/${total} route checks passed — FAILURES DETECTED`);
    console.log();
    console.log("  NOTE: If community/premium show as BLOCKED, the PR may not be");
    console.log("  deployed yet. The community tier changes in PR #1159 must be");
    console.log("  merged and deployed before community users get /dashboard access.");
  } else {
    console.log(`  RESULT: ${passed}/${total} route checks passed — ALL GREEN ✓`);
  }
  console.log("  ═══════════════════════════════════════════════════════════════");
  console.log();

  if (JSON_OUT) {
    console.log(JSON.stringify({ results, anyFail }, null, 2));
  }
}

let _cleaned = false;
function cleanup() {
  if (_cleaned) return;
  _cleaned = true;
  console.log("  Cleaning up temp users...");
  for (const u of users) {
    try {
      if (u.userId) {
        u.delete();
        console.log(`    deleted ${u.tier} (${u.email})`);
      }
    } catch {}
  }
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
}
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });

main()
  .catch((err) => { console.error("Fatal:", err); anyFail = true; })
  .finally(() => {
    cleanup();
    process.exit(anyFail ? 1 : 0);
  });
