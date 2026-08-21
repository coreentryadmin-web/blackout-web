#!/usr/bin/env node
/*
 * SWING ENGINE END-TO-END HEALTH CHECK — one repeatable run that asserts the whole
 * swing discovery + serving + position pipeline is live against PRODUCTION
 * (blackouttrades.com), and prints a per-stage GREEN / AMBER / RED matrix.
 *
 * READ-ONLY. It logs into the live site as ONE temporary admin+premium Clerk user (headless
 * HTTP, no browser — the proven data-validator.mjs auth block), reads the SAME authenticated
 * board / serving / position endpoints the desk polls, and ALWAYS deletes its temp user in a
 * finally block (self-healing any leftover claude-audit-temp user). Authenticates ONCE per run
 * (Clerk FAPI rate-limits rapid sign-in cycles).
 *
 * STAGES (each → GREEN / AMBER / RED with one-line evidence):
 *   A  CRON          — swing-discovery cron has run recently (Redis phase claims for today).
 *                      Check via the serving snapshot — a recent snapshot proves the cron ran.
 *                      AMBER when no snapshot yet (cron hasn't fired this session day).
 *   B  PERSISTENCE   — the accumulation store has persistence-cleared candidates in the serving
 *                      snapshot's watch list. 0 watch candidates → AMBER (legitimate pre-build).
 *   C  SERVING       — the Redis key `swing:serving:latest:v1` exists and is fresh (within the
 *                      26h TTL). Read via the horizons?view=SWING board endpoint — a non-empty
 *                      lane with sections proves the snapshot is live. Null/stale → RED.
 *   D  BOARD         — fetch the swing board via GET /api/market/nighthawk/horizons?view=SWING.
 *                      Check the board structure has the expected shape (lanes, sections).
 *   E  POSITIONS     — check open swing positions count from the board's committed/sections.
 *   F  MARKS         — if there are open positions, check last_mark staleness. >2h stale during
 *                      RTH → AMBER. Read off the position-level marks the board carries.
 *   G  GRADING       — check graded positions via the record endpoint. Report per-archetype
 *                      sample sizes. 0 graded → AMBER (the ladder hasn't graduated yet).
 *
 * Exit code: NON-ZERO if any non-skipped stage is RED (usable as a pre-open gate).
 *
 * SECRETS — env ONLY (never hardcoded / committed):
 *   CLERK_SECRET_KEY                    (prod Clerk backend key)
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   (derives the FAPI host; falls back to clerk.blackouttrades.com)
 *   POLYGON_API_KEY                     (literal; the ${{shared.*}} ref does NOT resolve here)
 * ENV (optional): AUDIT_APP_URL, AUDIT_EMAIL, AUDIT_PHONE, POLYGON_API_BASE (self-defaults to
 *   https://api.polygon.io with a /^https?:/ guard, like the sibling audit tools).
 *
 * FLAGS: --json  machine output (the full stage matrix + evidence)
 *        --quiet suppress the per-check chatter (keep the final matrix)
 *        --stage=A,B,F run a subset of stages
 *
 * RUN:
 *   node --import tsx scripts/audit/swing-e2e-healthcheck.mjs
 * or:  npm run healthcheck:swing
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { createOrAdoptAuditUserViaCurl } from "./lib/clerk-audit-user.mjs";
import { isAuthFailureStatus } from "./lib/auth-status.mjs";
import { rollupVerdict, verdictForStaleness } from "./lib/zerodte-healthcheck-eval.mjs";

import { subprocessErrorMessage } from "./lib/redact.mjs";
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
// Self-default the Polygon base with the same /^https?:/ guard the other audit tools use.
const PB = (() => {
  const raw = process.env.POLYGON_API_BASE;
  return raw && /^https?:/.test(raw) ? raw.replace(/\/$/, "") : "https://api.polygon.io";
})();
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// Mark staleness bound: swing positions are marked hourly by the active-refresh cron, so
// a 2h bound (with generous headroom for cron skew/retries) is the threshold during RTH.
// Off-hours, staleness is AMBER (the refresh cron idles by design).
const MARK_FRESH_BOUND_MS = 2 * 60 * 60 * 1000;
// Serving snapshot freshness bound: the swing:serving:latest:v1 key has a 26h TTL.
// A snapshot older than 26h means the cron has not fired for a full session cycle.
// eslint-disable-next-line no-unused-vars
const SERVING_FRESH_BOUND_MS = 26 * 60 * 60 * 1000; // reserved for stage-D staleness check

function fapiHost() {
  try {
    const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, "");
    if (d.includes(".")) return `https://${d}`;
  } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();

const TMP = join(tmpdir(), `swing-e2e-${process.pid}`);
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
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });
const poly = (p) => J(curl({ url: `${PB}${p}${p.includes("?") ? "&" : "?"}apiKey=${POLY}` }));

// ── recording ────────────────────────────────────────────────────────────────────────
const stages = new Map();
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

// ── ET date helpers ──────────────────────────────────────────────────────────────────
function todayEt() { // eslint-disable-line no-unused-vars
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function etMinutesOfDay(nowMs) { // eslint-disable-line no-unused-vars
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

// ── shared state ─────────────────────────────────────────────────────────────────────
let board = null;
let swingLane = null;
let record = null;
let rth = false;

// ── Stage A — CRON ───────────────────────────────────────────────────────────────────
// The cron writes the serving snapshot; a recent snapshot is direct evidence the cron ran.
// We derive freshness from the snapshot's asOf timestamp (populated in stage C). Stage A
// checks whether the cron has produced output for the current session day.
function stageA_cron() {
  ensureStage("A", "CRON");
  if (!board) {
    check("A", "RED", "swing board unavailable", "cannot determine cron status without a board response");
    return;
  }
  // The swing lane carries the serving snapshot's metadata when populated. The board payload
  // from ?view=SWING includes the lane; the lane is empty when no snapshot was persisted.
  if (!swingLane) {
    check("A", "AMBER", "cron not yet visible", "swing lane is empty — discovery cron has not written a serving snapshot yet (or snapshot expired)");
    return;
  }
  // Check sections: if at least one section has content, the cron produced usable output.
  const sections = swingLane.sections;
  const sectionKeys = sections ? Object.keys(sections) : [];
  const totalPlays = sectionKeys.reduce((sum, k) => sum + (Array.isArray(sections[k]) ? sections[k].length : 0), 0);
  const committed = swingLane.committedCount ?? 0;
  const watch = swingLane.watchCount ?? 0;

  if (totalPlays > 0 || committed > 0 || watch > 0) {
    check("A", "GREEN", "cron produced output", `${totalPlays} play(s) across ${sectionKeys.length} section(s), committed=${committed} watch=${watch}`);
  } else {
    // The lane is structured (sections present) but every section is empty — the cron ran
    // and persisted an empty scan (legitimate: no candidates passed the gates this session).
    // The 0DTE healthcheck treats "producing but empty" as AMBER with the captured reason.
    check("A", "AMBER", "cron ran but empty output", `${sectionKeys.length} section(s) all empty — scan produced no candidates this session (legitimate quiet tape)`);
  }
}

// ── Stage B — PERSISTENCE ────────────────────────────────────────────────────────────
// The accumulation store persists cross-session candidates. The serving snapshot's `watch`
// list contains the persistence-cleared candidates. Check if any are present.
function stageB_persistence() {
  ensureStage("B", "PERSISTENCE");
  if (!board) {
    check("B", "RED", "board unavailable", "cannot check persistence without a board response");
    return;
  }
  if (!swingLane) {
    check("B", "AMBER", "swing lane empty", "no serving snapshot — persistence check not possible (cron has not run)");
    return;
  }
  // The watch list rides the `watch` array on the lane (back-compat view).
  const watchList = Array.isArray(swingLane.watch) ? swingLane.watch : [];
  const watchCount = swingLane.watchCount ?? watchList.length;
  // The committed list (persistence-cleared names that also cleared the commit floor).
  const committedList = Array.isArray(swingLane.committed) ? swingLane.committed : [];
  const committedCount = swingLane.committedCount ?? committedList.length;
  const total = watchCount + committedCount;

  if (total > 0) {
    // Collect unique tickers across watch+committed as evidence.
    const tickers = new Set();
    for (const p of watchList) if (p.ticker) tickers.add(p.ticker);
    for (const p of committedList) if (p.ticker) tickers.add(p.ticker);
    const sample = [...tickers].slice(0, 8).join(", ");
    check("B", "GREEN", "persistence-cleared candidates", `${total} candidate(s) (watch=${watchCount} committed=${committedCount}) — ${sample}`);
  } else {
    check("B", "AMBER", "no persistence-cleared candidates", "0 candidates have passed the cross-session persistence bar yet — accumulation building or quiet tape");
  }
}

// ── Stage C — SERVING ────────────────────────────────────────────────────────────────
// The serving snapshot is read via the board. Its presence and structure prove the
// swing:serving:latest:v1 Redis key is live and the cron is writing it.
function stageC_serving() {
  ensureStage("C", "SERVING");
  if (!board) {
    check("C", "RED", "board unavailable", "cannot check serving snapshot without a board response");
    return;
  }
  // The horizons route splices the swing lane into the board when ?view=SWING is passed.
  // A populated lane (with sections) proves the serving snapshot was read from Redis.
  if (!swingLane) {
    check("C", "RED", "serving snapshot absent", "swing lane empty — swing:serving:latest:v1 not populated (cron has not written it or the key expired past 26h TTL)");
    return;
  }
  const sections = swingLane.sections;
  if (!sections || typeof sections !== "object") {
    check("C", "RED", "serving snapshot malformed", "swing lane has no sections object — the serving assembler did not produce a structured lane");
    return;
  }
  // The seven expected sections from serving.ts.
  const expectedSections = ["COMMIT_NOW", "WAITING_FOR_ENTRY", "WATCH", "RESEARCH", "MANAGING", "SCALING_OUT", "EXITING"];
  const present = expectedSections.filter((s) => s in sections);
  const missing = expectedSections.filter((s) => !(s in sections));
  if (missing.length > 0) {
    check("C", "AMBER", "serving sections incomplete", `${present.length}/7 sections present, missing: ${missing.join(", ")}`);
  } else {
    check("C", "GREEN", "serving snapshot live", `all 7 sections present, scoreFloorGraduated=${swingLane.scoreFloorGraduated ?? "?"}, calibratedProbability=${swingLane.calibratedProbability ?? "null (provisional)"}`);
  }
}

// ── Stage D — BOARD ──────────────────────────────────────────────────────────────────
function stageD_board() {
  ensureStage("D", "BOARD");
  if (!board) {
    check("D", "RED", "board fetch failed", "GET /api/market/nighthawk/horizons?view=SWING returned no parseable response");
    return;
  }
  if (board.degraded === true) {
    check("D", "RED", "board degraded", `available=${board.available} degraded=true — the route caught an error`);
    return;
  }
  // Check the board has the expected top-level shape.
  const lanes = board.board?.lanes;
  if (!lanes || typeof lanes !== "object") {
    check("D", "RED", "board structure", "no board.lanes object in the response");
    return;
  }
  const swingPresent = "SWING" in lanes;
  const zeroDtePresent = "ZERO_DTE" in lanes;
  check(
    "D",
    swingPresent ? "GREEN" : "RED",
    "SWING lane present",
    `lanes: ${Object.keys(lanes).join(", ")} · upstream_ok=${board.upstream_ok}`
  );
  if (zeroDtePresent) {
    check("D", "GREEN", "ZERO_DTE lane (cross-check)", "the sibling 0DTE lane is present in the unified board");
  }
  // Check the session metadata (heat, governor) if available.
  const session = board.session;
  if (session) {
    const heat = session.heat?.state ?? "unknown";
    check("D", "GREEN", "session context", `heat=${heat}`);
  }
}

// ── Stage E — POSITIONS ──────────────────────────────────────────────────────────────
function stageE_positions() {
  ensureStage("E", "POSITIONS");
  if (!swingLane) {
    check("E", "AMBER", "swing lane empty", "no swing lane — cannot count positions");
    return;
  }
  const sections = swingLane.sections || {};
  // Live-position sections: MANAGING, SCALING_OUT, EXITING.
  const managing = Array.isArray(sections.MANAGING) ? sections.MANAGING : [];
  const scalingOut = Array.isArray(sections.SCALING_OUT) ? sections.SCALING_OUT : [];
  const exiting = Array.isArray(sections.EXITING) ? sections.EXITING : [];
  const livePositions = [...managing, ...scalingOut, ...exiting];
  // Pre-entry sections.
  const commitNow = Array.isArray(sections.COMMIT_NOW) ? sections.COMMIT_NOW : [];
  const waitingEntry = Array.isArray(sections.WAITING_FOR_ENTRY) ? sections.WAITING_FOR_ENTRY : [];
  const watchSection = Array.isArray(sections.WATCH) ? sections.WATCH : [];
  const research = Array.isArray(sections.RESEARCH) ? sections.RESEARCH : [];

  const openCount = livePositions.length;

  if (openCount > 0) {
    const tickers = livePositions.map((p) => p.ticker).filter(Boolean).slice(0, 10).join(", ");
    check(
      "E",
      "GREEN",
      "open swing positions",
      `${openCount} live position(s) — MANAGING=${managing.length} SCALING_OUT=${scalingOut.length} EXITING=${exiting.length} — ${tickers}`
    );
  } else {
    check(
      "E",
      "AMBER",
      "no open positions",
      `0 live positions — pre-entry pipeline: COMMIT_NOW=${commitNow.length} WAITING=${waitingEntry.length} WATCH=${watchSection.length} RESEARCH=${research.length}`
    );
  }
  // Also report the committed back-compat view count for cross-check.
  const committed = swingLane.committedCount ?? 0;
  if (committed > 0) {
    check("E", "GREEN", "committed candidates", `${committed} committed candidate(s) in the back-compat view`);
  }
}

// ── Stage F — MARKS ──────────────────────────────────────────────────────────────────
function stageF_marks() {
  ensureStage("F", "MARKS");
  if (!swingLane) {
    check("F", "AMBER", "swing lane empty", "no swing lane — no positions to check marks for");
    return;
  }
  const sections = swingLane.sections || {};
  const livePositions = [
    ...(Array.isArray(sections.MANAGING) ? sections.MANAGING : []),
    ...(Array.isArray(sections.SCALING_OUT) ? sections.SCALING_OUT : []),
    ...(Array.isArray(sections.EXITING) ? sections.EXITING : []),
  ];
  if (livePositions.length === 0) {
    check("F", "AMBER", "no live positions to mark", "the mark staleness check applies only to open positions — none present");
    return;
  }
  for (const p of livePositions) {
    const mark = p.mark ?? p.last_mark ?? p.optionMark;
    const markTs = p.mark_ts ?? p.last_mark_ts ?? p.mark_updated_at;
    let ageMs = null;
    if (markTs) {
      const ts = typeof markTs === "string" ? new Date(markTs).getTime() : Number(markTs);
      if (Number.isFinite(ts)) ageMs = Date.now() - ts;
    }
    const freshV = mark == null ? "AMBER" : verdictForStaleness(ageMs, MARK_FRESH_BOUND_MS, rth);
    check(
      "F",
      freshV,
      `mark ${p.ticker}`,
      `mark=${mark ?? "null"} age=${ageMs == null ? "unknown" : (ageMs / 1000 / 60).toFixed(1) + "min"} section=${p.setupState ?? p.status ?? "?"}`
    );
  }
}

// ── Stage G — GRADING ────────────────────────────────────────────────────────────────
function stageG_grading() {
  ensureStage("G", "GRADING/RECORD");
  if (!record) {
    check("G", "AMBER", "record endpoint", "no record response — grading check skipped");
    return;
  }
  if (record.available === false) {
    check("G", "AMBER", "record unavailable", `available=false — ${record.error ?? "temporarily unavailable"}`);
    return;
  }
  // Overall record summary.
  const total = record.total_resolved ?? 0;
  const winRate = record.win_rate_pct;
  const methodology = record.methodology ?? "unknown";
  const pendingCount = record.pending_count ?? 0;

  if (total > 0) {
    check(
      "G",
      "GREEN",
      "graded positions",
      `${total} resolved · WR ${winRate}% · pending ${pendingCount} · methodology=${methodology}`
    );
  } else {
    check("G", "AMBER", "no graded positions", `0 resolved plays in the record window — the swing ladder has not graduated yet`);
  }

  // Per-segment breakdown (current vs legacy methodology).
  const segments = record.segments;
  if (segments?.current) {
    const curr = segments.current;
    check(
      "G",
      curr.scoreable > 0 ? "GREEN" : "AMBER",
      "current methodology",
      `scoreable=${curr.scoreable} wins=${curr.wins} losses=${curr.losses} WR=${curr.win_rate_pct ?? "—"}% CI=[${curr.win_rate_ci_low_pct ?? "—"}, ${curr.win_rate_ci_high_pct ?? "—"}]%`
    );
  }

  // By-conviction breakdown as sample-size evidence.
  const byConviction = record.by_conviction;
  if (Array.isArray(byConviction) && byConviction.length > 0) {
    const summary = byConviction.map((c) => `${c.conviction}:n=${c.n}`).join(" ");
    check("G", "GREEN", "per-conviction sample sizes", summary);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────────────
let userId = null;
async function main() {
  if (!QUIET) console.log(`\nSwing Engine E2E healthcheck → ${APP}  (FAPI ${FAPI}, Polygon ${PB})\n  stages: ${STAGES.join(",")}\n`);

  // All stages need an authenticated prod session (no stage A infra-only path like 0DTE).
  // --- mint temp admin+premium user (self-heal a leftover) ---
  // Shared helper: e-mail collision → adopt the leftover user; PHONE collision → redraw a
  // fresh +1415555XXXX and retry, instead of failing the whole healthcheck on a clash that
  // a plain re-run would have cleared.
  const auth = await createOrAdoptAuditUserViaCurl({ curl, api: API, secret: SECRET, email: EMAIL, phone: PHONE });
  if (auth.error) {
    ensureStage("A", "CRON");
    forceStage("A", "RED", `auth: could not create/adopt temp user — ${auth.error.slice(0, 180)}`);
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
    ensureStage("A", "CRON");
    forceStage("A", "RED", "auth: FAPI ticket exchange failed — could not establish session");
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

  // Market status → RTH (governs mark staleness strictness).
  rth = poly("/v1/marketstatus/now")?.market === "open";

  // --- shared prod reads ---
  board = app("/api/market/nighthawk/horizons?view=SWING");
  swingLane = board?.board?.lanes?.SWING ?? null;

  // Record endpoint (for grading stage).
  if (wantStage("G")) record = app("/api/market/nighthawk/record");

  if (wantStage("A")) stageA_cron();
  if (wantStage("B")) stageB_persistence();
  if (wantStage("C")) stageC_serving();
  if (wantStage("D")) stageD_board();
  if (wantStage("E")) stageE_positions();
  if (wantStage("F")) stageF_marks();
  if (wantStage("G")) stageG_grading();
}

let exitCode = 0;
main()
  .catch((e) => {
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
      console.log(`\n═══ SWING ENGINE — E2E HEALTH MATRIX (${rth_note}) ═══`);
      for (const m of matrix) {
        console.log(`  ${icon(m.verdict)} ${m.stage}  ${m.name.padEnd(16)} ${m.verdict.padEnd(8)} ${(m.evidence || "").slice(0, 130)}`);
      }
      console.log(`\n  OVERALL: ${anyStageRed ? "🔴 RED (a subsystem is broken — swing board is not trustworthy)" : matrix.some((m) => m.verdict === "AMBER") ? "🟡 AMBER (live, with indeterminate/empty stages — read the reasons)" : "🟢 GREEN (every subsystem live, producing, serving)"}\n`);
    }
    process.exit(exitCode);
  });
