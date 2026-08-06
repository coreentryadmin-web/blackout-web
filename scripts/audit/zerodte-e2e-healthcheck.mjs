#!/usr/bin/env node
/*
 * 0DTE "Night Hawk" END-TO-END HEALTH CHECK — one repeatable run that asserts the WHOLE
 * 0DTE system is live, producing, tracking, and grading against PRODUCTION
 * (blackouttrades.com), and prints a per-stage GREEN / AMBER / RED matrix. This is the
 * "is everything actually working end-to-end before market open" check.
 *
 * READ-ONLY. It logs into the live site as ONE temporary admin+premium Clerk user (headless
 * HTTP, no browser — the proven data-validator.mjs auth block), reads the SAME authenticated
 * board / marks / record endpoints the desk polls, cross-checks numbers against Polygon
 * ground truth, and (when AWS creds are present) inspects the ECS services. It writes NOTHING
 * to prod, mutates NO board state, and ALWAYS deletes its temp user in a finally block
 * (self-healing any leftover claude-audit-temp user). Authenticates ONCE per run (Clerk FAPI
 * rate-limits rapid sign-in cycles).
 *
 * STAGES (each → GREEN / AMBER / RED with one-line evidence):
 *   A  INFRA/CONFIG   — ECS market-worker + web services healthy on the latest image and the
 *                       ZERODTE_* discovery flags (whole-market + 3 sources + condor) present
 *                       in the task def. SKIPPED (not RED) when AWS creds are absent/invalid.
 *   B  DISCOVERY ×3   — the live board carries candidates/plays from each origin FLOW /
 *                       BREAKOUT / PIN; an origin with zero → AMBER with the captured gate /
 *                       governor / cortex reason (empty is never assumed correct).
 *   C  COMMIT/LEDGER  — every committed play carries entry_premium, a frozen decision snapshot
 *                       (cortex/tier), origin/direction/strike, first_flagged_at.
 *   D  LIVE MARKS+P&L — each OPEN play has a fresh, live-P&L mark; the displayed contract mark
 *                       is cross-checked against Polygon's own option quote.
 *   E  EXIT MGMT      — OPEN/HOLD/TRIM/CLOSED lifecycle values are internally coherent (a
 *                       CLOSED-stopped row shows the -50% stop P&L).
 *   F  IRON CONDOR    — FIRST-CLASS: is the condor selected + tracked? Real 4-leg geometry
 *                       (short/long both sides, net credit, wings, breach levels) + tracking.
 *   G  GRADING/RECORD — closed rows have graded outcomes and wins+losses+breakeven == graded.
 *
 * Exit code: NON-ZERO if any non-skipped stage is RED (usable as a pre-open gate).
 *
 * SECRETS — env ONLY (never hardcoded / committed):
 *   CLERK_SECRET_KEY                    (prod Clerk backend key)
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   (derives the FAPI host; falls back to clerk.blackouttrades.com)
 *   POLYGON_API_KEY                     (literal; the ${{shared.*}} ref does NOT resolve here)
 *   AWS_ACCESS_KEY_ID / _SECRET_ACCESS_KEY (OPTIONAL — enables stage A; absent → stage A SKIPPED)
 * ENV (optional): AUDIT_APP_URL, AUDIT_EMAIL, AUDIT_PHONE, POLYGON_API_BASE (self-defaults to
 *   https://api.polygon.io with a /^https?:/ guard, like the sibling audit tools).
 *
 * FLAGS: --json  machine output (the full stage matrix + evidence)
 *        --quiet suppress the per-check chatter (keep the final matrix)
 *        --stage=A,B,F run a subset of stages
 *
 * RUN (this tool WANTS AWS creds for stage A when available — do NOT strip them):
 *   node --import tsx scripts/audit/zerodte-e2e-healthcheck.mjs
 * or:  npm run healthcheck:0dte
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { createOrAdoptAuditUserViaCurl } from "./lib/clerk-audit-user.mjs";
import { isAuthFailureStatus } from "./lib/auth-status.mjs";
import {
  rollupVerdict,
  verdictForStaleness,
  markAgreement,
  condorGeometryCheck,
  trackRecordConsistent,
  exitLifecycleCoherent,
  commitRowComplete,
  partitionMarkRows,
  verdictForMark,
} from "./lib/zerodte-healthcheck-eval.mjs";

// ── args ──────────────────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const JSON_OUT = ARGV.includes("--json");
const QUIET = ARGV.includes("--quiet") || JSON_OUT;
const STAGE_ARG = (ARGV.find((a) => a.startsWith("--stage=")) || "").split("=")[1] || "";
const ALL_STAGES = ["A", "B", "C", "D", "E", "F", "G"];
const STAGES = STAGE_ARG
  ? STAGE_ARG.split(",").map((s) => s.trim().toUpperCase()).filter((s) => ALL_STAGES.includes(s))
  : ALL_STAGES;
const wantStage = (id) => STAGES.includes(id);

// ── secrets / config ────────────────────────────────────────────────────────────────
function req(name) {
  const v = process.env[name];
  if (!v || v.includes("${{")) {
    console.error(`FATAL: env ${name} is missing or an unresolved \${{...}} placeholder. Set it to a literal value.`);
    process.exit(3);
  }
  return v;
}
const SECRET = req("CLERK_SECRET_KEY");
const POLY = req("POLYGON_API_KEY");
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const EMAIL = process.env.AUDIT_EMAIL || "claude-audit-temp@blackouttrades.com";
const PHONE = process.env.AUDIT_PHONE || generateDefaultAuditPhone();
const API = "https://api.clerk.com/v1";
// Self-default the Polygon base with the same /^https?:/ guard the other audit tools use:
// the ${{shared.*}} ref does not resolve in this sandbox, and a malformed value must not
// silently produce a bare "undefined/..." URL.
const PB = (() => {
  const raw = process.env.POLYGON_API_BASE;
  return raw && /^https?:/.test(raw) ? raw.replace(/\/$/, "") : "https://api.polygon.io";
})();
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const AWS_REGION = process.env.AWS_DEFAULT_REGION || "us-east-1";
const ECS_CLUSTER = process.env.ECS_CLUSTER || "blackout-production-cluster";
const ECS_WEB = process.env.ECS_WEB_SERVICE || "blackout-production-web";
const ECS_WORKER = process.env.ECS_WORKER_SERVICE || "blackout-production-market-worker";
// The discovery flags the whole-market board needs live: the 3 discovery systems ON + condor.
const REQUIRED_ZERODTE_FLAGS = ["ZERODTE_WHOLE_MARKET", "ZERODTE_SRC_BREAKOUT", "ZERODTE_SRC_PIN", "ZERODTE_CONDOR"];
// Live-mark freshness bound during RTH: mirror the app's own ZERODTE_MARK_STALE_MS budget
// (marks-math.ts) with generous headroom for round-trip + poll skew. Off-hours the lane
// idles by design, so staleness there is AMBER, never RED (verdictForStaleness(rth=false)).
const MARK_FRESH_BOUND_MS = 20_000;
// Option-mark cross-check tolerance vs Polygon: options quote with wide spreads and the app
// snapshot vs an async Polygon tick legitimately diverge; reuse the app's own 15% "illiquid"
// threshold (plan.ts) as the band, so only a GROSS disagreement flags.
const OPTION_MARK_TOL_PCT = 15;

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `zerodte-e2e-${process.pid}`);
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
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });
const poly = (p) => J(curl({ url: `${PB}${p}${p.includes("?") ? "&" : "?"}apiKey=${POLY}` }));
const num = (x) => {
  if (x == null) return null;
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

// ── recording ────────────────────────────────────────────────────────────────────────
// Each STAGE holds a set of sub-checks; the stage verdict is the worst sub-verdict, with
// an explicit override when the stage never even ran (SKIPPED).
const stages = new Map(); // id -> { id, name, checks: [{verdict, label, detail}], forced }
function ensureStage(id, name) {
  if (!stages.has(id)) stages.set(id, { id, name, checks: [], forced: null });
  return stages.get(id);
}
function check(id, verdict, label, detail) {
  const st = stages.get(id);
  st.checks.push({ verdict, label, detail });
  if (!QUIET) console.log(`  [${verdict}] ${id} · ${label}${detail ? " — " + detail : ""}`);
}
function forceStage(id, verdict, detail) {
  const st = stages.get(id);
  st.forced = { verdict, detail };
  if (!QUIET) console.log(`  [${verdict}] ${id} · ${st.name} — ${detail}`);
}
function stageVerdict(st) {
  if (st.forced) return st.forced.verdict;
  if (st.checks.length === 0) return "SKIPPED";
  return rollupVerdict(st.checks.map((c) => c.verdict));
}

// ── AWS (stage A) ─────────────────────────────────────────────────────────────────────
function awsCredsPresent() {
  const k = process.env.AWS_ACCESS_KEY_ID || "";
  const s = process.env.AWS_SECRET_ACCESS_KEY || "";
  // The sandbox default placeholders are non-functional; treat obvious placeholders as absent.
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

async function stageA_infra() {
  ensureStage("A", "INFRA/CONFIG");
  if (!awsCredsPresent()) {
    forceStage("A", "SKIPPED", "AWS creds absent/placeholder — infra stage skipped (run with valid AWS_ACCESS_KEY_ID/SECRET to enable)");
    return;
  }
  // Prove the creds actually work before trusting any negative result as RED.
  const who = aws(["sts", "get-caller-identity"]);
  if (!who.ok) {
    forceStage("A", "SKIPPED", `AWS creds present but not usable (${who.err}) — infra stage skipped, not failed`);
    return;
  }
  const svc = aws(["ecs", "describe-services", "--cluster", ECS_CLUSTER, "--services", ECS_WEB, ECS_WORKER]);
  if (!svc.ok || !svc.json?.services) {
    check("A", "RED", "ecs describe-services", svc.err || "no services returned");
    return;
  }
  const byName = new Map(svc.json.services.map((s) => [s.serviceName, s]));
  for (const [name, s] of byName) {
    if (!s || s.status !== "ACTIVE") {
      check("A", "RED", `service ${name} ACTIVE`, `status=${s?.status ?? "MISSING"}`);
      continue;
    }
    const running = s.runningCount ?? 0;
    const desired = s.desiredCount ?? 0;
    const rollout = (s.deployments || []).find((d) => d.status === "PRIMARY")?.rolloutState ?? "?";
    const healthy = running === desired && desired > 0 && rollout !== "FAILED";
    check(
      name === ECS_WORKER ? "A" : "A",
      healthy ? "GREEN" : running > 0 ? "AMBER" : "RED",
      `service ${name}`,
      `running ${running}/${desired} · rollout ${rollout}`
    );
  }
  // Discovery flags on the market-worker task def (the ingest process that runs the sockets/scan).
  const worker = byName.get(ECS_WORKER);
  const taskDefArn = worker?.taskDefinition;
  if (!taskDefArn) {
    check("A", "AMBER", "market-worker task def", "no taskDefinition on the service — cannot read ZERODTE_* flags");
    return;
  }
  const td = aws(["ecs", "describe-task-definition", "--task-definition", taskDefArn]);
  if (!td.ok || !td.json?.taskDefinition) {
    check("A", "AMBER", "describe-task-definition", td.err || "no task def returned");
    return;
  }
  const envPairs = [];
  for (const c of td.json.taskDefinition.containerDefinitions || []) {
    for (const e of c.environment || []) envPairs.push([e.name, e.value]);
  }
  const envMap = new Map(envPairs);
  // NEVER print secret values — only report flag PRESENCE + whether it reads "1".
  const flagState = REQUIRED_ZERODTE_FLAGS.map((f) => `${f}=${envMap.has(f) ? (envMap.get(f) === "1" ? "on" : "off") : "MISSING"}`);
  const allOn = REQUIRED_ZERODTE_FLAGS.every((f) => envMap.get(f) === "1");
  const anyMissing = REQUIRED_ZERODTE_FLAGS.some((f) => !envMap.has(f));
  check(
    "A",
    allOn ? "GREEN" : anyMissing ? "RED" : "AMBER",
    "market-worker ZERODTE_* discovery flags",
    flagState.join(" ")
  );
}

// ── shared prod reads ───────────────────────────────────────────────────────────────
let board = null;
let marks = null;
let record = null;
let rth = false;

// ── DISCOVERY ×3 (stage B) ────────────────────────────────────────────────────────────
function collectOrigins(setups) {
  const seen = new Set();
  for (const s of setups || []) {
    for (const o of Array.isArray(s?.discovery_origin) ? s.discovery_origin : []) seen.add(o);
  }
  return seen;
}
function stageB_discovery() {
  ensureStage("B", "DISCOVERY ×3");
  if (!board || board.available !== true) {
    check("B", board ? "AMBER" : "RED", "board payload", board ? `available=${board.available} (degraded fallback)` : "no board response (see auth)");
    return;
  }
  const setups = Array.isArray(board.setups) ? board.setups : [];
  const ledger = Array.isArray(board.ledger) ? board.ledger : [];
  const originsPresent = collectOrigins(setups);
  // A committed ledger row's origin lives in entry_context (not on the board row), so the
  // live board's origin coverage is read off the fresh `setups` — where discovery_origin is a
  // first-class field. If a source produced nothing right now, capture WHY from the surfaced
  // governor / heat / gate context rather than calling empty "correct".
  const heat = board.session?.heat?.state ?? "?";
  const gov = board.governor;
  const govNote = gov ? `governor ${gov.state ?? gov.status ?? "?"}` : "governor unavailable";
  for (const origin of ["FLOW", "BREAKOUT", "PIN"]) {
    if (originsPresent.has(origin)) {
      const n = setups.filter((s) => (s.discovery_origin || []).includes(origin)).length;
      check("B", "GREEN", `origin ${origin}`, `${n} live setup(s) carry ${origin}`);
    } else {
      // Empty is common + legitimate (pre-10:00 G-2 mask, dead tape, all candidates gated).
      // Report AMBER with the captured reason — never GREEN, never a silent RED.
      const gateReasons = collectGateReasons(setups);
      check(
        "B",
        "AMBER",
        `origin ${origin}`,
        `0 live ${origin} setups · heat=${heat} · ${govNote}${gateReasons ? " · gates seen: " + gateReasons : ""}`
      );
    }
  }
  check("B", "GREEN", "board producing", `${setups.length} live setup(s), ${ledger.length} ledger row(s), upstream_ok=${board.upstream_ok}`);
}
function collectGateReasons(setups) {
  const codes = new Set();
  for (const s of setups || []) {
    for (const b of s?.gate?.blocks || []) if (b?.code) codes.add(b.code);
  }
  return [...codes].slice(0, 6).join(",");
}

// ── COMMIT/LEDGER (stage C) ───────────────────────────────────────────────────────────
function stageC_commit() {
  ensureStage("C", "COMMIT/LEDGER");
  const ledger = Array.isArray(board?.ledger) ? board.ledger : [];
  if (ledger.length === 0) {
    check("C", "AMBER", "committed ledger rows", "0 committed plays right now (legitimate pre-open / no-commit session) — nothing to assert");
    return;
  }
  let snapshotless = 0;
  for (const row of ledger) {
    const r = commitRowComplete(row);
    if (!r.ok) {
      check("C", "RED", `commit ${row.ticker}`, `missing ${r.missing.join(",")}`);
      continue;
    }
    if (!r.hasSnapshot) snapshotless++;
    check(
      "C",
      "GREEN",
      `commit ${row.ticker}`,
      `entry ${row.entry_premium} · ${row.direction} ${row.top_strike}${row.expiry ? " " + row.expiry : ""} · flagged ${row.first_flagged_at}${r.hasSnapshot ? " · frozen snapshot" : " · (legacy, no snapshot)"}`
    );
  }
  if (snapshotless > 0) {
    check("C", "AMBER", "frozen decision snapshot", `${snapshotless}/${ledger.length} row(s) predate the cortex/tier wiring (no pinned snapshot) — legacy rows, not a break`);
  }
}

// ── LIVE MARKS + P&L (stage D) ────────────────────────────────────────────────────────
/** Polygon "now" mark for an OCC option: prefer the NBBO midpoint, else last trade. */
function polygonOptionMark(occ, underlying) {
  const u = String(underlying || "").toUpperCase();
  // Index roots list under their plain underlying (SPXW→SPX for the snapshot path).
  const underlyingParam = u === "SPXW" ? "SPX" : u;
  const snap = poly(`/v3/snapshot/options/${encodeURIComponent(underlyingParam)}/${encodeURIComponent(occ)}`)?.results;
  if (!snap) return null;
  const bid = num(snap.last_quote?.bid);
  const ask = num(snap.last_quote?.ask);
  if (bid != null && ask != null && ask > 0) return (bid + ask) / 2;
  const last = num(snap.last_trade?.price);
  return last;
}
function stageD_marks() {
  ensureStage("D", "LIVE MARKS+P&L");
  if (!marks || marks.available !== true) {
    check("D", marks ? "AMBER" : "RED", "marks payload", marks ? `available=${marks.available}` : "no /marks response");
    return;
  }
  const rows = Array.isArray(marks.marks) ? marks.marks : [];
  // Only ENTERED plays (entry_premium != null) are the "LIVE MARKS + P&L" subsystem — the
  // quote-only WATCH rows merged into the same payload carry no position and no P&L, so an
  // unquoted one is a coverage observation, not a broken mark. See partitionMarkRows.
  const { entered: open, quoteOnly } = partitionMarkRows(rows);
  if (quoteOnly.length > 0) {
    const quoted = quoteOnly.filter((r) => r.mark != null).length;
    check(
      "D",
      // Off-hours the setup-quote poller idles by design → an unquoted watch roster is
      // expected. During RTH a fully-unquoted roster means the poller isn't running.
      quoted > 0 || !rth ? (quoted === quoteOnly.length ? "GREEN" : "AMBER") : "RED",
      "setup quote coverage",
      `${quoted}/${quoteOnly.length} watch-only setup contract(s) quoted (no position, no P&L)`
    );
  }
  if (open.length === 0) {
    check("D", "AMBER", "open plays to mark", `live lane idle=${marks.idle} · ${rows.length} tracked contract(s) · no ENTERED play to mark right now`);
    return;
  }
  for (const r of open) {
    const ageMs = num(r.mark_age_ms);
    const freshV = verdictForMark(r.mark, ageMs, MARK_FRESH_BOUND_MS, rth);
    check(
      "D",
      freshV,
      `mark ${r.ticker}`,
      `mark=${r.mark} age=${ageMs == null ? "unknown" : (ageMs / 1000).toFixed(1) + "s"} src=${r.source} stale=${r.stale} pnl=${r.live_pnl_pct}%`
    );
    // Internal P&L coherence: live_pnl_pct ≈ (mark−entry)/entry for a long (marks-math pinnedLivePnlPct).
    if (r.mark != null && num(r.entry_premium) != null && r.direction === "long") {
      const expected = ((num(r.mark) - num(r.entry_premium)) / num(r.entry_premium)) * 100;
      const got = num(r.live_pnl_pct);
      if (got != null && Math.abs(got - expected) > 2) {
        check("D", "RED", `pnl coherence ${r.ticker}`, `displayed ${got}% vs (mark-entry)/entry ${expected.toFixed(1)}%`);
      }
    }
    // Cross-check the displayed mark against Polygon's own option quote.
    if (r.occ && r.mark != null) {
      const polyMark = polygonOptionMark(r.occ, r.ticker);
      const agree = markAgreement(r.mark, polyMark, OPTION_MARK_TOL_PCT);
      if (agree == null) {
        check("D", "AMBER", `mark vs Polygon ${r.ticker}`, `no Polygon quote for ${r.occ} right now (thin contract / off-hours) — cannot cross-check`);
      } else {
        check(
          "D",
          agree.ok ? "GREEN" : rth ? "RED" : "AMBER",
          `mark vs Polygon ${r.ticker}`,
          `app=${r.mark} polygon=${polyMark} Δ=${agree.deltaPct.toFixed(1)}% (tol ${OPTION_MARK_TOL_PCT}%)`
        );
      }
    }
  }
}

// ── EXIT MGMT (stage E) ───────────────────────────────────────────────────────────────
function stageE_exit() {
  ensureStage("E", "EXIT MGMT");
  const ledger = Array.isArray(board?.ledger) ? board.ledger : [];
  if (ledger.length === 0) {
    check("E", "AMBER", "lifecycle rows", "0 ledger rows — no lifecycle to assert this run");
    return;
  }
  const counts = { OPEN: 0, HOLD: 0, TRIM: 0, CLOSED: 0, other: 0 };
  for (const row of ledger) {
    if (counts[row.status] != null) counts[row.status]++;
    else counts.other++;
    const c = exitLifecycleCoherent(row, { stopPct: -50 });
    if (!c.ok) check("E", "RED", `lifecycle ${row.ticker}`, `${row.status}/${row.closed_reason}: ${c.reasons.join("; ")}`);
  }
  check("E", "GREEN", "lifecycle coherence", `OPEN ${counts.OPEN} · HOLD ${counts.HOLD} · TRIM ${counts.TRIM} · CLOSED ${counts.CLOSED}${counts.other ? " · other " + counts.other : ""}`);
}

// ── IRON CONDOR (stage F) — FIRST-CLASS ───────────────────────────────────────────────
function stageF_condor() {
  ensureStage("F", "IRON CONDOR");
  const setups = Array.isArray(board?.setups) ? board.setups : [];
  // 1) Is a condor STRUCTURE selected + tracked? A CONDOR play carries play_type:"CONDOR" +
  //    a priced condor_plan (four legs off the live chain, net credit, breach levels).
  const condorSetups = setups.filter((s) => s?.play_type === "CONDOR" || s?.condor_plan);
  if (condorSetups.length > 0) {
    for (const s of condorSetups) {
      const plan = s.condor_plan;
      const geo = condorGeometryCheck(plan, { requireCredit: false });
      const tracked = plan && (plan.net_credit != null || plan.est_win_rate != null);
      check(
        "F",
        geo.valid ? "GREEN" : "RED",
        `condor ${s.ticker}`,
        geo.valid
          ? `SP ${plan.short_put}/LP ${plan.long_put} · SC ${plan.short_call}/LC ${plan.long_call} · wing ${plan.wing_pts} · credit ${plan.net_credit} · breach [${plan.breach_lower},${plan.breach_upper}] · WR ${plan.est_win_rate} · tracked=${!!tracked}`
          : geo.reasons.join("; ")
      );
    }
    return;
  }
  // 2) No CONDOR play routed right now (PIN candidate + ZERODTE_CONDOR flags). The condor is
  //    STILL a first-class subsystem: every DIRECTIONAL setup carries the calibration-only
  //    `condor` GEOMETRY (iron-condor.ts IronCondorLegs). Assert that geometry is real + well-
  //    formed so the condor engine is proven wired even when no live condor is actionable.
  const withGeometry = setups.filter((s) => s?.condor && typeof s.condor === "object");
  if (withGeometry.length > 0) {
    let bad = 0;
    for (const s of withGeometry.slice(0, 5)) {
      const geo = condorGeometryCheck(s.condor, { requireCredit: false });
      if (!geo.valid) {
        bad++;
        check("F", "RED", `condor geometry ${s.ticker}`, geo.reasons.join("; "));
      }
    }
    check(
      "F",
      bad > 0 ? "RED" : "AMBER",
      "condor engine wired (calibration geometry)",
      `${withGeometry.length}/${setups.length} setups carry well-formed iron-condor geometry; no live CONDOR play routed (needs a PIN candidate + ZERODTE_CONDOR/SRC_PIN on) — engine proven wired, condor not actionable this run`
    );
    return;
  }
  // 3) Neither a routed condor nor any attached geometry — can't confirm the engine is live.
  //    AMBER with the reason (usually an empty board), never a silent green.
  check(
    "F",
    setups.length === 0 ? "AMBER" : "RED",
    "condor selected/tracked",
    setups.length === 0
      ? "board has 0 live setups — no name to carry condor geometry (empty board, cannot assert condor engine)"
      : `${setups.length} setups but NONE carry condor geometry or a condor_plan — the condor engine is not attaching (real gap)`
  );
}

// ── GRADING / TRACK-RECORD (stage G) ──────────────────────────────────────────────────
function stageG_grading() {
  ensureStage("G", "GRADING/RECORD");
  if (!record || record.available !== true) {
    check("G", record ? "AMBER" : "RED", "record payload", record ? `available=${record.available}` : "no /record response");
    return;
  }
  const tr = trackRecordConsistent({
    graded: record.graded,
    wins: record.wins,
    losses: record.losses,
    breakeven: record.breakeven,
  });
  check(
    "G",
    tr.ok ? "GREEN" : "RED",
    "track-record arithmetic",
    `wins ${record.wins}+losses ${record.losses}+be ${record.breakeven}=${tr.sum} vs graded ${tr.graded} · WR ${record.win_rate_pct}% over ${record.window?.sessions ?? "?"} sessions`
  );
  // Closed rows on the live board should carry a graded outcome (doubled/stopped/time_stop
  // family). Read from the board ledger's plan_outcome (grading writes it post-close).
  const ledger = Array.isArray(board?.ledger) ? board.ledger : [];
  const closed = ledger.filter((r) => r.status === "CLOSED");
  if (closed.length > 0) {
    const ungraded = closed.filter((r) => !r.graded && r.plan_outcome == null);
    check(
      "G",
      ungraded.length === 0 ? "GREEN" : "AMBER",
      "closed rows graded",
      `${closed.length - ungraded.length}/${closed.length} closed rows carry a graded outcome${ungraded.length ? " (" + ungraded.map((r) => r.ticker).join(",") + " pending the post-close grade pass)" : ""}`
    );
  } else {
    check("G", record.graded > 0 ? "GREEN" : "AMBER", "closed rows graded", `no closed rows on today's board; record has ${record.graded} graded row(s) in the ${record.window?.days ?? "?"}-day window`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────────────
let userId = null;
async function main() {
  if (!QUIET) console.log(`\n0DTE Night Hawk E2E healthcheck → ${APP}  (FAPI ${FAPI}, Polygon ${PB})\n  stages: ${STAGES.join(",")}\n`);

  // Stage A runs BEFORE auth — it's pure AWS, no Clerk session needed.
  if (wantStage("A")) await stageA_infra();

  // Everything else needs an authenticated prod session.
  const needsAuth = STAGES.some((s) => s !== "A");
  if (needsAuth) {
    // --- mint temp admin+premium user (self-heal a leftover) ---
    // Both Clerk identifier collisions are handled by the shared helper: e-mail taken →
    // adopt the leftover user; PHONE taken → redraw a fresh +1415555XXXX and retry (a phone
    // clash used to abort the run, reporting a recoverable clash as a RED gate).
    const auth = await createOrAdoptAuditUserViaCurl({ curl, api: API, secret: SECRET, email: EMAIL, phone: PHONE });
    if (auth.error) {
      ensureStage("B", "DISCOVERY ×3");
      forceStage("B", "RED", `auth: could not create/adopt temp user — ${auth.error.slice(0, 180)}`);
      return;
    }
    userId = auth.userId;

    // --- establish session (sign_in_token → ticket exchange → __session) ---
    let tok = null, sid = null, clientUat = 0;
    const mint = () => {
      tok = sid
        ? J(curl({ method: "POST", url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" }, jar: true, saveJar: true }))?.jwt
        : null;
      return tok;
    };
    const establish = () => {
      const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
      if (!ticket) return false;
      const si = curl({ method: "POST", url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: APP, Referer: `${APP}/`, "Content-Type": "application/x-www-form-urlencoded" }, form: { strategy: "ticket" }, urlencodeForm: { ticket }, saveJar: true, jar: true });
      const newSid = J(si)?.response?.created_session_id;
      if (!newSid) return false;
      sid = newSid;
      clientUat = Math.floor(Date.now() / 1000);
      return !!mint();
    };
    if (!establish()) {
      ensureStage("B", "DISCOVERY ×3");
      forceStage("B", "RED", "auth: FAPI ticket exchange failed — could not establish session");
      return;
    }
    const app = (path) => {
      for (let i = 0; i < 2; i++) {
        if (!tok && !establish()) return null;
        const r = curl({ url: `${APP}${path}`, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, Accept: "application/json" } });
        if (isAuthFailureStatus(r.s)) {
          tok = null;
          continue;
        }
        return J(r);
      }
      return null;
    };

    // Market status → RTH (governs staleness / mark cross-check strictness).
    rth = poly("/v1/marketstatus/now")?.market === "open";

    // --- shared prod reads (fetched once, used by B/C/D/E/F/G) ---
    board = app("/api/market/zerodte/board");
    if (wantStage("D")) marks = app("/api/market/zerodte/marks");
    if (wantStage("G")) record = app("/api/market/zerodte/record");

    if (wantStage("B")) stageB_discovery();
    if (wantStage("C")) stageC_commit();
    if (wantStage("D")) stageD_marks();
    if (wantStage("E")) stageE_exit();
    if (wantStage("F")) stageF_condor();
    if (wantStage("G")) stageG_grading();
  }
}

let exitCode = 0;
main()
  .catch((e) => {
    // A hard error means the run didn't complete — surface it as a RED on whatever stages ran.
    ensureStage("Z", "SCRIPT");
    forceStage("Z", "RED", `script error: ${String(e.message || e)}`);
  })
  .finally(() => {
    // ALWAYS delete the temp Clerk user + verify it's gone.
    if (userId) {
      const d = backend("DELETE", `/users/${userId}`);
      const v = backend("GET", `/users/${userId}`);
      if (!QUIET) console.log(`  [${v.s === 404 ? "GREEN" : "AMBER"}] cleanup: temp user deleted (DELETE ${d.s}, verify ${v.s})`);
    }
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {}

    // --- final matrix ---
    const ordered = [...ALL_STAGES, "Z"].filter((id) => stages.has(id));
    const matrix = ordered.map((id) => {
      const st = stages.get(id);
      const verdict = stageVerdict(st);
      const evidence =
        st.forced?.detail ??
        (st.checks.find((c) => c.verdict === verdict)?.detail ??
          st.checks.map((c) => c.label).slice(0, 2).join("; ") ??
          "");
      return { stage: id, name: st.name, verdict, evidence };
    });
    const rth_note = rth ? "RTH" : "off-hours";
    const anyStageRed = matrix.some((m) => m.verdict === "RED");
    exitCode = anyStageRed ? 1 : 0;

    if (JSON_OUT) {
      console.log(
        JSON.stringify(
          {
            generated_at: new Date().toISOString(),
            app: APP,
            market: rth_note,
            overall: anyStageRed ? "RED" : matrix.some((m) => m.verdict === "AMBER") ? "AMBER" : "GREEN",
            matrix: matrix.map((m) => ({
              ...m,
              checks: stages.get(m.stage).checks,
            })),
          },
          null,
          2
        )
      );
    } else {
      const icon = (v) => (v === "GREEN" ? "🟢" : v === "AMBER" ? "🟡" : v === "RED" ? "🔴" : "⚪");
      console.log(`\n═══ 0DTE NIGHT HAWK — E2E HEALTH MATRIX (${rth_note}) ═══`);
      for (const m of matrix) {
        console.log(`  ${icon(m.verdict)} ${m.stage}  ${m.name.padEnd(16)} ${m.verdict.padEnd(8)} ${(m.evidence || "").slice(0, 130)}`);
      }
      console.log(`\n  OVERALL: ${anyStageRed ? "🔴 RED (a subsystem is broken — do NOT trust the board pre-open)" : matrix.some((m) => m.verdict === "AMBER") ? "🟡 AMBER (live, with indeterminate/empty stages — read the reasons)" : "🟢 GREEN (every subsystem live, producing, tracking, grading)"}\n`);
    }
    process.exit(exitCode);
  });
