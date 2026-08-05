#!/usr/bin/env node
/*
 * gex-wall-snapshot-poll.mjs — LIVE intraday GEX-wall snapshot capture for
 * scripts/audit/wall-temporal-stability.mjs (INTENTIONAL-DESIGN.md item #3, "single-snapshot
 * PIN wall test").
 *
 * WHAT / WHY
 *   `wall-temporal-stability.mjs` needs a --snapshots=<path.json> export — an array of
 *   { session_date, snapshot_at, ticker, spot, callWall, putWall, callWallPct, putWallPct,
 *   gammaPosture } rows, MULTIPLE per ticker across a real session — to test whether PINs whose
 *   defended bracket persists across snapshots grade better than one-snapshot transients. That
 *   export has never existed: intraday GEX-wall history is a server-side UW/Polygon product with
 *   no offline replay, so it can only be gathered by POLLING the live app on an interval during
 *   real RTH.
 *
 *   This script IS that poller. It authenticates as ONE temp admin+premium Clerk user (same
 *   mint-sign_in_token -> FAPI ticket-exchange -> session-cookie pattern as data-validator.mjs,
 *   reusable across the whole polling window via mint()/re-establish, since a single Clerk
 *   session does not reliably survive 60-90+ minutes unattended), then repeatedly fetches
 *   `GET /api/market/gex-heatmap?ticker=<T>` for each configured ticker at a fixed interval and
 *   appends one row per (ticker, poll) to --out as soon as it's captured (crash-safe: a kill
 *   partway through still leaves every row captured so far).
 *
 * WHY THE APP ROUTE, NOT RAW POLYGON/UW: `/api/market/gex-heatmap` is the SAME server-cached
 * matrix production's own PIN discovery orchestration (pin-discovery.ts) and Thermal/Vector read
 * — its `gex.call_wall`/`gex.put_wall`/`gex.flip`/`gex.strike_totals` are already scoped to the
 * near-term expiries the live PIN source uses (route.ts's nearTermExpiries resolution), so this
 * poller captures literally the same wall computation the shipped PIN regime test would see,
 * just sampled repeatedly instead of once. wallPct() below reproduces computeGexWalls' own
 * dominance formula (gex-wall-levels.ts) over the returned strike_totals so callWallPct/putWallPct
 * match production's wall-dominance math exactly, not an approximation.
 *
 * Run (foreground; use nohup/&/run_in_background for a real multi-tens-of-minutes capture):
 *   node scripts/audit/gex-wall-snapshot-poll.mjs \
 *     --tickers=SPY,QQQ,SPX,IWM,NVDA --minutes=90 --every=5 \
 *     --out=/path/to/gex-wall-snapshots.json
 *
 * SECRETS from env only (never hardcoded): CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 * Deletes its temp Clerk user in a finally block, same as every other audit harness.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { isAuthFailureStatus } from "./lib/auth-status.mjs";
import { todayEtYmd } from "../gha-et-window.mjs";

function req(name) {
  const v = process.env[name];
  if (!v || v.includes("${{")) {
    console.error(`FATAL: env ${name} is missing or an unresolved \${{...}} placeholder.`);
    process.exit(3);
  }
  return v;
}
const SECRET = req("CLERK_SECRET_KEY");
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const EMAIL = process.env.AUDIT_EMAIL || "claude-audit-gexwall-temp@blackouttrades.com";
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const TICKERS = String(argv.tickers ?? "SPY,QQQ,SPX,IWM").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const TOTAL_MINUTES = Math.max(1, Number(argv.minutes ?? 60));
const EVERY_MINUTES = Math.max(1, Number(argv.every ?? 5));
const OUT = argv.out ? String(argv.out) : join(process.cwd(), "audit-output", "gex-wall-snapshots.json");
mkdirSync(dirname(OUT), { recursive: true });

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

const TMP = join(tmpdir(), `bo-gexwall-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;
function curl({ method = "GET", url, headers = {}, form, urlencodeForm, json, jar = false, saveJar = false }) {
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
    const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }).trim());
    return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" };
  } catch (e) {
    return { s: 0, b: "", err: String(e?.message || e).split("\n")[0] };
  }
}
const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

/** computeGexWalls' own dominance formula (gex-wall-levels.ts), applied to ONE named wall strike
 *  over the returned strike_totals — so callWallPct/putWallPct match production math exactly
 *  rather than approximating it. Returns null when the wall or ladder is missing/degenerate. */
function wallPct(strikeTotals, wallStrike) {
  if (wallStrike == null || !Number.isFinite(wallStrike) || !strikeTotals) return null;
  let totalAbs = 0;
  let wallAbs = null;
  for (const [k, v] of Object.entries(strikeTotals)) {
    const s = Number(k);
    const g = Number(v);
    if (!Number.isFinite(s) || !Number.isFinite(g)) continue;
    totalAbs += Math.abs(g);
    if (Math.abs(s - wallStrike) < 1e-6) wallAbs = Math.abs(g);
  }
  if (!(totalAbs > 0) || wallAbs == null) return null;
  return (wallAbs / totalAbs) * 100;
}

function loadExisting() {
  if (!existsSync(OUT)) return [];
  try {
    const parsed = JSON.parse(readFileSync(OUT, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function appendRow(row) {
  const rows = loadExisting();
  rows.push(row);
  writeFileSync(OUT, JSON.stringify(rows, null, 2));
  return rows.length;
}

let userId = null;
let tok = null;
let sid = null;
let clientUat = 0;
let authDead = false;

const mint = () => {
  tok = sid
    ? J(
        curl({
          method: "POST",
          url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`,
          headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
          jar: true,
          saveJar: true,
        })
      )?.jwt
    : null;
  return tok;
};
const establishSession = () => {
  const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
  if (!ticket) return false;
  const si = curl({
    method: "POST",
    url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`,
    headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" },
    form: { strategy: "ticket" },
    urlencodeForm: { ticket },
    saveJar: true,
    jar: true,
  });
  const newSid = J(si)?.response?.created_session_id;
  if (!newSid) return false;
  sid = newSid;
  clientUat = Math.floor(Date.now() / 1000);
  return !!mint();
};
const ensureAuth = () => {
  if (tok) return true;
  if (authDead) return false;
  if (mint()) return true;
  if (establishSession()) return true;
  authDead = true;
  return false;
};
function app(path) {
  for (let i = 0; i < 2; i++) {
    if (!ensureAuth()) return null;
    const r = curl({ url: `${APP}${path}`, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" } });
    if (isAuthFailureStatus(r.s)) {
      tok = null;
      if (i === 0 && !authDead) establishSession();
      continue;
    }
    const j = J(r);
    if (j) return j;
    tok = null;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOnce(sessionDate) {
  const at = new Date().toISOString();
  let captured = 0;
  for (const ticker of TICKERS) {
    const heatmap = app(`/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`);
    if (!heatmap || heatmap.available === false || !heatmap.gex) {
      console.log(`  [${ticker}] no usable heatmap this poll (available=${heatmap?.available})`);
      continue;
    }
    const spot = Number(heatmap.spot);
    const callWall = heatmap.gex.call_wall == null ? null : Number(heatmap.gex.call_wall);
    const putWall = heatmap.gex.put_wall == null ? null : Number(heatmap.gex.put_wall);
    const flip = heatmap.gex.flip == null ? null : Number(heatmap.gex.flip);
    const strikeTotals = heatmap.gex.strike_totals;
    const callWallPct = wallPct(strikeTotals, callWall);
    const putWallPct = wallPct(strikeTotals, putWall);
    const gammaPosture = flip != null && Number.isFinite(flip) && spot > 0 ? (spot >= flip ? "long" : "short") : null;
    const row = {
      session_date: sessionDate,
      snapshot_at: at,
      ticker,
      spot,
      callWall,
      putWall,
      callWallPct,
      putWallPct,
      gammaPosture,
    };
    const n = appendRow(row);
    captured++;
    console.log(
      `  [${ticker}] spot=${spot} callWall=${callWall}(${callWallPct?.toFixed(1)}%) putWall=${putWall}(${putWallPct?.toFixed(1)}%) posture=${gammaPosture} -> row ${n} in ${OUT}`
    );
  }
  return captured;
}

async function main() {
  const create = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  const cj = J(create);
  if (cj?.id) userId = cj.id;
  else if (/form_identifier_exists/.test(JSON.stringify(cj?.errors || ""))) {
    const u = (J(curl({ url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`, headers: { Authorization: `Bearer ${SECRET}` } })) || [])[0];
    if (u?.id) {
      userId = u.id;
      backend("PATCH", `/users/${userId}`, { public_metadata: { role: "admin", tier: "premium" } });
    }
  }
  if (!userId) {
    console.error(`FATAL: could not create/adopt temp user: ${create.b.slice(0, 200)}`);
    process.exit(2);
  }
  if (!establishSession()) {
    console.error("FATAL: FAPI ticket exchange failed — could not establish session");
    await cleanup();
    process.exit(2);
  }

  const sessionDate = todayEtYmd();
  const passes = Math.max(1, Math.floor(TOTAL_MINUTES / EVERY_MINUTES) + 1);
  console.log(
    `\n=== gex-wall-snapshot-poll: ${TICKERS.join(",")} — ${passes} passes over ~${TOTAL_MINUTES}min, every ${EVERY_MINUTES}min -> ${OUT} ===\n`
  );
  let totalCaptured = 0;
  const startedAt = Date.now();
  for (let i = 0; i < passes; i++) {
    const elapsedMin = (Date.now() - startedAt) / 60000;
    console.log(`-- pass ${i + 1}/${passes} (t+${elapsedMin.toFixed(1)}min) --`);
    totalCaptured += await pollOnce(sessionDate);
    if (i < passes - 1) await sleep(EVERY_MINUTES * 60 * 1000);
  }
  console.log(`\nDone. ${totalCaptured} row(s) captured across ${passes} passes -> ${OUT}`);
  await cleanup();
}

async function cleanup() {
  if (userId) {
    try {
      backend("DELETE", `/users/${userId}`);
      console.log(`(cleanup) deleted temp user ${userId}`);
    } catch {
      /* best-effort */
    }
  }
}

main().catch(async (e) => {
  console.error("FATAL:", e?.stack || e);
  await cleanup();
  process.exit(1);
});
