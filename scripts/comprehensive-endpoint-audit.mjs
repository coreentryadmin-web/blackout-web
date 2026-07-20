#!/usr/bin/env node
/**
 * Comprehensive live endpoint audit — every internal /api route + upstream UW/Polygon paths
 * wired in production code (live-api-integrations.ts).
 *
 * Usage:
 *   node scripts/comprehensive-endpoint-audit.mjs
 *   node scripts/comprehensive-endpoint-audit.mjs --base=https://blackouttrades.com
 *   node scripts/comprehensive-endpoint-audit.mjs --skip-upstream   # app routes only
 *
 * Secrets (env): CRON_SECRET, CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
 *                UW_API_KEY, POLYGON_API_KEY (for upstream phase)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { generateDefaultAuditPhone } from "./audit/lib/audit-phone.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const SKIP_UPSTREAM = process.argv.includes("--skip-upstream");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const CRON = process.env.CRON_SECRET?.trim() ?? "";
const SECRET = process.env.CLERK_SECRET_KEY?.trim() ?? "";
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const UW_KEY = (process.env.UW_API_KEY ?? "").trim();
const POLY_KEY = (process.env.POLYGON_API_KEY ?? process.env.MASSIVE_API_KEY ?? "").trim();
const UW_BASE = (process.env.UW_API_BASE ?? "https://api.unusualwhales.com").replace(/\/$/, "");
const POLY_BASE = (process.env.POLYGON_API_BASE ?? "https://api.polygon.io").replace(/\/$/, "");

const checks = [];
function rec(name, status, detail, extra = {}) {
  checks.push({ name, status, detail, ...extra });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "·";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function discoverApiRoutes(dir = join(process.cwd(), "src/app/api"), prefix = "/api") {
  const routes = [];
  for (const ent of readdirSync(dir)) {
    const full = join(dir, ent);
    if (statSync(full).isDirectory()) {
      if (ent.startsWith("[") && ent.endsWith("]")) {
        const param = ent.slice(1, -1).replace("...", "health");
        routes.push(...discoverApiRoutes(full, `${prefix}/${param}`));
      } else {
        routes.push(...discoverApiRoutes(full, `${prefix}/${ent}`));
      }
    } else if (ent === "route.ts") {
      routes.push(prefix);
    }
  }
  return routes.sort();
}

/** Premium desk probes with query params — one GET per product surface. */
const PRODUCT_PROBES = [
  { product: "SPX", path: "/api/market/spx/desk", hasData: (j) => j?.price > 0 },
  { product: "SPX", path: "/api/market/spx/bootstrap", hasData: (j) => j?.desk != null || j?.merged != null },
  { product: "SPX", path: "/api/market/spx/play", hasData: (j) => j?.phase != null || j?.status != null },
  { product: "SPX", path: "/api/market/gex-heatmap?ticker=SPX", hasData: (j) => j?.strikes?.length > 0 && j?.spot > 0 },
  { product: "SPX", path: "/api/market/gex-positioning?ticker=SPX", hasData: (j) => j?.spot > 0 },
  { product: "Thermal", path: "/api/market/gex-heatmap?ticker=SPY", hasData: (j) => j?.strikes?.length > 0 },
  { product: "Thermal", path: "/api/market/gex-heatmap/explain?ticker=SPY", hasData: (j) => typeof j?.summary === "string" || typeof j?.text === "string" },
  { product: "Thermal", path: "/api/market/heatmap?ticker=NVDA", hasData: (j) => j != null },
  { product: "HELIX", path: "/api/market/flows?limit=50", hasData: (j) => Array.isArray(j?.flows) },
  { product: "HELIX", path: "/api/market/flow-brief", hasData: (j) => j != null },
  { product: "HELIX", path: "/api/market/dark-pool/ticker?ticker=NVDA", hasData: (j) => j != null },
  { product: "Vector", path: "/api/market/vector/walls?ticker=NVDA&dte=all", hasData: (j) => j?.walls != null || j?.callWalls != null },
  { product: "Vector", path: "/api/market/vector/gex-ladder?ticker=NVDA&dte=all", hasData: (j) => j?.ladder != null || j?.rows != null },
  { product: "Vector", path: "/api/market/vector/bars?ticker=NVDA&timeframe=5", hasData: (j) => Array.isArray(j?.bars) && j.bars.length > 0 },
  { product: "Vector", path: "/api/market/vector/prior-day?ticker=NVDA", hasData: (j) => j?.pdh > 0 || j?.pdl > 0 },
  { product: "Vector", path: "/api/market/vector/universe", hasData: (j) => Array.isArray(j?.tickers) || j?.rows != null },
  { product: "NightHawk", path: "/api/market/nighthawk/edition", hasData: (j) => j?.available != null },
  { product: "NightHawk", path: "/api/nighthawk/play-status", hasData: (j) => j != null },
  { product: "0DTE", path: "/api/market/zerodte/board", hasData: (j) => j?.available === true },
  { product: "0DTE", path: "/api/market/zerodte/record", hasData: (j) => j != null },
  { product: "Largo", path: "/api/market/largo/session", hasData: (j) => j != null },
  { product: "Platform", path: "/api/market/platform/snapshot", hasData: (j) => j?.as_of != null },
  { product: "Platform", path: "/api/platform/intel", hasData: (j) => j != null },
  { product: "Market", path: "/api/market/quote?ticker=SPY", hasData: (j) => j?.price > 0 || j?.last > 0 },
  { product: "Market", path: "/api/market/indices", hasData: (j) => j?.indices?.length > 0 || j?.SPX != null || j?.SPY != null || typeof j?.SPX === "number" },
  { product: "Market", path: "/api/market/news?ticker=NVDA&limit=5", hasData: (j) => Array.isArray(j?.items) || Array.isArray(j?.news) || Array.isArray(j?.results) },
  { product: "Market", path: "/api/market/earnings-calendar", hasData: (j) => j?.earnings != null },
  { product: "Market", path: "/api/market/regime", hasData: (j) => j?.regime != null || j?.composite != null },
  { product: "Admin", path: "/api/admin/health", hasData: (j) => typeof j === "object" },
  { product: "Admin", path: "/api/admin/helix/health", hasData: (j) => typeof j === "object" },
  { product: "TrackRecord", path: "/api/track-record", hasData: (j) => j?.stats != null || j?.liveData != null },
];

const UW_LIVE_PATHS = [
  "/api/market/market-tide",
  "/api/option-trades/flow-alerts?limit=5",
  "/api/stock/SPY/spot-exposures",
  "/api/stock/SPY/spot-exposures/strike",
  "/api/stock/SPY/gex-levels",
  "/api/stock/SPY/max-pain",
  "/api/stock/SPY/nope",
  "/api/stock/SPY/volatility/stats",
  "/api/stock/SPY/net-prem-ticks",
  "/api/stock/SPY/flow-alerts?limit=5",
  "/api/stock/SPY/greek-flow",
  "/api/darkpool/SPY",
  "/api/net-flow/expiry",
  "/api/market/economic-calendar",
];

const POLY_LIVE_PATHS = [
  "/v3/snapshot/indices?ticker.any_of=I:SPX",
  "/v2/snapshot/locale/us/markets/stocks/tickers/SPY",
  "/v2/aggs/ticker/SPY/prev",
  "/v1/marketstatus/now",
  "/benzinga/v2/news?ticker=NVDA&limit=5",
];

function fapiHost(pub) {
  try {
    const d = Buffer.from(pub.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return "https://" + d;
  } catch {}
  return "https://clerk.blackouttrades.com";
}

const CJS = "5.57.0";

const TMP = join(tmpdir(), "comprehensive-audit-" + process.pid);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;
let sessionJwt = null;
let clientUat = 0;
let sid = null;
let userId = null;

function curl(opts) {
  const bf = join(TMP, "b" + ++seq);
  const args = ["-sS", "--max-time", String(opts.maxTime ?? 60), "-o", bf, "-w", "%{http_code}|%{time_total}"];
  if (opts.method && opts.method !== "GET") args.push("-X", opts.method);
  for (const [k, v] of Object.entries(opts.headers ?? {})) args.push("-H", k + ": " + v);
  if (opts.json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(opts.json));
  if (opts.urlencodeForm)
    for (const [k, v] of Object.entries(opts.urlencodeForm)) args.push("--data-urlencode", k + "=" + v);
  if (opts.jar) args.push("-b", JAR);
  if (opts.saveJar) args.push("-c", JAR);
  args.push(opts.url);
  try {
    const raw = execFileSync("curl", args, { encoding: "utf8" }).trim();
    const [statusStr, timeStr] = raw.split("|");
    let body = "";
    try {
      body = readFileSync(bf, "utf8");
    } catch {}
    return { status: Number(statusStr), timeMs: Math.round(Number(timeStr) * 1000), body };
  } catch (e) {
    const out = String(e.stdout ?? "").trim();
    const [statusStr, timeStr] = out.split("|");
    let body = "";
    try {
      body = readFileSync(bf, "utf8");
    } catch {}
    return {
      status: Number(statusStr) || 0,
      timeMs: Math.round(Number(timeStr || opts.maxTime || 60) * 1000),
      body,
      timedOut: true,
    };
  }
}

const J = (r) => {
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
};

function establishAdmin() {
  if (!SECRET) {
    rec("auth", "WARN", "CLERK_SECRET_KEY missing — premium probes skipped");
    return false;
  }
  const API = "https://api.clerk.com/v1";
  const FAPI = fapiHost(PUB);
  const EMAIL = "endpoint-audit-" + Date.now() + "@blackouttrades.com";
  const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
  const backend = (method, path, json) =>
    J(curl({ method, url: API + path, headers: { Authorization: "Bearer " + SECRET }, json }));

  const created = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  userId = created?.id;
  if (!userId) {
    rec("auth:create-user", "FAIL", JSON.stringify(created).slice(0, 120));
    return false;
  }

  const ticket = backend("POST", "/sign_in_tokens", { user_id: userId, expires_in_seconds: 600 })?.token;
  if (!ticket) {
    rec("auth:sign-in-token", "FAIL", "no token");
    return false;
  }

  const si = curl({
    method: "POST",
    url: FAPI + "/v1/client/sign_ins?_clerk_js_version=" + CJS,
    headers: { Origin: BASE, Referer: BASE + "/", "Content-Type": "application/x-www-form-urlencoded" },
    urlencodeForm: { strategy: "ticket", ticket },
    saveJar: true,
    jar: true,
  });
  sid = J(si)?.response?.created_session_id;
  if (!sid) {
    rec("auth:FAPI-ticket", "FAIL", si.body.slice(0, 120));
    return false;
  }
  clientUat = Math.floor(Date.now() / 1000);
  mintJwt();
  rec("auth:admin-session", sessionJwt ? "PASS" : "FAIL", EMAIL);
  return Boolean(sessionJwt);
}

function mintJwt() {
  const FAPI = fapiHost(PUB);
  sessionJwt = J(
    curl({
      method: "POST",
      url: FAPI + "/v1/client/sessions/" + sid + "/tokens?_clerk_js_version=" + CJS,
      headers: { Origin: BASE, Referer: BASE + "/", "Content-Type": "application/x-www-form-urlencoded" },
      jar: true,
      saveJar: true,
    }),
  )?.jwt;
}

function cleanupUser() {
  if (!userId || !SECRET) return;
  try {
    curl({
      method: "DELETE",
      url: "https://api.clerk.com/v1/users/" + userId,
      headers: { Authorization: "Bearer " + SECRET },
    });
  } catch {}
}

const SSE_OR_LONG_POLL = [
  "/stream",
  "/api/market/spx/pulse/stream",
  "/api/market/flows/stream",
  "/api/account/positions/stream",
  "/api/admin/apis/stream",
];

function isLongRunningPath(path) {
  return SSE_OR_LONG_POLL.some((s) => path.includes(s));
}

function appFetch(path, mode = "anon") {
  const headers = { Accept: "application/json" };
  if (mode === "cron" && CRON) headers.Authorization = "Bearer " + CRON;
  if (mode === "admin" && sessionJwt) {
    headers.Cookie = "__session=" + sessionJwt + "; __client_uat=" + clientUat;
  }
  if (isLongRunningPath(path)) {
    const r = curl({ url: BASE + path, headers, jar: mode === "admin", maxTime: 5 });
    if (r.status === 200 || r.timedOut) return { ...r, status: r.status || 200 };
    return r;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (mode === "admin" && !sessionJwt) mintJwt();
    const r = curl({ url: BASE + path, headers, jar: mode === "admin", maxTime: 90 });
    if (mode === "admin" && (r.status === 401 || r.status === 403) && attempt === 0) {
      mintJwt();
      continue;
    }
    return r;
  }
  return curl({ url: BASE + path, headers, maxTime: 90 });
}

function scanFinite(obj, path = "", out = []) {
  if (obj == null) return out;
  if (typeof obj === "number" && !Number.isFinite(obj)) out.push(`${path}=${obj}`);
  else if (Array.isArray(obj)) obj.slice(0, 50).forEach((v, i) => scanFinite(v, `${path}[${i}]`, out));
  else if (typeof obj === "object")
    for (const [k, v] of Object.entries(obj)) scanFinite(v, path ? `${path}.${k}` : k, out);
  return out;
}

async function auditPublicRoutes() {
  console.log("\n=== PUBLIC ROUTES ===\n");
  for (const path of ["/api/health", "/api/ready", "/api/market/regime"]) {
    const r = appFetch(path, "anon");
    const ok = r.status === 200;
    rec(`public ${path}`, ok ? "PASS" : "FAIL", `HTTP ${r.status} (${r.timeMs}ms)`);
  }
}

async function auditCronRoutes() {
  console.log("\n=== CRON ROUTES (sample) ===\n");
  if (!CRON) {
    rec("cron", "WARN", "CRON_SECRET missing");
    return;
  }
  const samples = [
    "/api/cron/socket-health",
    "/api/cron/heatmap-warm",
    "/api/cron/data-correctness?force=0",
    "/api/market/spx/desk",
    "/api/signals/open",
  ];
  for (const path of samples) {
    const r = appFetch(path, "cron");
    rec(`cron ${path}`, r.status === 200 ? "PASS" : r.status >= 500 ? "FAIL" : "WARN", `HTTP ${r.status}`);
  }
}

async function auditProductProbes() {
  console.log("\n=== PRODUCT API PROBES (admin session) ===\n");
  if (!sessionJwt) {
    rec("product-probes", "SKIP", "no admin session");
    return;
  }
  for (const p of PRODUCT_PROBES) {
    const r = appFetch(p.path, "admin");
    const j = J(r);
    if (r.status >= 500) {
      rec(`${p.product} ${p.path}`, "FAIL", `HTTP ${r.status}`);
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      rec(`${p.product} ${p.path}`, "FAIL", `HTTP ${r.status} — admin should pass`);
      continue;
    }
    if (r.status === 404 || r.status === 423) {
      rec(`${p.product} ${p.path}`, "WARN", `HTTP ${r.status}`);
      continue;
    }
    const bad = j ? scanFinite(j).slice(0, 2) : [];
    if (bad.length) {
      rec(`${p.product} ${p.path}`, "FAIL", `non-finite: ${bad.join("; ")}`);
      continue;
    }
    const has = j && p.hasData(j);
    rec(`${p.product} ${p.path}`, has ? "PASS" : "WARN", has ? `HTTP ${r.status} data ok` : `HTTP ${r.status} empty/stale`);
  }
}

async function auditRouteDiscovery() {
  console.log("\n=== ROUTE DISCOVERY (GET smoke, admin) ===\n");
  const routes = discoverApiRoutes();
  rec("routes discovered", "INFO", String(routes.length));

  const skipPostOnly = new Set([
    "/api/market/largo/query",
    "/api/market/spx/commentary",
    "/api/market/nighthawk/hunt",
    "/api/webhooks/clerk",
    "/api/webhook/whop",
  ]);
  const skipOAuth = new Set(["/api/auth/cognito/callback", "/api/auth/cognito/login"]);

  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const path of routes) {
    if (skipPostOnly.has(path) || skipOAuth.has(path)) {
      skip++;
      continue;
    }
    const r = sessionJwt ? appFetch(path, "admin") : appFetch(path, "cron");
    if (r.status >= 500) {
      rec(`route ${path}`, "FAIL", `HTTP ${r.status}`);
      fail++;
    } else if (r.status === 405) {
      pass++;
    } else if (r.status === 401 && !sessionJwt) {
      skip++;
    } else {
      pass++;
    }
  }
  rec("route-smoke summary", pass > fail ? "PASS" : "WARN", `${pass} ok, ${fail} 5xx, ${skip} skipped`);
}

function resolveUwTemplate(template, ticker = "SPY") {
  return template
    .replace(/\{ticker\}/g, ticker)
    .replace(/\{flow_group\}/g, "mag7")
    .replace(/\{indicator\}/g, "GDP");
}

function loadLiveUwPaths() {
  const src = readFileSync(join(process.cwd(), "src/lib/live-api-integrations.ts"), "utf8");
  const paths = new Set();
  for (const m of src.matchAll(/fetchUw\w+:\s*"([^"]+)"/g)) paths.add(m[1]);
  for (const m of src.matchAll(/"([^"]+)"/g)) {
    if (m[0].includes("flow_alerts") || m[0].includes("market_tide")) {
      /* skip — handled by UW_WS_CHANNELS block below */
    }
  }
  const wsBlock = src.match(/export const UW_WS_CHANNELS = \[([\s\S]*?)\] as const/);
  if (wsBlock) {
    for (const ch of wsBlock[1].matchAll(/"([^"]+)"/g)) {
      paths.add(`/api/socket/${ch[1]}`);
    }
  }
  return [...paths].sort();
}

function upstreamHasPayload(body) {
  if (body == null) return false;
  if (Array.isArray(body)) return body.length > 0;
  if (Array.isArray(body.data)) return body.data.length > 0;
  if (Array.isArray(body.results)) return body.results.length > 0;
  if (typeof body === "object") return Object.keys(body).length > 0;
  return false;
}

async function sleep(ms) {
  await new Promise((res) => setTimeout(res, ms));
}

async function auditUpstream() {
  if (SKIP_UPSTREAM) {
    rec("upstream", "SKIP", "--skip-upstream");
    return;
  }

  console.log("\n=== UPSTREAM: UNUSUAL WHALES (live integrations) ===\n");
  const uwTemplates = loadLiveUwPaths().filter((p) => p.startsWith("/api/stock") || p.startsWith("/api/") && !p.startsWith("/api/socket/"));
  const uwProbePaths = [...new Set([...UW_LIVE_PATHS, ...uwTemplates.map((t) => resolveUwTemplate(t))])];

  if (!UW_KEY) {
    rec("uw-upstream", "WARN", "UW_API_KEY missing");
  } else {
    let uwPass = 0;
    let uwFail = 0;
    for (const path of uwProbePaths) {
      const qs = path.includes("flow-alerts") || path.includes("limit") ? "" : path.includes("market-tide") ? "?interval_5m=true" : path.includes("?") ? "" : "";
      const full = UW_BASE + path + (path.includes("flow-alerts") && !path.includes("limit") ? "?limit=5" : qs);
      const r = curl({
        url: full,
        headers: { Authorization: "Bearer " + UW_KEY, Accept: "application/json" },
        maxTime: 45,
      });
      const j = J(r);
      const ok = r.status >= 200 && r.status < 300 && upstreamHasPayload(j);
      if (ok) uwPass++;
      else uwFail++;
      rec(`uw ${path}`, ok ? "PASS" : r.status === 429 ? "WARN" : "FAIL", `HTTP ${r.status}${j?.error ? " — " + String(j.error).slice(0, 60) : ""}`);
      await sleep(700);
    }
    rec("uw-upstream summary", uwFail === 0 ? "PASS" : "WARN", `${uwPass} ok, ${uwFail} fail (${uwProbePaths.length} probed)`);
  }

  console.log("\n=== UPSTREAM: POLYGON / MASSIVE ===\n");
  if (!POLY_KEY) {
    rec("polygon-upstream", "WARN", "POLYGON_API_KEY missing");
  } else {
    let polyPass = 0;
    let polyFail = 0;
    for (const path of POLY_LIVE_PATHS) {
      const sep = path.includes("?") ? "&" : "?";
      const r = curl({
        url: POLY_BASE + path + sep + "apiKey=" + encodeURIComponent(POLY_KEY),
        headers: { Accept: "application/json" },
        maxTime: 45,
      });
      const j = J(r);
      const apiErr = j?.status === "ERROR" || j?.error;
      const ok = r.status >= 200 && r.status < 300 && !apiErr && upstreamHasPayload(j);
      if (ok) polyPass++;
      else polyFail++;
      rec(`polygon ${path}`, ok ? "PASS" : "FAIL", `HTTP ${r.status}${apiErr ? " — " + String(j.error ?? j.message).slice(0, 60) : ""}`);
      await sleep(150);
    }
    rec("polygon-upstream summary", polyFail === 0 ? "PASS" : "WARN", `${polyPass} ok, ${polyFail} fail`);
  }

  // Surface stale docs-probe report if present (full 265-endpoint catalog)
  try {
    const prior = JSON.parse(readFileSync(join(process.cwd(), "src/lib/docs-probe-report.json"), "utf8"));
    const s = prior.summary;
    const usedFail = prior.results.filter((r) => r.usedInCode && !r.probe.ok && !r.probe.blocked).length;
    rec(
      "docs-probe catalog (cached)",
      usedFail === 0 ? "PASS" : "WARN",
      `${s.probedTotal} documented · used-in-code failures=${usedFail} (run npm run probe:docs to refresh)`,
    );
  } catch {
    rec("docs-probe catalog", "WARN", "no src/lib/docs-probe-report.json — run npm run probe:docs");
  }
}

function writeReport() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(OUT, `comprehensive-endpoint-audit-${ts}.json`);
  const mdPath = join(OUT, `comprehensive-endpoint-audit-${ts}.md`);
  const totals = checks.reduce(
    (acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    },
    {},
  );
  writeFileSync(jsonPath, JSON.stringify({ base: BASE, at: new Date().toISOString(), totals, checks }, null, 2));
  const lines = [
    "# Comprehensive Endpoint Audit",
    "",
    `Target: ${BASE}`,
    `At: ${new Date().toISOString()}`,
    "",
    "## Totals",
    "",
    ...Object.entries(totals).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Checks",
    "",
    ...checks.map((c) => `- [${c.status}] ${c.name}${c.detail ? " — " + c.detail : ""}`),
  ];
  writeFileSync(mdPath, lines.join("\n"));
  console.log(`\nReport: ${mdPath}`);
  return { jsonPath, mdPath, totals };
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║  COMPREHENSIVE ENDPOINT AUDIT (app + upstream)           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Target: ${BASE}\n`);

  try {
    establishAdmin();
    await auditPublicRoutes();
    await auditCronRoutes();
    await auditProductProbes();
    await auditRouteDiscovery();
    await auditUpstream();
  } finally {
    cleanupUser();
  }

  const { totals } = writeReport();
  const fails = (totals.FAIL ?? 0) + (totals.WARN ?? 0);
  console.log("\nTOTALS", JSON.stringify(totals));
  process.exit((totals.FAIL ?? 0) > 0 ? 1 : fails > 5 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
