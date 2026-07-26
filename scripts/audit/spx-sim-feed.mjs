#!/usr/bin/env node
/*
 * ADMIN-ONLY SPX Slayer desk SIMULATION FEEDER (fix/spx-desk-sim).
 *
 * WHAT IT DOES
 *   Authenticates to production as a TEMPORARY admin Clerk user (mint sign_in_token → FAPI
 *   ticket exchange → __session cookie — the exact block used by scripts/audit/data-validator.mjs
 *   and scripts/audit/zerodte-sim-feed.mjs), then POSTs a stream of desk bundle frames to the
 *   admin-only ingest endpoint (POST /api/admin/spx/sim/desk) on a clock. An admin watching
 *   <base>/dashboard?sim=1 in a browser then sees a synthetic SPX session play through the REAL
 *   desk UI (Pulse rail, GEX matrix, pin forecast, sniper header, play state) — while every
 *   MEMBER keeps seeing the real, untouched desk (three-layer isolation: admin gate + separate
 *   Redis key `spx:desk:snapshot:sim:v1` + ?sim=1 opt-in; see src/lib/platform/spx-sim-desk.ts).
 *
 *   The temp admin user is ALWAYS deleted in a finally block.
 *
 * SOURCES
 *   --synthetic          Generate a full valid RTH arc: spot marching up through the gamma flip
 *                        (a gamma-flip cross), GEX walls building, pin drift + tightening, matrix
 *                        leaders, a couple of large sweeps, and one directional play running its
 *                        full lifecycle (SCANNING → WATCHING → armed BUY → OPEN/managed → CLOSED).
 *   --replay=<file.json> Replay a captured session: an array of { etMinute, payload } (payload = an
 *                        SpxSimDeskBundle). Frames post in etMinute order on the compressed clock.
 *
 * FLAGS
 *   --speed=N       ET-minutes advanced per real second (default 60 → a 5-min frame gap posts
 *                   every 5s; the whole RTH arc plays in ~6–7 min). Higher = faster.
 *   --base=URL      App base (default https://blackouttrades.com).
 *   --start-et=HH:MM / --end-et=HH:MM   Bound which frames are emitted (default full RTH).
 *   --dry-run       Print the frame schedule; auth is skipped; nothing is posted.
 *   --reset         Clear the sim key (DELETE) and exit — resets the sim desk to empty.
 *
 * SECRETS — from env ONLY (never printed / committed):
 *   CLERK_SECRET_KEY                    production Clerk backend key
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   derives the Frontend API host
 *
 * EXAMPLE
 *   npm run sim:spx -- --synthetic --base=https://blackouttrades.com
 *   npm run sim:spx -- --reset
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDefaultAuditPhone } from "./lib/audit-phone.mjs";
import { syntheticSpxFrames, isValidSpxSimBundle, fmtEt } from "./lib/spx-sim-frames.mjs";

// ── args ────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : dflt;
};
const SYNTHETIC = has("--synthetic");
const REPLAY = val("--replay", null);
const SPEED = Math.max(1, Number(val("--speed", "60")) || 60);
const BASE = val("--base", "https://blackouttrades.com").replace(/\/$/, "");
const DRY = has("--dry-run");
const RESET = has("--reset");
const START_ET = parseEt(val("--start-et", "09:30"));
const END_ET = parseEt(val("--end-et", "15:55"));

function parseEt(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ── secrets / http ────────────────────────────────────────────────────────────────
function req(name) {
  const v = process.env[name];
  if (!v || v.includes("${{")) { console.error(`FATAL: env ${name} is missing or an unresolved \${{...}} placeholder.`); process.exit(3); }
  return v;
}
const API = "https://api.clerk.com/v1";
const CJS = "5.57.0";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EMAIL = process.env.SIM_FEED_EMAIL || "claude-spxsimfeed-temp@blackouttrades.com";
const PHONE = process.env.SIM_FEED_PHONE || generateDefaultAuditPhone();

const TMP = join(tmpdir(), `bo-spxsimfeed-${process.pid}`);
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
  try { const s = Number(execFileSync("curl", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim()); return { s, b: existsSync(bf) ? readFileSync(bf, "utf8") : "" }; }
  catch (e) { return { s: 0, b: "", err: String(e.message || e).split("\n")[0] }; }
}
const J = (r) => { try { return JSON.parse(r.b); } catch { return null; } };
const SECRET = RESET || !DRY ? req("CLERK_SECRET_KEY") : (process.env.CLERK_SECRET_KEY || "");
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
function fapiHost() {
  try { const d = Buffer.from(PUB.replace(/^pk_(live|test)_/, ""), "base64").toString("utf8").replace(/\$$/, ""); if (d.includes(".")) return `https://${d}`; } catch {}
  return "https://clerk.blackouttrades.com";
}
const FAPI = fapiHost();
const backend = (m, p, j) => curl({ method: m, url: `${API}${p}`, headers: { Authorization: `Bearer ${SECRET}` }, json: j });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function replayFrames(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) throw new Error("replay file must be an array of { etMinute, payload }");
  return raw
    .filter((f) => f && Number.isFinite(f.etMinute) && f.payload && typeof f.payload === "object")
    .filter((f) => (START_ET == null || f.etMinute >= START_ET) && (END_ET == null || f.etMinute <= END_ET))
    .sort((a, b) => a.etMinute - b.etMinute);
}

// ── main ────────────────────────────────────────────────────────────────────────────
const WATCH_URL = `${BASE}/dashboard?sim=1`;
const INGEST = `${BASE}/api/admin/spx/sim/desk`;

let userId = null;
async function main() {
  if (!SYNTHETIC && !REPLAY && !RESET) {
    console.error("Nothing to do. Pass --synthetic, --replay=<file.json>, or --reset.");
    process.exit(2);
  }

  const frames = RESET ? [] : SYNTHETIC ? syntheticSpxFrames({ startEt: START_ET, endEt: END_ET }) : replayFrames(REPLAY);
  if (!RESET) {
    console.log(`\n▲ SPX DESK SIM FEEDER — ${SYNTHETIC ? "synthetic RTH arc" : `replay ${REPLAY}`}`);
    console.log(`  frames: ${frames.length}  speed: ${SPEED} ET-min/s  window: ${fmtEt(frames[0]?.etMinute ?? 0)}–${fmtEt(frames[frames.length - 1]?.etMinute ?? 0)} ET`);
    console.log(`\n  WATCH URL:  ${WATCH_URL}   (open as an ADMIN)\n`);
  }

  if (DRY && !RESET) {
    let invalid = 0;
    for (const f of frames) {
      const ok = isValidSpxSimBundle(f.payload);
      if (!ok) invalid++;
      const p = f.payload;
      console.log(`  ${fmtEt(f.etMinute)} ET  ${ok ? "✓" : "✗ INVALID"}  spot ${p.desk?.price}  play ${p.play?.action}  pin ${p.pin?.pin}  matrix ${p.gexHeatmap?.strikes?.length ?? 0} strikes`);
    }
    console.log(`\n[dry-run] no auth, nothing posted.  invalid frames: ${invalid}`);
    if (invalid > 0) process.exitCode = 1;
    return;
  }

  // --- auth (once) — mint temp admin user → FAPI ticket → __session cookie ---
  const create = backend("POST", "/users", { email_address: [EMAIL], phone_number: [PHONE], public_metadata: { role: "admin", tier: "premium" }, skip_password_requirement: true, skip_legal_checks: true });
  const cj = J(create);
  if (cj?.id) userId = cj.id;
  else if (/form_identifier_exists/.test(JSON.stringify(cj?.errors || ""))) {
    const u = (J(curl({ url: `${API}/users?email_address=${encodeURIComponent(EMAIL)}`, headers: { Authorization: `Bearer ${SECRET}` } })) || [])[0];
    if (u?.id) { userId = u.id; backend("PATCH", `/users/${userId}`, { public_metadata: { role: "admin", tier: "premium" } }); }
  }
  if (!userId) { console.error("auth: could not create/adopt temp admin user:", create.b.slice(0, 200)); process.exit(1); }

  let tok = null, sid = null, clientUat = 0;
  const mint = () => { tok = sid ? J(curl({ method: "POST", url: `${FAPI}/v1/client/sessions/${sid}/tokens?_clerk_js_version=${CJS}`, headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" }, jar: true, saveJar: true }))?.jwt : null; return tok; };
  const establishSession = () => {
    const ticket = J(backend("POST", "/sign_in_tokens", { user_id: userId }))?.token;
    if (!ticket) return false;
    const si = curl({ method: "POST", url: `${FAPI}/v1/client/sign_ins?_clerk_js_version=${CJS}`, headers: { Origin: BASE, Referer: `${BASE}/`, "Content-Type": "application/x-www-form-urlencoded" }, form: { strategy: "ticket" }, urlencodeForm: { ticket }, saveJar: true, jar: true });
    const newSid = J(si)?.response?.created_session_id;
    if (!newSid) return false;
    sid = newSid;
    clientUat = Math.floor(Date.now() / 1000);
    return !!mint();
  };
  if (!establishSession()) { console.error("auth: FAPI ticket exchange failed — could not establish session"); process.exit(1); }

  const postFrame = (payload) => {
    if (!tok) mint() || establishSession();
    return curl({ method: "POST", url: INGEST, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}`, "Content-Type": "application/json" }, json: payload });
  };
  const del = () => curl({ method: "DELETE", url: INGEST, headers: { Cookie: `__session=${tok}; __client_uat=${clientUat}` } });

  if (RESET) {
    const r = del();
    console.log(`\n▲ SPX DESK SIM RESET — DELETE ${INGEST} → HTTP ${r.s}`);
    console.log(`  ${(J(r) && JSON.stringify(J(r))) || r.b.slice(0, 160)}`);
    return;
  }

  // Clear any prior sim state so the arc starts clean.
  del();

  const FRAME_GAP_ET = 5; // synthetic frames are 5 ET-min apart; replay gaps come from etMinute deltas.
  let prevEt = frames[0]?.etMinute ?? 0;
  let ok = 0, fail = 0;
  for (const f of frames) {
    const gapEt = SYNTHETIC ? FRAME_GAP_ET : Math.max(0, f.etMinute - prevEt);
    prevEt = f.etMinute;
    const waitMs = Math.round((gapEt * 60 * 1000) / SPEED);
    if (waitMs > 0) await sleep(waitMs);

    if (!tok) mint() || establishSession();
    const r = postFrame(f.payload);
    if (r.s === 200) { ok++; const body = J(r) || {}; console.log(`  ${fmtEt(f.etMinute)} ET  ✓  spot ${f.payload.desk?.price} · ${f.payload.play?.action}  (ttl ${body.ttlSec ?? "?"}s)`); }
    else { fail++; console.log(`  ${fmtEt(f.etMinute)} ET  ✗  HTTP ${r.s}  ${r.b.slice(0, 120)}`); if (r.s === 401 || r.s === 403) { tok = null; establishSession(); } }
  }
  console.log(`\n▲ done — ${ok} frames posted, ${fail} failed.  Watch: ${WATCH_URL}`);
}

main()
  .catch((e) => { console.error("FATAL:", e?.message || e); process.exitCode = 1; })
  .finally(() => {
    // ALWAYS delete the temp admin user (cleanup), then wipe the temp cookie jar.
    try { if (userId) backend("DELETE", `/users/${userId}`); } catch {}
    try { rmSync(TMP, { recursive: true, force: true }); } catch {}
  });
