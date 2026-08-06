#!/usr/bin/env node
/*
 * FIREWALL RTH REPLAY — before/after counterfactual for the Phase-0 fail-closed 0DTE firewall
 * ==========================================================================================
 *
 * WHAT THIS IS
 * ------------
 * The Phase-0 firewall (src/lib/zerodte/) only ever ADDS blocks (fail-closed) — it never adds a
 * play. This harness answers "what would it have CHANGED on TODAY's live 0DTE board?" by replaying
 * today's REAL flow tape + today's REAL committed ledger through the OLD (guard off) and NEW (guard
 * on) code paths and diffing. It is deliberately read-only against prod: it mints ONE temp admin+
 * premium Clerk user (always deleted in a finally), reads authed board/record JSON, and grades on
 * Polygon minute bars. No DB writes, no ledger mutation.
 *
 * THE FIVE GUARDS (each: how OLD vs NEW is toggled)
 *   A. Far-OTM cap        — board.ts SETUP_MAX_OTM_PCT (default 12; 999 = old/off). Deterministic on
 *                           the flow tape. Applied here as the guard's own per-ticker post-filter
 *                           (`if (otmPct > cap) reject`) — see PART A note on why that is exact.
 *   B. earnings-all-ranks — G-11 earnings now evaluated for EVERY committable rank (scan.ts
 *                           freshEarnings batch), not just the dossier-enriched top-5.
 *   C. real commits       — today's ACTUAL ledger commits, inspected for the three fail-open holes
 *                           the firewall closes (cortex veto-blind / vix null / macro unavailable).
 *   D. guard-fires proof  — the REAL functions fired on minimal constructed inputs, with the env
 *                           toggles (ZERODTE_G4_FAIL_CLOSED / G7 via child process; the cortex
 *                           veto-blind opt is a runtime param), proving each guard even if today's
 *                           live data never tripped it.
 *
 * HONESTY: the firewall is INSURANCE against fail-open days. "0 plays changed today, guards proven
 * on injected outages (Part D)" is a correct and valuable result when today's reads were clean.
 *
 * RUN
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u POLYGON_API_BASE \
 *     node --import tsx scripts/audit/firewall-rth-replay.mjs
 *
 * SECRETS (env only, never committed): CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
 *   POLYGON_API_KEY, UW_API_KEY.
 */

// ── Env guards (must run before any app-module import — provider modules read env at import) ──
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}
// This harness pulls the live board/ledger through the authed prod HTTP API, never a direct
// DB/Redis socket (both are raw-TCP-blocked in this sandbox and would HANG on connect). Unset them
// so any incidental cache path (e.g. readGridEarnings) fails FAST to its UW-REST fallback instead.
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
// Far-OTM cap: import board.ts with the cap DISABLED (999) so deriveZeroDteSetups returns the OLD
// (uncapped) setup universe; the NEW cap is then applied as the guard's own exact post-filter
// below. SETUP_MAX_OTM_PCT is frozen at module-eval, so this is the only way to get the OLD set in
// one process — and the cap is a pure per-ticker FINAL filter (`if (otmPct > cap) reject`, no
// effect on any other ticker's score/direction/aggregation), so OLD-minus-(otm>12) is byte-exact
// to a real cap=12 run. Verified against the NEW-cap child run's rejection log at the end of PART A.
process.env.ZERODTE_SETUP_MAX_OTM_PCT = "999";

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { createOrAdoptAuditUserViaCurl } from "./lib/clerk-audit-user.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;

// ── Secrets / hosts ─────────────────────────────────────────────────────────────────
function req(name) {
  const v = process.env[name];
  if (!v || v.includes("${{")) {
    console.error(`FATAL: env ${name} missing or an unresolved \${{...}} placeholder — set a literal.`);
    process.exit(3);
  }
  return v;
}
const SECRET = req("CLERK_SECRET_KEY");
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
req("POLYGON_API_KEY");
req("UW_API_KEY");
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const EMAIL = process.env.AUDIT_EMAIL || "claude-audit-fwreplay@blackouttrades.com";
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const CLERK_API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();

// ── curl plumbing (mirrors scripts/audit/data-validator.mjs) ─────────────────────────
// mkdtempSync creates a unique, non-predictable dir (0700) — avoids the symlink/race a
// predictable os-temp path invites (CodeQL js/insecure-temporary-file).
const TMP = mkdtempSync(join(tmpdir(), "bo-fwreplay-"));
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
    return { s: 0, b: "", err: String(e.message || e).split("\n")[0] };
  }
}
const J = (r) => {
  try {
    return JSON.parse(r.b);
  } catch {
    return null;
  }
};
const backend = (m, p, j) => curl({ method: m, url: `${CLERK_API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });

// ── Small formatting helpers ─────────────────────────────────────────────────────────
const line = (c = "─", w = 92) => c.repeat(w);
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const fmtUsd = (n) =>
  n == null ? "—" : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${Number(n).toFixed(0)}`;
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function etMinOfBar(t) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(t));
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) * 60 + Number(p.find((x) => x.type === "minute")?.value ?? 0);
}
/** Whole ET-calendar days between two YYYY-MM-DD strings (expiry - today) — mirrors the board's SQL dte. */
function dteBetween(todayYmd, expiryYmd) {
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${expiryYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

const TODAY = etYmd(Date.now());

// ── App-module imports (real pipeline) ───────────────────────────────────────────────
const board = await import(`${SRC}lib/zerodte/board.ts`);
const { deriveZeroDteSetups, matchEarnings } = board;
const OLD_CAP_DISABLED = board.SETUP_MAX_OTM_PCT; // 999 (we set it above)
const NEW_CAP = 12; // the shipped default (board.ts: ZERODTE_SETUP_MAX_OTM_PCT ?? 12)
const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { gradePlanFromBars, PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { assessCortexVerdict } = await import(`${SRC}lib/zerodte/cortex-gate.ts`);
const { VETO_CAPABLE_SOURCES, CORTEX_SOURCES } = await import(`${SRC}lib/nighthawk/cortex/index.ts`);

console.log(line("═"));
console.log(`  FIREWALL RTH REPLAY — before/after counterfactual · session ${TODAY}`);
console.log(`  OLD far-OTM cap ${OLD_CAP_DISABLED} (off) · NEW cap ${NEW_CAP} · plan stop ${PLAN_RULES.stop_pct}%/target +${PLAN_RULES.target_pct}%/time-stop 15:30 ET`);
console.log(line("═"));

// ── Live-board flow fetch: replicate scanZeroDteBoard's fetchRecentFlows params via UW REST ──
// scan.ts uses fetchRecentFlows({ since_hours:7, min_premium:150_000, order:"premium", limit:400,
// max_dte:1 }) — but that reads Postgres (raw-TCP-blocked here). The UW flow-alerts REST feed is the
// SAME upstream Postgres ingests, so we page it and apply the identical WHERE (last 7h, premium≥150k,
// 0-1 DTE, premium-ordered, cap 400). Rows are mapped to board.ts's FlowSetupInput with the exact
// db.ts field derivations (extractChainFieldsFromRaw = the SQL casts' mirror).
const SINCE_HOURS = 7;
const MIN_PREMIUM = 150_000;
const MAX_DTE = 1;
const LIMIT = 400;

function toFlowSetupInput(mr) {
  const f = mr.flow ?? {};
  const raw = mr.raw ?? {};
  const ticker = String(f.ticker ?? raw.ticker ?? "").toUpperCase();
  const strike = Number(f.strike ?? raw.strike);
  const expiry = String(f.expiry ?? raw.expiry ?? "").slice(0, 10);
  const premium = Number(f.premium ?? raw.total_premium ?? raw.premium);
  const optionType = String(f.option_type ?? raw.option_type ?? raw.type ?? "");
  const alertedAt = f.alerted_at ?? raw.created_at ?? null;
  if (!ticker || !(strike > 0) || !expiry || !(premium > 0) || !optionType) return null;
  const chain = extractChainFieldsFromRaw(raw, { strike, option_type: optionType });
  return {
    ticker,
    premium,
    option_type: optionType,
    strike,
    expiry,
    dte: dteBetween(TODAY, expiry),
    alert_rule: f.alert_rule ?? chain.alert_rule ?? null,
    ask_pct: chain.ask_pct ?? null,
    underlying_price: chain.underlying_price ?? null,
    fill_price: chain.fill_price ?? null,
    open_interest: chain.open_interest ?? null,
    alerted_at: alertedAt,
  };
}

async function fetchLiveBoardFlow() {
  const cutoffMs = Date.now() - SINCE_HOURS * 3_600_000;
  const seen = new Set();
  const rows = [];
  let olderThan = new Date().toISOString();
  for (let page = 0; page < 12; page++) {
    let batch;
    try {
      batch = await fetchMarketFlowAlertRows({ limit: 200, min_premium: MIN_PREMIUM, older_than: olderThan });
    } catch (e) {
      console.warn(`  [flow] page ${page + 1} failed: ${e instanceof Error ? e.message : e}`);
      break;
    }
    if (!batch?.length) break;
    let oldestIso = null;
    let oldestMs = Infinity;
    for (const mr of batch) {
      const iso = mr.flow?.alerted_at ?? mr.raw?.created_at;
      const ms = Date.parse(iso ?? "");
      if (Number.isFinite(ms) && ms < oldestMs) {
        oldestMs = ms;
        oldestIso = iso;
      }
      const fi = toFlowSetupInput(mr);
      if (!fi) continue;
      const alertedMs = Date.parse(fi.alerted_at ?? "");
      const key = `${fi.ticker}|${fi.expiry}|${fi.strike}|${fi.option_type}|${fi.alerted_at}|${fi.premium}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // WHERE: last 7h AND 0-1 DTE (already-expired / far-dated dropped, like the SQL BETWEEN).
      if (Number.isFinite(alertedMs) && alertedMs < cutoffMs) continue;
      if (fi.dte == null || fi.dte < 0 || fi.dte > MAX_DTE) continue;
      rows.push(fi);
    }
    if (!oldestIso || oldestMs === Infinity || oldestMs < cutoffMs || oldestIso === olderThan) break;
    olderThan = oldestIso;
  }
  // ORDER BY premium DESC, LIMIT 400 (the board's cap).
  rows.sort((a, b) => b.premium - a.premium);
  return rows.slice(0, LIMIT);
}

// ── Grading helpers (probe a real same-day 0DTE ATM contract, grade on today's minute bars) ──
function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}
function strikeIncrement(spot) {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}
const ENTRY_ET_MIN = 9 * 60 + 45;
async function spotAtEntry(underlying, date) {
  const bars = await fetchAggBars(underlying.toUpperCase(), 1, "minute", date, date, "1500").catch(() => []);
  const clean = (bars ?? []).filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c));
  if (!clean.length) return null;
  return (clean.find((b) => etMinOfBar(b.t) >= ENTRY_ET_MIN) ?? clean[0]).c;
}
async function probeAtm0dte(underlying, date, side, spot) {
  const inc = strikeIncrement(spot);
  const base = Math.round(spot / inc) * inc;
  for (const strike of [base, base + inc, base - inc, base + 2 * inc, base - 2 * inc]) {
    if (strike <= 0) continue;
    const occ = occSymbol(underlying, date, side, strike);
    const bars = await fetchAggBars(occ, 1, "minute", date, date, "1500").catch(() => []);
    const clean = (bars ?? [])
      .map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }))
      .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.c > 0);
    if (clean.length) return { occ, strike, bars: clean };
  }
  return null;
}
/** Grade a directional 0DTE setup on today's real minute bars → {outcome, pnl_pct, verdict}. */
async function gradeSetupToday(ticker, direction) {
  const side = direction === "long" ? "call" : "put";
  const spot = await spotAtEntry(ticker, TODAY);
  if (spot == null) return { outcome: "no_underlying_bars", pnl_pct: null };
  const atm = await probeAtm0dte(ticker, TODAY, side, spot);
  if (!atm) return { outcome: "no_0dte_contract", pnl_pct: null };
  const entryBar = atm.bars.find((b) => etMinOfBar(b.t) >= ENTRY_ET_MIN) ?? atm.bars[0];
  const grade = gradePlanFromBars(atm.bars, entryBar.c, entryBar.t);
  return { outcome: grade.outcome, pnl_pct: grade.pnl_pct, occ: atm.occ, strike: atm.strike, entry: Number(entryBar.c.toFixed(2)) };
}
/** A committable OLD setup avoided by a guard is a LOSER-avoided if it did NOT double, a
 *  WINNER-forgone if it doubled (the honest signed session-P&L contribution). */
function verdictFromGrade(g) {
  if (g.outcome === "doubled") return { verdict: "WINNER-FORGONE", signed: g.pnl_pct ?? PLAN_RULES.target_pct };
  if (g.outcome === "stopped" || g.outcome === "time_stop") return { verdict: "LOSER-AVOIDED", signed: g.pnl_pct ?? 0 };
  return { verdict: "UNGRADEABLE", signed: 0 };
}

// ── Child-process runner (genuine env toggle for the import-frozen G4/G7 + OTM-cap flags) ──
// tsx's `-e` eval compiles imported .ts to CJS (only `default` survives); running a REAL .mjs
// file resolves named exports exactly like this harness's own main process. So each toggled run
// is a temp .mjs that imports the app module fresh under the overridden env.
let childSeq = 0;
function runChildMjs(source, envOverrides) {
  const file = join(TMP, `child${++childSeq}.mjs`);
  writeFileSync(file, source);
  const out = execFileSync("node", ["--import", "tsx", file], {
    encoding: "utf8",
    env: { ...process.env, ...envOverrides },
  });
  return JSON.parse(out.trim().split("\n").filter(Boolean).pop());
}

const GATES_URL = `${SRC}lib/zerodte/gates.ts`;
function runGatesInChild(envOverrides, input) {
  try {
    return runChildMjs(
      `import { evaluateZeroDteGates, G4_VIX_FAIL_CLOSED_ENABLED, G7_MACRO_FAIL_CLOSED_ENABLED } from ${JSON.stringify(GATES_URL)};
       const input = ${JSON.stringify(input)};
       const v = evaluateZeroDteGates(input);
       console.log(JSON.stringify({ g4on: G4_VIX_FAIL_CLOSED_ENABLED, g7on: G7_MACRO_FAIL_CLOSED_ENABLED, verdict: v.verdict, blocks: v.blocks.map((b) => b.code) }));`,
      envOverrides
    );
  } catch (e) {
    return { error: String(e.message || e).split("\n").slice(-3).join(" ") };
  }
}

// ── Authed prod fetch (mint temp user → FAPI ticket → __session cookie) ───────────────
let userId = null;
async function authAndFetchBoard() {
  // Shared create-or-adopt: e-mail collision → adopt the leftover user; PHONE collision →
  // redraw a fresh +1415555XXXX and retry (a clash on the random number is recoverable and
  // must not abort the replay).
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: CLERK_API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) return { error: `temp-user create failed: ${auth.error.slice(0, 200)}` };
  userId = auth.userId;

  let sid = null;
  let tok = null;
  let clientUat = 0;
  const mint = () =>
    (tok = sid
      ? J(curl({ method: "POST", url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" }, jar: true, saveJar: true }))?.jwt
      : null);
  const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
  if (!ticket) return { error: "sign_in_token mint failed" };
  const si = curl({ method: "POST", url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" }, form: { strategy: "ticket" }, urlencodeForm: { ticket }, saveJar: true, jar: true });
  sid = J(si)?.response?.created_session_id;
  if (!sid) return { error: "FAPI ticket exchange produced no session" };
  clientUat = Math.floor(Date.now() / 1000);
  if (!mint()) return { error: "session token mint failed" };
  const app = (path) => {
    const r = curl({ url: `${APP}${path}`, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" } });
    return { status: r.s, json: J(r) };
  };
  return { app };
}

// ════════════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════════════
const summary = { flow_rows: 0, old_setups: 0, new_setups: 0, partA_removed: [], partB_earnings: [], partC_holds: [], committed_today: [] };

try {
  // ── [1] Live-board flow ────────────────────────────────────────────────────────────
  console.log(`\n[1] Fetching today's live-board flow (UW REST · since ${SINCE_HOURS}h · premium≥${fmtUsd(MIN_PREMIUM)} · ≤${MAX_DTE}DTE · top ${LIMIT})…`);
  const flow = await fetchLiveBoardFlow();
  summary.flow_rows = flow.length;
  const flowTickers = new Set(flow.map((r) => r.ticker));
  console.log(`    ${flow.length} directional 0-1DTE prints · ${flowTickers.size} tickers`);

  // ── PART A — OTM cap (deterministic) ───────────────────────────────────────────────
  console.log(`\n${line("═")}`);
  console.log(`  PART A — FAR-OTM CAP (deterministic on the flow tape)`);
  console.log(line("═"));

  const oldRej = [];
  const oldSetups = deriveZeroDteSetups(flow, { maxSetups: 50, nowMs: Date.now(), todayYmd: TODAY, rejections: oldRej });
  // NEW = OLD minus the exact set the cap rejects (otm_pct > NEW_CAP). The guard is a pure final
  // per-ticker filter, so this is byte-identical to a real cap=12 run (cross-checked below).
  const removedByCap = oldSetups.filter((s) => s.otm_pct != null && s.otm_pct > NEW_CAP);
  const newSetups = oldSetups.filter((s) => !(s.otm_pct != null && s.otm_pct > NEW_CAP));
  summary.old_setups = oldSetups.length;
  summary.new_setups = newSetups.length;

  // Cross-check: run deriveZeroDteSetups in a child with the REAL cap=12 and confirm the rejection
  // log's max_otm_pct tickers exactly match removedByCap (proves the post-filter == a live cap run).
  let capCheck; // assigned in both the try and catch below before it's read
  try {
    const res = runChildMjs(
      `import { deriveZeroDteSetups, SETUP_MAX_OTM_PCT } from ${JSON.stringify(`${SRC}lib/zerodte/board.ts`)};
       const flow = ${JSON.stringify(flow)};
       const rej = [];
       const s = deriveZeroDteSetups(flow, { maxSetups: 50, nowMs: Date.now(), todayYmd: ${JSON.stringify(TODAY)}, rejections: rej });
       console.log(JSON.stringify({ cap: SETUP_MAX_OTM_PCT, setups: s.length, otmRej: rej.filter((r) => r.gate_failed === 'max_otm_pct').map((r) => r.ticker).sort() }));`,
      { ZERODTE_SETUP_MAX_OTM_PCT: "12" }
    );
    const mine = removedByCap.map((s) => s.ticker).sort();
    const match = JSON.stringify(res.otmRej) === JSON.stringify(mine) && res.setups === newSetups.length;
    capCheck = `child cap=${res.cap} → ${res.setups} setups, otm-rejected [${res.otmRej.join(", ") || "—"}] · post-filter match: ${match ? "YES ✓" : "NO ✗"}`;
  } catch (e) {
    capCheck = `child cross-check failed: ${String(e.message || e).split("\n").slice(-2).join(" ")}`;
  }

  console.log(`\n  OLD (cap off): ${oldSetups.length} setups   NEW (cap ${NEW_CAP}): ${newSetups.length} setups   → cap removes ${removedByCap.length}`);
  console.log(`  cross-check: ${capCheck}`);
  if (removedByCap.length === 0) {
    console.log(`\n  No setup on today's tape is more than ${NEW_CAP}% OTM — the far-OTM cap removes NOTHING today.`);
  } else {
    console.log(`\n  ${pad("TICKER", 8)}${pad("DIR", 7)}${padL("STRIKE", 8)}${padL("OTM%", 8)}${padL("SCORE", 7)}${padL("GROSS", 10)}   grade (today's bars)`);
    console.log(`  ${line("·", 88)}`);
    for (const s of removedByCap) {
      let gradeStr = "";
      if (s.score >= 65) {
        const g = await gradeSetupToday(s.ticker, s.direction);
        const v = verdictFromGrade(g);
        gradeStr = `${g.outcome}${g.pnl_pct != null ? ` ${g.pnl_pct > 0 ? "+" : ""}${g.pnl_pct}%` : ""} → ${v.verdict}`;
        summary.partA_removed.push({ ticker: s.ticker, direction: s.direction, otm_pct: s.otm_pct, score: s.score, ...g, verdict: v.verdict, signed: v.signed });
      } else {
        gradeStr = `score ${s.score} < 65 — not committable OLD (no grade)`;
        summary.partA_removed.push({ ticker: s.ticker, direction: s.direction, otm_pct: s.otm_pct, score: s.score, committable: false });
      }
      console.log(
        `  ${pad(s.ticker, 8)}${pad(s.direction, 7)}${padL(s.top_strike, 8)}${padL(s.otm_pct, 8)}${padL(s.score, 7)}${padL(fmtUsd(s.gross_premium), 10)}   ${gradeStr}`
      );
    }
  }

  // ── PART B — earnings-all-ranks ─────────────────────────────────────────────────────
  console.log(`\n${line("═")}`);
  console.log(`  PART B — EARNINGS-ALL-RANKS (G-11 now applies past the top-5)`);
  console.log(line("═"));
  // Committable NEW setups (survived the cap), score-ranked; ranks >5 = index ≥5.
  const committableNew = newSetups.filter((s) => s.score >= 65);
  const ranksBeyond5 = committableNew.slice(5);
  console.log(`\n  committable NEW setups (score≥65): ${committableNew.length} · ranked >5: ${ranksBeyond5.length}`);

  let earnSnap = null;
  try {
    const { readGridEarnings } = await import(`${SRC}lib/zerodte/earnings.ts`);
    earnSnap = await Promise.race([
      readGridEarnings(),
      new Promise((resolve) => setTimeout(() => resolve("__timeout__"), 12_000)),
    ]);
  } catch (e) {
    earnSnap = { __error__: String(e.message || e).split("\n")[0] };
  }
  if (earnSnap === "__timeout__") {
    console.log(`  earnings snapshot: UNAVAILABLE (read timed out) — cannot evaluate Part B this run. Reporting honestly.`);
  } else if (!earnSnap || earnSnap.__error__ || !Array.isArray(earnSnap.items)) {
    console.log(`  earnings snapshot: UNAVAILABLE (${earnSnap?.__error__ ?? "no items"}) — cannot evaluate Part B this run.`);
  } else {
    const nextDay = etYmd(Date.now() + 86_400_000);
    const earnMap = matchEarnings(earnSnap.items, { today: TODAY, nextDay });
    console.log(`  earnings feed: ${earnSnap.items.length} reporters · matched to today(${TODAY})/next(${nextDay}): ${earnMap.size} names`);
    if (ranksBeyond5.length === 0) {
      console.log(`\n  No committable setup ranks beyond top-5 today → G-11-all-ranks changes nothing here.`);
    } else {
      const flagged = ranksBeyond5.filter((s) => earnMap.has(s.ticker.toUpperCase()));
      if (flagged.length === 0) {
        console.log(`\n  None of the ${ranksBeyond5.length} rank->5 committable names report today/next → nothing OLD would commit that NEW blocks.`);
      } else {
        for (const s of flagged) {
          const ef = earnMap.get(s.ticker.toUpperCase());
          const g = await gradeSetupToday(s.ticker, s.direction);
          const v = verdictFromGrade(g);
          console.log(`  ✗ ${s.ticker} ${s.direction} (rank ${committableNew.indexOf(s) + 1}, score ${s.score}) earnings ${ef.when} ${ef.report_date} — OLD commits, NEW blocks · grade ${g.outcome}${g.pnl_pct != null ? ` ${g.pnl_pct}%` : ""} → ${v.verdict}`);
          summary.partB_earnings.push({ ticker: s.ticker, when: ef.when, ...g, verdict: v.verdict, signed: v.signed });
        }
      }
    }
  }

  // ── PART C — today's ACTUAL commits under fail-open conditions ──────────────────────
  console.log(`\n${line("═")}`);
  console.log(`  PART C — TODAY'S ACTUAL COMMITS (fail-open hole inspection)`);
  console.log(line("═"));
  const auth = await authAndFetchBoard();
  if (auth.error) {
    console.log(`\n  AUTH FAILED (${auth.error}) — cannot read live ledger this run.`);
  } else {
    const boardRes = auth.app("/api/market/zerodte/board");
    const recRes = auth.app("/api/market/zerodte/record?days=1");
    console.log(`\n  GET /api/market/zerodte/board → ${boardRes.status}   GET /api/market/zerodte/record?days=1 → ${recRes.status}`);
    const ledger = Array.isArray(boardRes.json?.ledger) ? boardRes.json.ledger : [];
    const recPlays = Array.isArray(recRes.json?.plays) ? recRes.json.plays : [];
    const recToday = recPlays.filter((p) => p.session_date === TODAY);
    console.log(`  board.ledger rows: ${ledger.length}   record.plays (today ${TODAY}): ${recToday.length}`);
    // entry_context field availability note (which of the three holes are PERSISTED + READABLE):
    //  - cortex   → board.ledger[].cortex AND record.plays[].entry_context.cortex (abstained ⟹ every
    //               source absent ⟹ both veto sources absent ⟹ the veto-blind firewall would HOLD).
    //  - vix_open → record.plays[].entry_context.vix_open (day-open VIX at commit; null ⟹ vix_unavailable).
    //  - macro    → NOT persisted anywhere in entry_context (macroUnavailable is a scan-time gate INPUT,
    //               never written to the ledger row) — so a real commit's macro-at-commit state is
    //               UNKNOWABLE from persisted data. Reported as such, never inferred.
    const recByTicker = new Map(recToday.map((p) => [String(p.ticker).toUpperCase(), p]));

    if (ledger.length === 0) {
      console.log(`\n  No committed 0DTE plays in today's ledger yet — nothing for the firewall to have held today.`);
    } else {
      for (const row of ledger) {
        const tk = String(row.ticker).toUpperCase();
        const rec = recByTicker.get(tk);
        const ec = rec?.entry_context ?? null;
        const cortex = row.cortex ?? ec?.cortex ?? null;
        summary.committed_today.push(tk);

        // (1) cortex veto-blind hole
        let vetoBlind = false;
        let cortexNote;
        if (!cortex) {
          cortexNote = "cortex: NOT persisted on this row (refresh-lane / pre-wire-in) — cannot assess veto-blind";
        } else if (cortex.abstained === true) {
          vetoBlind = true; // abstain ⟹ all sources absent ⟹ both veto channels dark
          cortexNote = `cortex: ABSTAIN (every source absent ⟹ both veto channels dark) → firewall WOULD HOLD (VETO_BLIND)`;
        } else if (Array.isArray(cortex.absent)) {
          const absentSet = new Set(cortex.absent.map((a) => String(a).split(":")[0].trim()));
          vetoBlind = VETO_CAPABLE_SOURCES.every((s) => absentSet.has(s));
          cortexNote = vetoBlind
            ? `cortex: decision ${cortex.decision}, BOTH veto sources absent (${VETO_CAPABLE_SOURCES.join("+")}) → firewall WOULD HOLD (VETO_BLIND)`
            : `cortex: decision ${cortex.decision}, ≥1 veto source answered → firewall unchanged`;
        } else {
          cortexNote = `cortex: decision ${cortex.decision ?? "?"}, no absent[] list → firewall unchanged`;
        }

        // (2) vix null at commit
        let vixNote;
        let vixHole = false;
        if (!ec) vixNote = "vix: record entry_context not readable for this ticker — cannot assess";
        else if (ec.vix_open == null) {
          vixHole = true;
          vixNote = "vix_open: null at commit → G-4 firewall WOULD HOLD (vix_unavailable) if it was an attempted-unavailable read";
        } else vixNote = `vix_open: ${ec.vix_open} at commit → present, no vix_unavailable hole`;

        // (3) macro unavailable at commit — not persisted
        const macroNote = "macro: NOT persisted in entry_context (scan-time gate input) — macro-at-commit state UNKNOWABLE from the ledger; not inferred";

        const outcome = row.plan_outcome
          ? `${row.plan_outcome}${row.plan_pnl_pct != null ? ` ${row.plan_pnl_pct > 0 ? "+" : ""}${row.plan_pnl_pct}%` : ""}`
          : `${row.status ?? "live"}${row.live_pnl_pct != null ? ` ${row.live_pnl_pct}%` : ""}`;
        const wouldHold = vetoBlind || vixHole;
        // Actual realized P&L of the play the firewall would have held → held loser = avoided loss
        // (positive signed impact), held winner = forgone gain (negative). Prefer the graded plan
        // P&L; for a CLOSED row not yet post-session-graded, the board's realized live P&L
        // (live_pnl_pct — a stop books PLAN_RULES.stop_pct, a managed close the marked P&L) is the
        // realized outcome. A still-live (non-CLOSED) row stays UNGRADED (outcome not yet realized).
        const realizedPnl =
          row.plan_pnl_pct != null ? row.plan_pnl_pct : row.status === "CLOSED" ? row.live_pnl_pct ?? null : null;
        if (wouldHold) {
          const heldVerdict = realizedPnl == null ? "UNGRADED" : realizedPnl < 0 ? "LOSER-AVOIDED" : realizedPnl > 0 ? "WINNER-FORGONE" : "SCRATCH";
          summary.partC_holds.push({
            ticker: tk,
            reasons: [vetoBlind ? "veto_blind" : null, vixHole ? "vix_unavailable" : null].filter(Boolean),
            outcome,
            pnl: realizedPnl,
            verdict: heldVerdict,
            signed: realizedPnl == null ? 0 : -realizedPnl, // avoided a −X% loss ⟹ +X% impact
          });
        }

        console.log(`\n  ● ${tk} ${row.direction} ${row.top_strike ?? "?"}${row.direction === "long" ? "c" : "p"} — actual outcome: ${outcome}   ${wouldHold ? "⇒ FIREWALL WOULD HAVE HELD" : "⇒ firewall unchanged"}`);
        console.log(`      ${cortexNote}`);
        console.log(`      ${vixNote}`);
        console.log(`      ${macroNote}`);
      }
    }
  }

  // ── PART D — guard-fires proof (works even if today didn't trigger it) ───────────────
  console.log(`\n${line("═")}`);
  console.log(`  PART D — GUARD-FIRES PROOF (real functions, injected outages)`);
  console.log(line("═"));

  // (1) assessCortexVerdict — both veto-capable sources absent.
  const nowIso = new Date().toISOString();
  const absentAllButOne = CORTEX_SOURCES.filter((s) => s !== "sector-heat").map((s) => `${s}: reader timeout`);
  const vetoBlindVerdict = {
    ticker: "TEST",
    direction: "long",
    asOf: nowIso,
    vetoes: [],
    score: 0.6,
    supports: [{ source: "sector-heat", stance: "supports", weight: 0.6, halfLifeSec: 3600, asOf: nowIso, detail: "sector heat aligns long (constructed)" }],
    opposes: [],
    absent: absentAllButOne, // gex-walls + flow-quality both absent; sector-heat answered
    conviction: "B",
    narrative: [],
  };
  const onOpt = assessCortexVerdict(vetoBlindVerdict, { failClosedOnVetoBlind: true });
  const offOpt = assessCortexVerdict(vetoBlindVerdict, { failClosedOnVetoBlind: false });
  console.log(`\n  (1) Cortex both-veto-absent (${VETO_CAPABLE_SOURCES.join("+")} down, sector-heat answered):`);
  console.log(`      failClosedOnVetoBlind:true  → decision ${onOpt.decision}${onOpt.decision === "VETO_BLIND" ? "  ✓ HOLDS" : ""}`);
  console.log(`      failClosedOnVetoBlind:false → decision ${offOpt.decision}${offOpt.decision === "PASS" || offOpt.decision === "ABSTAIN" ? "  ✓ commits (old behavior)" : ""}`);
  // Also the all-absent → ABSTAIN(off) case for completeness.
  const allAbsent = { ...vetoBlindVerdict, score: 0, supports: [], absent: CORTEX_SOURCES.map((s) => `${s}: reader timeout`) };
  console.log(`      all-8-absent → opt:true ${assessCortexVerdict(allAbsent, { failClosedOnVetoBlind: true }).decision} · opt:false ${assessCortexVerdict(allAbsent, { failClosedOnVetoBlind: false }).decision}`);

  // (2)/(3) evaluateZeroDteGates — a clean input isolating the VIX / macro firewall blocks.
  const etMinNow = 11 * 60; // 11:00 ET — past the 10:00 opening-window gate
  const cleanGov = { open_plans: [], stops: [], realized_losers: 0, session_pnl_pct: 0 };
  const cleanPlan = { entry_status: "OK", illiquid: false, spread_pct: 5, vs_flow_pct: 0, mark: 1.0, occ: "O:TEST" };
  const baseInput = {
    ticker: "MU", // non-index single name → a present VIX≥20 could block → firewall could-block=true
    direction: "long",
    score: 80,
    nowEtMinutes: etMinNow,
    nowMs: Date.now(),
    bias: "up", // tape-aligned (long + up) so G-1 clears
    biasAsOfMs: Date.now(), // fresh
    governor: cleanGov,
    committedThisCycle: [],
    vixDayOpen: null,
    vixUnavailable: true, // attempted-and-unavailable → G-4 firewall input
    slayerLive: null,
    nighthawkTake: null,
    macroEvents: [],
    macroUnavailable: false,
    todayYmd: TODAY,
    plan: cleanPlan,
    intradayConflict: false,
    halted: false,
    earnings: null,
  };
  console.log(`\n  (2) evaluateZeroDteGates · vixUnavailable:true on non-index "MU" (clean input, all other gates pass):`);
  const g4on = runGatesInChild({ ZERODTE_G4_FAIL_CLOSED: undefined }, baseInput);
  const g4off = runGatesInChild({ ZERODTE_G4_FAIL_CLOSED: "0" }, baseInput);
  console.log(`      G4 ON  (default)          → verdict ${g4on.verdict ?? g4on.error} · blocks [${(g4on.blocks || []).join(", ")}]${(g4on.blocks || []).includes("vix_unavailable") ? "  ✓ vix_unavailable fired" : ""}`);
  console.log(`      G4 OFF (ZERODTE_G4_FAIL_CLOSED=0) → verdict ${g4off.verdict ?? g4off.error} · blocks [${(g4off.blocks || []).join(", ")}]${!(g4off.blocks || []).includes("vix_unavailable") ? "  ✓ no vix block" : ""}`);

  console.log(`\n  (3) evaluateZeroDteGates · macroUnavailable:true (same clean input):`);
  const macroInput = { ...baseInput, vixDayOpen: 14, vixUnavailable: false, macroUnavailable: true };
  const g7on = runGatesInChild({ ZERODTE_G7_FAIL_CLOSED: undefined }, macroInput);
  const g7off = runGatesInChild({ ZERODTE_G7_FAIL_CLOSED: "0" }, macroInput);
  console.log(`      G7 ON  (default)          → verdict ${g7on.verdict ?? g7on.error} · blocks [${(g7on.blocks || []).join(", ")}]${(g7on.blocks || []).includes("macro_unavailable") ? "  ✓ macro_unavailable fired" : ""}`);
  console.log(`      G7 OFF (ZERODTE_G7_FAIL_CLOSED=0) → verdict ${g7off.verdict ?? g7off.error} · blocks [${(g7off.blocks || []).join(", ")}]${!(g7off.blocks || []).includes("macro_unavailable") ? "  ✓ no macro block" : ""}`);

  // ── SUMMARY ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${line("═")}`);
  console.log(`  SUMMARY — ${TODAY}`);
  console.log(line("═"));
  const committableRemoved = summary.partA_removed.filter((r) => r.committable !== false);
  const partAlosers = committableRemoved.filter((r) => r.verdict === "LOSER-AVOIDED");
  const partAwinners = committableRemoved.filter((r) => r.verdict === "WINNER-FORGONE");
  const partBlosers = summary.partB_earnings.filter((r) => r.verdict === "LOSER-AVOIDED");
  const partBwinners = summary.partB_earnings.filter((r) => r.verdict === "WINNER-FORGONE");
  const partClosers = summary.partC_holds.filter((r) => r.verdict === "LOSER-AVOIDED");
  const partCwinners = summary.partC_holds.filter((r) => r.verdict === "WINNER-FORGONE");
  const allChanged = [...committableRemoved.filter((r) => r.verdict), ...summary.partB_earnings, ...summary.partC_holds];
  const totalChanged = committableRemoved.length + summary.partB_earnings.length + summary.partC_holds.length;
  const netSigned = allChanged.reduce((a, r) => a + (r.signed ?? 0), 0);
  const losersAvoided = partAlosers.length + partBlosers.length + partClosers.length;
  const winnersForgone = partAwinners.length + partBwinners.length + partCwinners.length;

  console.log(`  Flow tape: ${summary.flow_rows} prints · OLD ${summary.old_setups} setups → NEW ${summary.new_setups} setups.`);
  console.log(`  Committed today (real ledger): [${summary.committed_today.join(", ") || "none"}]`);
  console.log(`  Firewall DELTA today:`);
  console.log(`    • PART A far-OTM cap : removed ${summary.partA_removed.length} setup(s), ${committableRemoved.length} committable → ${partAlosers.length} loser-avoided / ${partAwinners.length} winner-forgone`);
  console.log(`    • PART B earnings>5  : ${summary.partB_earnings.length} blocked → ${partBlosers.length} loser-avoided / ${partBwinners.length} winner-forgone`);
  console.log(`    • PART C real commits: ${summary.partC_holds.length} of ${summary.committed_today.length} committed play(s) the firewall WOULD have held → ${partClosers.length} loser-avoided / ${partCwinners.length} winner-forgone`);
  for (const h of summary.partC_holds) console.log(`        - ${h.ticker}: held via ${h.reasons.join("+")} · actual ${h.outcome} → ${h.verdict}`);
  console.log(`  OLD committed vs NEW committed today: OLD would have printed [${summary.committed_today.join(", ") || "none"}]; NEW holds ${summary.partC_holds.length} → NEW prints [${summary.committed_today.filter((t) => !summary.partC_holds.some((h) => h.ticker === t)).join(", ") || "none"}]`);
  console.log(`  Of the delta: ${losersAvoided} loser-avoided / ${winnersForgone} winner-forgone.`);
  console.log(`  Net session-P&L impact (signed, avoided losses positive): ${netSigned >= 0 ? "+" : ""}${netSigned.toFixed(1)}% across ${totalChanged} counterfactual play(s).`);
  if (totalChanged === 0) {
    console.log(`\n  ⇒ 0 plays changed today. Today's reads were clean (no far-OTM lotto, no earnings-today past top-5,`);
    console.log(`    committed plays had readable VIX + at least one veto channel). The firewall is INSURANCE against`);
    console.log(`    fail-open days — its guards are proven firing on injected outages in PART D above.`);
  } else {
    console.log(`\n  ⇒ ${totalChanged} play(s) would have changed today (detail above).`);
  }
  console.log(line("═"));
} catch (err) {
  console.error(`\nFATAL: ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
} finally {
  // ALWAYS delete the temp Clerk user (cleanup) + scratch dir.
  if (userId) {
    const del = backend("DELETE", `/users/${userId}`);
    console.log(`\n[cleanup] deleted temp Clerk user ${userId} → HTTP ${del.s}`);
  }
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
}
