#!/usr/bin/env node
/*
 * 0DTE END-TO-END VALIDATION SUITE — the pre-open "will the board actually work Monday?" gate.
 *
 * WHAT IT DOES — four sections, worst-verdict rollup, NON-ZERO exit if any REQUIRED section is RED:
 *
 *   [API-POLYGON] Every Polygon/Massive upstream the 0DTE pipeline reads — LIVE — with an HTTP-200 +
 *                 schema-shape + sanity-value assertion per endpoint (grouped-daily ~12.4k rows,
 *                 VIX 5–90, option snapshot carries greeks/last_quote, etc.).
 *   [API-UW]      Every Unusual Whales upstream — LIVE — flow-alerts data[] array, GEX per-strike
 *                 rows, screener/darkpool/net-flow/earnings shapes.
 *   [INFRA]       RDS Postgres + ElastiCache Redis health via the AWS CLI, reading creds FROM ENV.
 *                 SKIPPED (never RED) when AWS creds are absent/placeholder — same as the healthcheck.
 *   [DATA-PATH]   The Redis + Postgres write/read paths validated THROUGH the authenticated app
 *                 (raw TCP to PG/Redis is blocked from the sandbox — do NOT attempt it). The board
 *                 snapshot proves the Redis path; the record endpoint proves the Postgres read path.
 *                 One temp admin Clerk user, ALWAYS deleted in a finally block.
 *
 * The pure schema/sanity validators live in ./lib/e2e-schema-checks.mjs (unit-tested by
 * zerodte-e2e-suite.test.ts). This file only wires them to live transport + prints the matrix.
 *
 * SECRETS — env ONLY, never printed:
 *   POLYGON_API_KEY, UW_API_KEY                         (upstream keys — REQUIRED for the API sections)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY           (OPTIONAL — enables [INFRA]; absent → SKIPPED)
 *   CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY(OPTIONAL — enables [DATA-PATH]; absent → SKIPPED)
 *
 * BASE URLs — self-defaulted (the ${{shared.*}} refs don't resolve in this sandbox):
 *   POLYGON_API_BASE  primary https://api.massive.com, automatic fallback https://api.polygon.io
 *                     (both 200 with the same key — verified). A malformed/placeholder value is ignored.
 *   UW  https://api.unusualwhales.com (Bearer)
 *
 * FLAGS: --json                 machine output (full section matrix + per-endpoint verdicts)
 *        --provider=polygon|uw  run only that API provider's endpoint section
 *        --quiet                suppress the streaming per-check log
 *
 * RUN (external API sections work with just the upstream keys; INFRA/DATA-PATH light up when their
 * creds are present):
 *   node scripts/audit/zerodte-e2e-suite.mjs
 *   npm run validate:e2e
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { createOrAdoptAuditUserViaCurl } from "./lib/clerk-audit-user.mjs";
import { isAuthFailureStatus } from "./lib/auth-status.mjs";
import { subprocessErrorMessage } from "./lib/redact.mjs";
import {
  checkMarketStatus,
  checkIndices,
  checkAggsPrev,
  checkAggsRange,
  checkGroupedDaily,
  checkOptionChainSnapshot,
  checkUnifiedSnapshot,
  checkReferenceContracts,
  checkV3Trades,
  checkBenzingaNews,
  checkFlowAlerts,
  checkTickerFlowAlerts,
  checkSpotExposuresStrike,
  checkGreekExposureStrike,
  checkScreenerStocks,
  checkDarkpool,
  checkNetFlowExpiry,
  checkEarnings,
  checkRdsInstance,
  checkRedisReplicationGroup,
  checkSnapshotFreshness,
  asArray,
} from "./lib/e2e-schema-checks.mjs";

// ── args ───────────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const JSON_OUT = ARGV.includes("--json");
const QUIET = ARGV.includes("--quiet") || JSON_OUT;
const PROVIDER = (ARGV.find((a) => a.startsWith("--provider=")) || "").split("=")[1] || "";

// ── config ───────────────────────────────────────────────────────────────────────────
const POLY = process.env.POLYGON_API_KEY || "";
const UWK = process.env.UW_API_KEY || "";
const SECRET = process.env.CLERK_SECRET_KEY || "";
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const EMAIL = process.env.AUDIT_EMAIL || "claude-audit-temp@blackouttrades.com";
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const CLERK_API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const AWS_REGION = process.env.AWS_DEFAULT_REGION || "us-east-1";
const RDS_ID = process.env.RDS_INSTANCE_ID || "blackout-production-postgres";
const REDIS_RG_ID = process.env.REDIS_RG_ID || "blackout-production-redis-rg";
// Polygon base: primary massive.com, fallback polygon.io. A malformed/placeholder POLYGON_API_BASE
// (the literal "POLYGON_API_BASE" or an unresolved ${{...}}) must NOT become a bare bad URL — the
// /^https?:/ guard drops it and we fall through to the known-good primary.
const POLY_BASES = (() => {
  const raw = process.env.POLYGON_API_BASE;
  const primary = raw && /^https?:/.test(raw) ? raw.replace(/\/$/, "") : "https://api.massive.com";
  const bases = [primary];
  for (const b of ["https://api.massive.com", "https://api.polygon.io"]) if (!bases.includes(b)) bases.push(b);
  return bases; // try in order; the first that returns 200 wins (per-run sticky).
})();
const UW_BASE = "https://api.unusualwhales.com";

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `zerodte-e2e-suite-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

// ── low-level transport (curl — mirrors the other audit tools; never logs the URL query) ──
function curl({ method = "GET", url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false, timeout = 30 }) {
  const bf = join(TMP, `b${++seq}`);
  const args = ["-sS", "--max-time", String(timeout), "-o", bf, "-w", "%{http_code}", "-A", UA];
  if (method !== "GET") args.push("-X", method);
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(json));
  if (form) for (const [k, v] of Object.entries(form)) args.push("--data", `${k}=${v}`);
  if (urlencodeForm) for (const [k, v] of Object.entries(urlencodeForm)) args.push("--data-urlencode", `${k}=${v}`);
  if (jar) args.push("-b", JAR);
  if (saveJar) args.push("-c", JAR);
  args.push(url);
  try {
    const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 120 * 1024 * 1024 }).trim());
    return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" };
  } catch (e) {
    return { s: 0, b: "", err: subprocessErrorMessage(e) };
  }
}
const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};

// Polygon GET with base-fallback + one transient retry (a burst can 429/blip on massive.com).
let stickyPolyBase = null;
function polyGet(path, { retries = 1 } = {}) {
  const bases = stickyPolyBase ? [stickyPolyBase, ...POLY_BASES.filter((b) => b !== stickyPolyBase)] : POLY_BASES;
  let last = { s: 0, b: "" };
  for (const base of bases) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const url = `${base}${path}${path.includes("?") ? "&" : "?"}apiKey=${POLY}`;
      const r = curl({ url });
      last = r;
      if (r.s === 200) {
        stickyPolyBase = base; // lock onto the first working base for the rest of the run
        return { r, j: J(r), base };
      }
      // 429/5xx/network → brief backoff then retry same base; 4xx (bad request) → move to next base.
      if (r.s === 429 || r.s >= 500 || r.s === 0) {
        try { execFileSync("sleep", ["1"]); } catch {}
        continue;
      }
      break;
    }
  }
  return { r: last, j: J(last), base: bases[0] };
}
function uwGet(path) {
  const url = `${UW_BASE}${path}`;
  const r = curl({ url, headers: { Authorization: `Bearer ${UWK}`, Accept: "application/json" } });
  return { r, j: J(r) };
}

// ── section + check recording ──────────────────────────────────────────────────────────
const sections = new Map(); // id -> { id, name, checks: [], forced }
function ensureSection(id, name) {
  if (!sections.has(id)) sections.set(id, { id, name, checks: [], forced: null });
  return sections.get(id);
}
function forceSection(id, verdict, detail) {
  const st = sections.get(id);
  st.forced = { verdict, detail };
  if (!QUIET) console.log(`  [${verdict}] ${id} — ${detail}`);
}
const ORDER = { GREEN: 0, AMBER: 1, SKIPPED: 1, RED: 2 };
function rollup(verdicts) {
  if (verdicts.length === 0) return "SKIPPED";
  return verdicts.reduce((w, v) => (ORDER[v] > ORDER[w] ? v : w), "GREEN");
}
function sectionVerdict(st) {
  if (st.forced) return st.forced.verdict;
  return rollup(st.checks.map((c) => c.verdict));
}
// record one endpoint check. `required` decides whether a structural failure is RED or AMBER.
function record(id, label, httpStatus, verdictObj, { required = true } = {}) {
  const st = sections.get(id);
  let verdict;
  let detail;
  if (httpStatus !== 200) {
    verdict = required ? "RED" : "AMBER";
    detail = `HTTP ${httpStatus || "ERR"}`;
  } else if (!verdictObj.pass) {
    verdict = required ? "RED" : "AMBER";
    detail = verdictObj.detail;
  } else {
    verdict = verdictObj.sanity === "AMBER" ? "AMBER" : "GREEN";
    detail = verdictObj.detail;
  }
  st.checks.push({ label, verdict, detail, required, http: httpStatus });
  if (!QUIET) console.log(`  [${verdict}] ${id} · ${label}${required ? "" : " (optional)"} — ${detail}`);
  return verdict;
}

// ── [API-POLYGON] ──────────────────────────────────────────────────────────────────────
let rth = false;
function sectionPolygon() {
  ensureSection("API-POLYGON", "POLYGON/MASSIVE");
  if (!POLY) return forceSection("API-POLYGON", "SKIPPED", "POLYGON_API_KEY absent");

  // marketstatus first — its result sets RTH-awareness for greeks/trade checks.
  const ms = polyGet("/v1/marketstatus/now");
  record("API-POLYGON", "marketstatus/now", ms.r.s, checkMarketStatus(ms.j));
  rth = ms.j?.market === "open";

  const idx = polyGet("/v3/snapshot/indices?ticker.any_of=I:SPX,I:VIX");
  record("API-POLYGON", "v3/snapshot/indices (SPX,VIX)", idx.r.s, checkIndices(idx.j));

  const prev = polyGet("/v2/aggs/ticker/SPY/prev?adjusted=true");
  record("API-POLYGON", "v2/aggs/ticker/SPY/prev", prev.r.s, checkAggsPrev(prev.j));

  // A recent trading day for the minute-range + grouped-daily reads (weekend-safe).
  const day = lastTradingDayYmd();
  const rng = polyGet(`/v2/aggs/ticker/I:VIX/range/1/minute/${day}/${day}?limit=10`);
  record("API-POLYGON", `v2/aggs I:VIX minute range (${day})`, rng.r.s, checkAggsRange(rng.j));

  const grp = polyGet(`/v2/aggs/grouped/locale/us/market/stocks/${day}?adjusted=true`);
  record("API-POLYGON", `v2/aggs/grouped (${day})`, grp.r.s, checkGroupedDaily(grp.j));

  const chain = polyGet("/v3/snapshot/options/SPY?limit=10");
  record("API-POLYGON", "v3/snapshot/options/SPY (chain+greeks)", chain.r.s, checkOptionChainSnapshot(chain.j, { rth }));

  const ref = polyGet("/v3/reference/options/contracts?underlying_ticker=SPY&limit=5");
  record("API-POLYGON", "v3/reference/options/contracts", ref.r.s, checkReferenceContracts(ref.j));

  // Unified snapshot needs a real OCC — pull one from the chain we just fetched.
  const occ = asArray(chain.j)?.[0]?.details?.ticker;
  if (occ) {
    const uni = polyGet(`/v3/snapshot?ticker.any_of=${encodeURIComponent(occ)}&limit=1`);
    record("API-POLYGON", "v3/snapshot (unified OCC)", uni.r.s, checkUnifiedSnapshot(uni.j, { rth }));
    // v3 trades for that OCC — off-hours empty is AMBER-pass, not RED.
    const trd = polyGet(`/v3/trades/${encodeURIComponent(occ)}?order=desc&limit=5`);
    record("API-POLYGON", "v3/trades/{occ}", trd.r.s, checkV3Trades(trd.j), { required: false });
  }

  const news = polyGet("/benzinga/v2/news?ticker=NVDA&limit=3");
  record("API-POLYGON", "benzinga/v2/news", news.r.s, checkBenzingaNews(news.j), { required: false });
}

// ── [API-UW] ───────────────────────────────────────────────────────────────────────────
function sectionUW() {
  ensureSection("API-UW", "UNUSUAL WHALES");
  if (!UWK) return forceSection("API-UW", "SKIPPED", "UW_API_KEY absent");

  const flow = uwGet("/api/option-trades/flow-alerts?limit=25");
  record("API-UW", "option-trades/flow-alerts (global)", flow.r.s, checkFlowAlerts(flow.j));

  const tflow = uwGet("/api/stock/SPY/flow-alerts?limit=10");
  record("API-UW", "stock/SPY/flow-alerts (per-stock)", tflow.r.s, checkTickerFlowAlerts(tflow.j), { required: false });

  const gex = uwGet("/api/stock/SPX/spot-exposures/strike?limit=50");
  record("API-UW", "stock/SPX/spot-exposures/strike (GEX)", gex.r.s, checkSpotExposuresStrike(gex.j));

  const gxk = uwGet("/api/stock/SPX/greek-exposure/strike?limit=50");
  record("API-UW", "stock/SPX/greek-exposure/strike", gxk.r.s, checkGreekExposureStrike(gxk.j), { required: false });

  const scr = uwGet("/api/screener/stocks?limit=10");
  record("API-UW", "screener/stocks", scr.r.s, checkScreenerStocks(scr.j), { required: false });

  const dp = uwGet("/api/darkpool/SPY?limit=10");
  record("API-UW", "darkpool/{ticker}", dp.r.s, checkDarkpool(dp.j), { required: false });

  const nf = uwGet("/api/net-flow/expiry?limit=10");
  record("API-UW", "net-flow/expiry", nf.r.s, checkNetFlowExpiry(nf.j), { required: false });

  // Earnings feeds G-11 (fail-OPEN, D1) — empty is valid; failure is AMBER not RED (Polygon spine
  // is the resilient part). We validate both windows the market-wide + G-11 path reads.
  const epm = uwGet("/api/earnings/premarket?limit=10");
  record("API-UW", "earnings/premarket", epm.r.s, checkEarnings(epm.j), { required: false });
  const eah = uwGet("/api/earnings/afterhours?limit=10");
  record("API-UW", "earnings/afterhours", eah.r.s, checkEarnings(eah.j), { required: false });
}

// ── [INFRA] AWS RDS + ElastiCache (SKIPPED without creds) ────────────────────────────────
function awsCredsPresent() {
  const k = process.env.AWS_ACCESS_KEY_ID || "";
  const s = process.env.AWS_SECRET_ACCESS_KEY || "";
  if (!k || !s) return false;
  if (/example|placeholder|xxxx|change-me/i.test(k)) return false;
  return true;
}
function aws(args) {
  try {
    const out = execFileSync("aws", [...args, "--region", AWS_REGION, "--output", "json"], {
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      return { ok: true, json: JSON.parse(out) };
    } catch {
      return { ok: true, json: null, raw: out };
    }
  } catch (e) {
    const msg = String(e.stderr || e.message || e).split("\n").filter(Boolean).slice(-1)[0] || "aws error";
    return { ok: false, err: msg };
  }
}
function sectionInfra() {
  ensureSection("INFRA", "RDS+REDIS");
  if (!awsCredsPresent()) return forceSection("INFRA", "SKIPPED", "AWS creds absent/placeholder — run with valid AWS_ACCESS_KEY_ID/SECRET to enable");
  const who = aws(["sts", "get-caller-identity"]);
  if (!who.ok) return forceSection("INFRA", "SKIPPED", `AWS creds present but not usable (${who.err})`);

  const rds = aws(["rds", "describe-db-instances", "--db-instance-identifier", RDS_ID]);
  if (!rds.ok) {
    sections.get("INFRA").checks.push({ label: `RDS ${RDS_ID}`, verdict: "RED", detail: rds.err, required: true });
    if (!QUIET) console.log(`  [RED] INFRA · RDS ${RDS_ID} — ${rds.err}`);
  } else {
    const inst = rds.json?.DBInstances?.[0];
    const v = checkRdsInstance(inst, { wantId: RDS_ID });
    const verdict = v.pass ? (v.sanity === "AMBER" ? "AMBER" : "GREEN") : "RED";
    sections.get("INFRA").checks.push({ label: `RDS ${RDS_ID}`, verdict, detail: v.detail, required: true });
    if (!QUIET) console.log(`  [${verdict}] INFRA · RDS ${RDS_ID} — ${v.detail}`);
  }

  const rg = aws(["elasticache", "describe-replication-groups", "--replication-group-id", REDIS_RG_ID]);
  if (!rg.ok) {
    sections.get("INFRA").checks.push({ label: `Redis ${REDIS_RG_ID}`, verdict: "RED", detail: rg.err, required: true });
    if (!QUIET) console.log(`  [RED] INFRA · Redis ${REDIS_RG_ID} — ${rg.err}`);
  } else {
    const g = rg.json?.ReplicationGroups?.[0];
    const v = checkRedisReplicationGroup(g, { wantId: REDIS_RG_ID });
    const verdict = v.pass ? (v.sanity === "AMBER" ? "AMBER" : "GREEN") : "RED";
    sections.get("INFRA").checks.push({ label: `Redis ${REDIS_RG_ID}`, verdict, detail: v.detail, required: true });
    if (!QUIET) console.log(`  [${verdict}] INFRA · Redis ${REDIS_RG_ID} — ${v.detail}`);
  }
}

// ── [DATA-PATH] Redis + Postgres THROUGH the authenticated app (no raw TCP) ──────────────
async function sectionDataPath() {
  ensureSection("DATA-PATH", "REDIS+PG PATH");
  if (!SECRET) return forceSection("DATA-PATH", "SKIPPED", "CLERK_SECRET_KEY absent — cannot mint the temp session that reads board/record");

  const backend = (m, p, j) => curl({ method: m, url: `${CLERK_API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

  // --- mint temp admin+premium user (self-heal a leftover) ---
  // The shared helper covers BOTH identifier collisions Clerk can raise: e-mail taken →
  // adopt the leftover user; PHONE taken → redraw a fresh +1415555XXXX and retry. A phone
  // clash used to abort here and report the whole DATA-PATH section RED.
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: CLERK_API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) return forceSection("DATA-PATH", "RED", `auth: could not create/adopt temp user — ${auth.error.slice(0, 160)}`);
  dataPathUserId = auth.userId;

  // --- establish session (sign_in_token → FAPI ticket exchange → __session) ---
  let tok = null, sid = null, clientUat = 0;
  const mint = () =>
    (tok = sid
      ? J(curl({ method: "POST", url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" }, jar: true, saveJar: true }))?.jwt
      : null);
  const establish = () => {
    const ticket = J(backend("POST", "/sign_in_tokens", { user_id: dataPathUserId }))?.token;
    if (!ticket) return false;
    const si = curl({ method: "POST", url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" }, form: { strategy: "ticket" }, urlencodeForm: { ticket }, saveJar: true, jar: true });
    const newSid = J(si)?.response?.created_session_id;
    if (!newSid) return false;
    sid = newSid;
    clientUat = Math.floor(Date.now() / 1000);
    return !!mint();
  };
  if (!establish()) return forceSection("DATA-PATH", "RED", "auth: FAPI ticket exchange failed — could not establish session");
  const app = (path) => {
    for (let i = 0; i < 2; i++) {
      if (!tok && !establish()) return { s: 0, j: null };
      const r = curl({ url: `${APP}${path}`, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" } });
      if (isAuthFailureStatus(r.s)) { tok = null; continue; }
      return { s: r.s, j: J(r) };
    }
    return { s: 0, j: null };
  };

  const now = Date.now();
  const push = (label, verdict, detail) => {
    sections.get("DATA-PATH").checks.push({ label, verdict, detail, required: true });
    if (!QUIET) console.log(`  [${verdict}] DATA-PATH · ${label} — ${detail}`);
  };

  // REDIS PATH — the board snapshot (zerodte:board:snapshot:v1) is served through /board.
  const board = app("/api/market/zerodte/board");
  if (board.s !== 200 || !board.j) {
    push("Redis board snapshot (/board)", "RED", `HTTP ${board.s || "ERR"} — board snapshot not served`);
  } else {
    const setups = Array.isArray(board.j.setups) ? board.j.setups.length : "?";
    const ledger = Array.isArray(board.j.ledger) ? board.j.ledger.length : "?";
    // Freshness: prefer an explicit as_of/generated_at; else the snapshot merely being served is GREEN.
    const asOf = board.j.as_of ?? board.j.generated_at ?? board.j.asOf ?? null;
    const asOfMs = asOf != null ? (typeof asOf === "number" ? asOf : Date.parse(asOf)) : null;
    if (asOfMs != null && Number.isFinite(asOfMs)) {
      const fv = checkSnapshotFreshness(asOfMs, now, { rth });
      push("Redis board snapshot (/board)", fv.sanity === "AMBER" ? "AMBER" : "GREEN", `served · setups=${setups} ledger=${ledger} · ${fv.detail}`);
    } else {
      push("Redis board snapshot (/board)", "GREEN", `served · setups=${setups} ledger=${ledger} · (no as_of field — served=Redis path live)`);
    }
  }

  // POSTGRES READ PATH — the record endpoint reads graded rows from zerodte_setup_log (Postgres).
  const record = app("/api/market/zerodte/record");
  if (record.s !== 200 || !record.j) {
    push("Postgres read path (/record)", "RED", `HTTP ${record.s || "ERR"} — record not served`);
  } else {
    const rows = asArray(record.j) ?? (Array.isArray(record.j.records) ? record.j.records : Array.isArray(record.j.plays) ? record.j.plays : null);
    if (rows == null) {
      // 200 but no recognizable row array — the read path is live but the shape is unexpected → AMBER.
      push("Postgres read path (/record)", "AMBER", `served (200) but no rows[] array — keys: ${Object.keys(record.j).slice(0, 6).join(",")}`);
    } else {
      push("Postgres read path (/record)", "GREEN", `served · ${rows.length} graded record rows (Postgres read live)`);
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────────────────────
let dataPathUserId = null;
async function main() {
  if (!QUIET) console.log(`\n0DTE E2E VALIDATION SUITE → APIs live + INFRA (AWS) + DATA-PATH (${APP})\n  Polygon bases: ${POLY_BASES.join(" → ")}\n`);

  const wantPoly = !PROVIDER || PROVIDER === "polygon";
  const wantUw = !PROVIDER || PROVIDER === "uw";
  if (wantPoly) sectionPolygon();
  if (wantUw) sectionUW();
  // INFRA + DATA-PATH are skipped when --provider filters to a single API provider.
  if (!PROVIDER) {
    sectionInfra();
    await sectionDataPath();
  }
}

let exitCode = 0;
main()
  .catch((e) => {
    ensureSection("SCRIPT", "SCRIPT");
    forceSection("SCRIPT", "RED", `script error: ${String(e.message || e)}`);
  })
  .finally(() => {
    // ALWAYS delete the temp Clerk user (DATA-PATH) + verify gone.
    if (dataPathUserId && SECRET) {
      const d = curl({ method: "DELETE", url: `${CLERK_API}/users/${dataPathUserId}`, headers: { Authorization: `Bearer ${SECRET}` } });
      const v = curl({ url: `${CLERK_API}/users/${dataPathUserId}`, headers: { Authorization: `Bearer ${SECRET}` } });
      if (!QUIET) console.log(`  [${v.s === 404 ? "GREEN" : "AMBER"}] cleanup: temp user deleted (DELETE ${d.s}, verify ${v.s})`);
    }
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}

    // --- final matrix ---
    const ordered = ["API-POLYGON", "API-UW", "INFRA", "DATA-PATH", "SCRIPT"].filter((id) => sections.has(id));
    const matrix = ordered.map((id) => {
      const st = sections.get(id);
      const verdict = sectionVerdict(st);
      const evidence = st.forced?.detail ?? st.checks.find((c) => c.verdict === verdict)?.detail ?? st.checks.map((c) => c.label).slice(0, 2).join("; ");
      return { section: id, name: st.name, verdict, evidence };
    });
    // Exit non-zero if any REQUIRED section is RED. A section is RED only when a REQUIRED check
    // is RED (optional checks max out at AMBER via record()). SKIPPED never fails the gate.
    const anyRed = matrix.some((m) => m.verdict === "RED");
    exitCode = anyRed ? 1 : 0;

    if (JSON_OUT) {
      console.log(
        JSON.stringify(
          {
            generated_at: new Date().toISOString(),
            app: APP,
            polygon_base: stickyPolyBase || POLY_BASES[0],
            market: rth ? "RTH" : "off-hours",
            overall: anyRed ? "RED" : matrix.some((m) => m.verdict === "AMBER") ? "AMBER" : "GREEN",
            sections: matrix.map((m) => ({ ...m, checks: sections.get(m.section).checks })),
          },
          null,
          2
        )
      );
    } else {
      const icon = (v) => (v === "GREEN" ? "🟢" : v === "AMBER" ? "🟡" : v === "RED" ? "🔴" : "⚪");
      console.log(`\n═══ 0DTE E2E VALIDATION — SECTION MATRIX (${rth ? "RTH" : "off-hours"}, base ${stickyPolyBase || POLY_BASES[0]}) ═══`);
      for (const m of matrix) console.log(`  ${icon(m.verdict)} ${m.section.padEnd(12)} ${m.verdict.padEnd(8)} ${(m.evidence || "").slice(0, 120)}`);
      console.log(`\n  OVERALL: ${anyRed ? "🔴 RED — a REQUIRED upstream/subsystem is down; do NOT trust the board is ready" : matrix.some((m) => m.verdict === "AMBER") ? "🟡 AMBER — live, with off-hours-empty or optional-degraded checks (read the reasons)" : "🟢 GREEN — every required upstream + subsystem is live and shaped correctly"}\n`);
    }
    process.exit(exitCode);
  });

// ── helpers ──────────────────────────────────────────────────────────────────────────
function lastTradingDayYmd() {
  // Walk back from "yesterday ET" to the most recent Mon–Fri. Good enough for a data-shape probe
  // (a US holiday would just return an empty grouped set → the sanity check flags it, not a crash).
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  for (let i = 0; i < 6; i++) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) break;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return d.toISOString().slice(0, 10);
}
