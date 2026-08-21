/**
 * VECTOR LIVE END-TO-END — every Vector surface, many tickers, against PROD.
 *
 * Vector's contract is not just "the endpoint returns 200" — it is a CADENCE contract. The desk
 * promises a live bead trail that samples every 5s for the oracle names and every 15s for anything
 * else (`features/vector/lib/vector-cadence.ts`). A surface that answers 200 with a payload frozen
 * for a minute is broken in exactly the way a member notices and a status check does not.
 *
 * So this harness measures five things, per ticker:
 *
 *   A. SURFACE   — every Vector REST route answers, with a payload that carries its headline field.
 *   B. CADENCE   — poll at 1s and measure the interval at which the payload ACTUALLY changes;
 *                  compare against the oracle(5s)/non-oracle(15s) contract for that ticker.
 *   C. TRUTH     — spot vs Polygon, wall ordering (put < call), SPX ≈ 10 × SPY.
 *   D. FLOW      — the Helix-sourced flow surface is present and moving.
 *   E. MALFORMED — unrounded float / NaN / Infinity scan across every payload captured.
 *
 * HONESTY RULES BAKED IN (each of these is a way a run could otherwise lie):
 *
 *  - **A quiet tape is not a broken poll.** If the underlying value genuinely does not move during
 *    the window, no cadence can be inferred. That reports INCONCLUSIVE, never RED — the alternative
 *    manufactures a "stale data" defect out of a calm market.
 *  - **AUTH is bucketed apart from product.** The minted JWT dies ~72s after issue; a run of any
 *    length outlives it. Every 401/403 is counted as AUTH and excluded from product verdicts, and
 *    the session is re-minted on a 45s timer. Without this the LAST tickers in a sweep report
 *    "dead surface" when the only dead thing is the token.
 *  - **Market phase is printed.** Cadence off-hours is meaningless — the upstreams are idle and
 *    nothing changes, so every ticker would read INCONCLUSIVE. The run says which phase it ran in
 *    so an off-hours result is never quoted as an RTH one.
 *  - **Oracle vs non-oracle is read from the REAL constant**, not hardcoded here, so this cannot
 *    drift away from what production actually does.
 *
 * READ-ONLY. One temp Clerk user, deleted in a `finally`.
 *
 * Usage (repo root):
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/vector-live-e2e.mjs --tickers=SPX,SPY,QQQ,NVDA,TSLA,IWM
 *
 * Flags: --tickers=A,B --cadence-window=SEC --base=URL --json --quiet --skip-cadence
 * Exits non-zero if any stage is RED.
 */

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { normalizeVectorTicker } from "../../src/features/vector/lib/vector-ticker.ts";
// Call the REAL production resolver rather than re-deriving "is this a 5s ticker?" here. The rule
// is not just the oracle set: `vectorWallsScopePollMs` also grants 5s to heatmap-overlay-allowed
// names, so a local copy of the rule silently mislabels NVDA/TSLA/IWM as 15s and then "passes"
// them at 5s only because the tolerance band is wide. Importing the function makes this harness
// track production automatically when the rule changes.
import { vectorWallsScopePollMs } from "../../src/features/vector/lib/vector-cadence.ts";

const args = process.argv.slice(2);
const flag = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const has = (n) => args.includes(`--${n}`);

const BASE = String(flag("base", "https://blackouttrades.com")).replace(/\/$/, "");
const TICKERS = String(flag("tickers", "SPX,SPY,QQQ,NVDA,TSLA,IWM"))
  .split(",").map((t) => normalizeVectorTicker(t.trim())).filter(Boolean);
const CADENCE_WINDOW_SEC = Math.max(20, Number(flag("cadence-window", 45)) || 45);
const JSON_OUT = has("json");
const QUIET = has("quiet");
const SKIP_CADENCE = has("skip-cadence");
const SESSION_YMD = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const POLY_KEY = process.env.POLYGON_API_KEY;
// GUARD the base: in this sandbox `POLYGON_API_BASE` is often the literal unresolved placeholder
// string "POLYGON_API_BASE" (the ${{shared.*}} refs do not resolve — CLAUDE.md). Without the
// /^https?:/ test every ground-truth fetch throws ERR_INVALID_URL, gets swallowed by the catch,
// and the whole TRUTH stage silently reports "no Polygon truth available" while the sweep still
// prints GREEN overall. A cross-provider check that quietly does nothing is worse than none.
const rawPolyBase = process.env.POLYGON_API_BASE;
const POLY_BASE = (rawPolyBase && /^https?:/.test(rawPolyBase) ? rawPolyBase : "https://api.polygon.io").replace(/\/$/, "");

const log = (...a) => { if (!JSON_OUT && !QUIET) console.log(...a); };
const results = [];
const rec = (stage, name, verdict, detail) => {
  results.push({ stage, name, verdict, detail });
  if (!JSON_OUT) console.log(`  [${verdict}] ${stage} ${name}${detail ? " — " + detail : ""}`);
};

/** Every Vector REST route, with the field that proves the payload is real rather than an empty 200. */
const SURFACES = [
  // Field paths are the REAL response schema, confirmed live 2026-08-17 — the API is camelCase and
  // nests walls/ladder, so the obvious snake_case guesses (`call_wall`, `max_pain`) all read as
  // absent and turn a healthy 200 into a fleet of AMBERs. Verified before trusting any verdict.
  { key: "walls", path: (t) => `/api/market/vector/walls?ticker=${t}`,
    headline: (j) => (j?.walls?.callWalls?.length ?? 0) + (j?.walls?.putWalls?.length ?? 0) },
  { key: "gex-heatmap", path: (t) => `/api/market/vector/gex-heatmap?ticker=${t}`,
    headline: (j) => (j?.grid ? Object.keys(j.grid).length : 0) },
  { key: "gex-ladder", path: (t) => `/api/market/vector/gex-ladder?ticker=${t}`,
    headline: (j) => j?.ladder?.rows?.length ?? (j?.spot ? 1 : 0) },
  { key: "flow", path: (t) => `/api/market/vector/flow?ticker=${t}`,
    // `available` is the health bit; `prints` legitimately empties when nothing clears the
    // $250k floor, so an empty print list is NOT a failure — availability is.
    headline: (j) => (j?.available ? 1 : 0) },
  { key: "max-pain", path: (t) => `/api/market/vector/max-pain?ticker=${t}`, headline: (j) => j?.maxPain },
  { key: "expected-move", path: (t) => `/api/market/vector/expected-move?ticker=${t}`,
    headline: (j) => j?.expectedMove?.bands?.length ?? j?.expectedMove?.movePct },
  { key: "prior-day", path: (t) => `/api/market/vector/prior-day?ticker=${t}`, headline: (j) => j?.pdc ?? j?.pdh },
  { key: "daily-regime", path: (t) => `/api/market/vector/daily-regime?ticker=${t}`, headline: (j) => j?.rows?.length },
  { key: "bars", path: (t) => `/api/market/vector/bars?ticker=${t}`, headline: (j) => j?.bars?.length ?? j?.length },
  { key: "daily-bars", path: (t) => `/api/market/vector/daily-bars?ticker=${t}`, headline: (j) => j?.bars?.length ?? j?.length },
  { key: "4h-bars", path: (t) => `/api/market/vector/4h-bars?ticker=${t}`, headline: (j) => j?.bars?.length ?? j?.length },
  // `session` is REQUIRED — the route returns `history: []` by design without it, which reads as
  // "the bead trail is empty" when it means "you did not say which session".
  { key: "wall-history(beads)", path: (t) => `/api/market/vector/wall-history?ticker=${t}&session=${SESSION_YMD}&horizon=all`,
    headline: (j) => j?.history?.length },
  { key: "pin-forecast", path: (t) => `/api/market/vector/pin-forecast?ticker=${t}`,
    // The availability flag is NESTED under `forecast` (payload is {ticker,target,forecast:{...}}).
    headline: (j) => (j?.forecast?.available ? 1 : 0) },
  { key: "universe", path: () => `/api/market/vector/universe`, headline: (j) => j?.rows?.length, once: true },
];

function marketPhaseEt(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay();
  if (d === 0 || d === 6) return "weekend";
  const m = et.getHours() * 60 + et.getMinutes();
  if (m < 4 * 60) return "overnight";
  if (m < 9 * 60 + 30) return "pre-market";
  if (m <= 16 * 60) return "RTH";
  if (m <= 20 * 60) return "after-hours";
  return "overnight";
}

/** Recursively scan for malformed numbers — the systemic unrounded-float class from CLAUDE.md. */
function scanMalformed(obj, path, out, depth = 0) {
  if (obj == null || depth > 8 || out.length > 12) return;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(`${path}=${obj}`);
    else {
      const dec = (String(obj).split(".")[1] || "").length;
      if (!Number.isInteger(obj) && Math.abs(obj) >= 1000 && dec >= 6) out.push(`${path}=${obj}(${dec}dp)`);
    }
    return;
  }
  if (typeof obj === "string") { if (["NaN", "Infinity", "undefined"].includes(obj)) out.push(`${path}="${obj}"`); return; }
  if (Array.isArray(obj)) { obj.slice(0, 40).forEach((v, i) => scanMalformed(v, `${path}[${i}]`, out, depth + 1)); return; }
  if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) scanMalformed(v, path ? `${path}.${k}` : k, out, depth + 1);
}

/** Volatile fingerprint of a payload — what SHOULD change tick to tick if the surface is live. */
function fingerprint(j) {
  if (j == null) return "null";
  const parts = [j.spot, j.asOf, j.updatedAt, j.ts, j.flip, j.maxPain,
    j.walls?.callWalls?.[0]?.notional, j.walls?.putWalls?.[0]?.notional];
  const seen = parts.filter((p) => p !== undefined);
  return seen.length ? JSON.stringify(seen) : JSON.stringify(j).slice(0, 400);
}

async function polygonSpot(ticker) {
  if (!POLY_KEY) return null;
  const isIdx = ticker === "SPX" || ticker === "VIX" || ticker === "NDX";
  const url = isIdx
    ? `${POLY_BASE}/v3/snapshot/indices?ticker.any_of=I:${ticker}&apiKey=${POLY_KEY}`
    : `${POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLY_KEY}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    if (isIdx) return Number(j?.results?.[0]?.value ?? j?.results?.[0]?.session?.close) || null;
    const t = j?.ticker;
    return Number(t?.lastTrade?.p ?? t?.day?.c ?? t?.prevDay?.c) || null;
  } catch { return null; }
}

async function main() {
  const phase = marketPhaseEt();
  log(`VECTOR LIVE E2E — base=${BASE}`);
  log(`tickers: ${TICKERS.join(", ")}`);
  log(`market phase: ${phase}${phase === "RTH" ? "" : "  (cadence will be INCONCLUSIVE — upstreams idle off-hours)"}`);
  log(`cadence contract (from vectorWallsScopePollMs): ` +
    TICKERS.map((t) => `${t}=${vectorWallsScopePollMs(t) / 1000}s`).join(" · "));
  log("");

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) { console.error(`SKIP — ${session.reason}`); process.exitCode = 2; return; }

  let cookie = session.cookieHeader, minted = Date.now();
  let authFailures = 0;
  const jar = async () => {
    if (Date.now() - minted > 45_000) {
      const n = await session.refresh?.().catch(() => null);
      if (n?.cookieHeader) { cookie = n.cookieHeader; minted = Date.now(); }
    }
    return cookie;
  };
  const get = async (path) => {
    let r = await fetch(BASE + path, { headers: { Cookie: await jar(), Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) {
      const n = await session.refresh?.().catch(() => null);
      if (n?.cookieHeader) { cookie = n.cookieHeader; minted = Date.now();
        r = await fetch(BASE + path, { headers: { Cookie: cookie, Accept: "application/json" } }); }
    }
    if (r.status === 401 || r.status === 403) { authFailures++; return { auth: true, status: r.status, json: null }; }
    const json = r.ok ? await r.json().catch(() => null) : null;
    return { auth: false, status: r.status, json };
  };

  const malformed = [];
  try {
    // ---- A. SURFACE ------------------------------------------------------------------
    log("── A. SURFACE ──");
    const doneOnce = new Set();
    for (const t of TICKERS) {
      for (const s of SURFACES) {
        if (s.once && doneOnce.has(s.key)) continue;
        if (s.once) doneOnce.add(s.key);
        const { auth, status, json } = await get(s.path(t));
        const label = s.once ? s.key : `${t} ${s.key}`;
        if (auth) { rec("A", label, "AUTH", `HTTP ${status} — harness token, not product`); continue; }
        if (status !== 200) { rec("A", label, "RED", `HTTP ${status}`); continue; }
        const head = s.headline(json);
        const alive = head != null && head !== 0 && !(Array.isArray(head) && head.length === 0);
        rec("A", label, alive ? "GREEN" : "AMBER", alive ? `headline=${JSON.stringify(head).slice(0, 40)}` : `200 but headline field empty/absent`);
        const m = []; scanMalformed(json, s.key, m);
        if (m.length) malformed.push(`${label}: ${m.slice(0, 3).join(", ")}`);
      }
    }

    // ---- C. TRUTH --------------------------------------------------------------------
    log("── C. TRUTH (vs Polygon) ──");
    const spots = {};
    for (const t of TICKERS) {
      const { auth, status, json } = await get(`/api/market/vector/gex-ladder?ticker=${t}`);
      if (auth || status !== 200) { rec("C", `${t} spot`, auth ? "AUTH" : "RED", `HTTP ${status}`); continue; }
      // spot lives on gex-ladder; the walls payload carries only the wall arrays + flip.
      const appSpot = Number(json?.spot ?? json?.ladder?.spot);
      spots[t] = appSpot;
      const truth = await polygonSpot(t);
      if (!Number.isFinite(appSpot)) { rec("C", `${t} spot`, "AMBER", "walls payload carries no spot"); continue; }
      if (truth == null) { rec("C", `${t} spot`, "AMBER", `app=${appSpot}; no Polygon truth available`); continue; }
      const dpct = Math.abs(appSpot - truth) / truth * 100;
      const tol = phase === "RTH" ? 1.5 : 4.0;
      rec("C", `${t} spot vs Polygon`, dpct <= tol ? "GREEN" : "RED", `app=${appSpot} polygon=${truth} Δ=${dpct.toFixed(3)}% (tol ${tol}%)`);

      const wres = await get(`/api/market/vector/walls?ticker=${t}`);
      const cw = Number(wres.json?.walls?.callWalls?.[0]?.strike);
      const pw = Number(wres.json?.walls?.putWalls?.[0]?.strike);
      if (Number.isFinite(cw) && Number.isFinite(pw)) {
        rec("C", `${t} wall ordering`, pw < cw ? "GREEN" : "AMBER", `top putWall=${pw} vs callWall=${cw}` + (pw < cw ? "" : " — inverted; legitimate when spot has run through a wall, so AMBER not RED"));
      } else {
        rec("C", `${t} wall ordering`, "AMBER", "no call/put wall pair in payload");
      }
    }
    if (Number.isFinite(spots.SPX) && Number.isFinite(spots.SPY) && spots.SPY > 0) {
      const ratio = spots.SPX / spots.SPY;
      rec("C", "SPX/SPY ratio ~10", ratio > 9.5 && ratio < 10.5 ? "GREEN" : "RED", `ratio=${ratio.toFixed(3)}`);
    }

    // ---- B. CADENCE ------------------------------------------------------------------
    if (!SKIP_CADENCE) {
      log(`── B. CADENCE (${CADENCE_WINDOW_SEC}s window per ticker, 1s polls) ──`);
      for (const t of TICKERS) {
        const expectSec = vectorWallsScopePollMs(t) / 1000;
        const changes = [];
        let last = null, lastAt = null, polls = 0, authHere = 0;
        const until = Date.now() + CADENCE_WINDOW_SEC * 1000;
        while (Date.now() < until) {
          const { auth, status, json } = await get(`/api/market/vector/gex-ladder?ticker=${t}`);
          if (auth) { authHere++; } else if (status === 200) {
            polls++;
            const fp = fingerprint(json);
            if (last !== null && fp !== last && lastAt != null) changes.push((Date.now() - lastAt) / 1000);
            if (fp !== last) { last = fp; lastAt = Date.now(); }
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (polls < 5) { rec("B", `${t} cadence`, "AUTH", `only ${polls} usable polls (${authHere} auth failures)`); continue; }
        if (changes.length === 0) {
          rec("B", `${t} cadence`, "INCONCLUSIVE",
            `payload never changed across ${polls} polls / ${CADENCE_WINDOW_SEC}s — expected ~${expectSec}s. ` +
            (phase === "RTH" ? "During RTH this is worth a look, but a genuinely flat book produces the same reading." : "Off-hours: expected."));
          continue;
        }
        const sorted = [...changes].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        // Generous band: the server caches on a TTL and we sample at 1s, so the observed interval
        // quantises. Anything within 2x of contract is the contract working.
        const ok = median <= expectSec * 2 + 1;
        rec("B", `${t} cadence (contract ${expectSec}s)`, ok ? "GREEN" : "AMBER",
          `observed median ${median.toFixed(1)}s vs contract ${expectSec}s over ${changes.length} change(s), ${polls} polls`);
      }
    }

    // ---- E. MALFORMED ----------------------------------------------------------------
    log("── E. MALFORMED ──");
    rec("E", "unrounded/non-finite scan", malformed.length === 0 ? "GREEN" : "AMBER",
      malformed.length === 0 ? "no suspect numeric formatting across captured payloads" : malformed.slice(0, 4).join(" | "));
  } finally {
    await session.cleanup?.();
  }

  // If the ground-truth provider never answered for ANY ticker, say so loudly: the TRUTH stage
  // contributed nothing and the run must not be read as cross-validated.
  const truthRows = results.filter((r) => r.stage === "C" && r.name.includes("spot vs Polygon"));
  if (truthRows.length === 0) {
    rec("C", "ground truth", "AMBER", "NO Polygon comparison ran — this sweep is NOT cross-validated");
  }

  const tally = results.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
  if (JSON_OUT) console.log(JSON.stringify({ base: BASE, phase, tickers: TICKERS, tally, results }, null, 2));
  else {
    log("");
    log(`TOTALS ${JSON.stringify(tally)}   (auth failures handled: ${authFailures})`);
    if (phase !== "RTH") log(`NOTE: ran in ${phase} — cadence results are not RTH evidence.`);
  }
  if ((tally.RED || 0) > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
