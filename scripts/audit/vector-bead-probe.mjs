#!/usr/bin/env node
/**
 * Vector bead rail probe — compares wall-history density for SPX vs SPY/QQQ/NVDA.
 * Mints temp admin Clerk user (deleted in finally).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";

const SECRET = process.env.CLERK_SECRET_KEY?.trim();
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || "";
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const EMAIL = process.env.AUDIT_EMAIL || `vector-bead-probe+${Date.now()}@example.com`;
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const TICKERS = (process.env.VECTOR_PROBE_TICKERS || "SPX,SPY,QQQ,NVDA").split(",").map((t) => t.trim());

if (!SECRET) {
  console.error("CLERK_SECRET_KEY required");
  process.exit(3);
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

const TMP = join(tmpdir(), `vector-probe-${process.pid}`);
mkdirSync(TMP, { recursive: true });
const JAR = join(TMP, "cookies.txt");
let seq = 0;

function curl(opts) {
  const bf = join(TMP, `b${++seq}`);
  const args = ["-sS", "--max-time", "60", "-o", bf, "-w", "%{http_code}", "-A", UA];
  if (opts.method && opts.method !== "GET") args.push("-X", opts.method);
  for (const [k, v] of Object.entries(opts.headers || {})) args.push("-H", `${k}: ${v}`);
  if (opts.json) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(opts.json));
  if (opts.form) for (const [k, v] of Object.entries(opts.form)) args.push("--data", `${k}=${v}`);
  if (opts.urlencodeForm)
    for (const [k, v] of Object.entries(opts.urlencodeForm)) args.push("--data-urlencode", `${k}=${v}`);
  if (opts.jar) args.push("-b", JAR);
  if (opts.saveJar) args.push("-c", JAR);
  args.push(opts.url);
  const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }).trim());
  return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" };
}
const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};
const backend = (m, p, j) =>
  curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

function beadStats(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return { samples: 0, gaps: [], medianGapSec: null, callBeadsLast: 0, putBeadsLast: 0 };
  }
  const times = history.map((h) => h.time).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  gaps.sort((a, b) => a - b);
  const last = history[history.length - 1];
  return {
    samples: history.length,
    firstTime: times[0],
    lastTime: times[times.length - 1],
    gaps: gaps.slice(0, 5),
    medianGapSec: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    maxGapSec: gaps.length ? gaps[gaps.length - 1] : null,
    callBeadsLast: last?.walls?.callWalls?.length ?? 0,
    putBeadsLast: last?.walls?.putWalls?.length ?? 0,
  };
}

let userId = null;
let tok = null;
let sid = null;
let clientUat = 0;

function mint() {
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
}

function establishSession() {
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
  sid = J(si)?.response?.created_session_id;
  if (!sid) return false;
  clientUat = Math.floor(Date.now() / 1000);
  return !!mint();
}

function appGet(path) {
  if (!tok && !mint()) return null;
  const r = curl({
    url: `${APP}${path}`,
    headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" },
  });
  if (r.s === 401) {
    establishSession();
    const r2 = curl({
      url: `${APP}${path}`,
      headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" },
    });
    return { status: r2.s, body: J(r2) };
  }
  return { status: r.s, body: J(r) };
}

async function probeStreamGrowth(ticker, seconds = 12) {
  // Hit stream endpoint briefly to spin up hub poller, sample wallHistory tail growth
  const samples = [];
  for (let i = 0; i < seconds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = appGet(`/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&dte=0dte`);
    const hist = r?.body?.history ?? r?.body?.wallHistory ?? [];
    const len = Array.isArray(hist) ? hist.length : 0;
    const lastT = len ? hist[len - 1]?.time : null;
    samples.push({ sec: i + 1, len, lastT });
  }
  return samples;
}

async function main() {
  const create = backend("POST", "/users", {
    email_address: [EMAIL],
    phone_number: [PHONE],
    public_metadata: { role: "admin", tier: "premium" },
    skip_password_requirement: true,
    skip_legal_checks: true,
  });
  userId = J(create)?.id;
  if (!userId) {
    console.error("Failed to create user", create.b.slice(0, 200));
    process.exit(1);
  }
  if (!establishSession()) {
    console.error("Auth failed");
    process.exit(1);
  }
  console.log("auth ok — probing", TICKERS.join(", "));

  const session = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const report = { session, tickers: {}, admin: null, streamProbe: {} };

  const health = appGet("/api/admin/health");
  report.admin = {
    status: health?.status,
    gex_strike_expiry: health?.body?.uw?.gex_strike_expiry_active_tickers ?? health?.body?.sockets?.gex_strike_expiry_active_tickers,
    process_role: health?.body?.process?.role ?? health?.body?.process_role,
  };

  for (const ticker of TICKERS) {
    const wh = appGet(`/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&dte=0dte&session=${session}`);
    const walls = appGet(`/api/market/vector/walls?ticker=${encodeURIComponent(ticker)}&dte=0dte`);
    const hist = wh?.body?.history ?? wh?.body?.wallHistory ?? [];
    report.tickers[ticker] = {
      wallHistoryStatus: wh?.status,
      wallsStatus: walls?.status,
      stats: beadStats(hist),
      gexAsOf: walls?.body?.gexAsOf ?? walls?.body?.asOf ?? null,
      callWalls: walls?.body?.walls?.callWalls?.length ?? walls?.body?.callWalls?.length,
      putWalls: walls?.body?.walls?.putWalls?.length ?? walls?.body?.putWalls?.length,
      source: walls?.body?.source,
    };
  }

  // Kick stream hub briefly (best-effort) then poll wall-history growth
  for (const t of ["SPY", "NVDA"]) {
    try {
      execFileSync(
        "curl",
        [
          "-sS",
          "--max-time",
          "3",
          "-o",
          "/dev/null",
          `${APP}/api/market/vector/stream?ticker=${encodeURIComponent(t)}`,
          "-H",
          `Cookie: __session=${tok}; __client_uat=${clientUat}`,
          "-H",
          "Accept: text/event-stream",
        ],
        { stdio: "ignore" }
      );
    } catch {
      /* stream attach is best-effort — hub may still spin up briefly */
    }
    report.streamProbe[t] = await probeStreamGrowth(t, 10);
  }

  const out = join("/opt/cursor/artifacts", "vector-bead-probe.json");
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  try {
    backend("DELETE", `/users/${userId}`);
  } catch {
    /* best effort */
  }
  rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
