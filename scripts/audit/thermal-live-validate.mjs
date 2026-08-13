/**
 * THERMAL LIVE VALIDATION — sector presets + refresh cadence, against PROD during RTH.
 *
 * Answers two questions the desk actually cares about:
 *   (A) CADENCE — does gamma/% really move on the ~5s matrix TTL, measured END-TO-END rather than
 *       read off a config constant. `gexHeatmapCacheMs()` returning 5000 proves what the code
 *       INTENDS; only sampling the served payload proves what a member gets.
 *   (B) SECTORS — every ticker in every compare-grid preset serves a real matrix AND its UW
 *       overlays. A preset whose names render an empty column is the failure this catches.
 *
 * Read-only. ONE Clerk session for the whole run, released in a finally.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/thermal-live-validate.mjs [--seconds=90] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { THERMAL_COMPARE_PRESETS } from "../../src/features/thermal/lib/thermal-compare-presets.ts";

const args = process.argv.slice(2);
const flag = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const asJson = args.includes("--json");
const BASE = flag("base", "https://blackouttrades.com");
const SECONDS = Number(flag("seconds", "90"));
const CADENCE_TICKER = flag("ticker", "SPY");

const out = { cadence: null, sectors: [], verdict: "" };
const log = (...a) => { if (!asJson) console.log(...a); };

/**
 * Session holder that re-mints before the token dies.
 *
 * MEASURED (lib/ui-session-keepalive.mjs): the minted `__session` JWT is dead ~72s after issue and
 * traffic does NOT extend it — a fixed lifetime. A run that walks 51 tickers outlives one token, so
 * without this every ticker past ~72s returns 401. That is not a cosmetic bug: the first version of
 * this script reported Crypto/Energy/Financials/Healthcare as four BROKEN presets when the only
 * thing broken was its own credential. An auth failure must never be scoreable as a product defect.
 */
function sessionHolder(session) {
  let cookie = session.cookieHeader;
  let mintedAt = Date.now();
  return {
    get: async () => {
      if (Date.now() - mintedAt > 45_000 && typeof session.refresh === "function") {
        const next = await session.refresh().catch(() => null);
        if (next?.cookieHeader) { cookie = next.cookieHeader; mintedAt = Date.now(); }
      }
      return cookie;
    },
    force: async () => {
      const next = await session.refresh?.().catch(() => null);
      if (next?.cookieHeader) { cookie = next.cookieHeader; mintedAt = Date.now(); return true; }
      return false;
    },
  };
}

/** `__auth` marks a HARNESS credential failure — callers must not score it as a ticker defect. */
async function getJson(path, sess) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: await sess.get() } });
    if (r.ok) return r.json();
    if (r.status === 401 || r.status === 403) {
      if (attempt === 0 && (await sess.force())) continue;
      return { __auth: r.status };
    }
    return { __status: r.status };
  }
  return { __auth: 401 };
}

/** (A) Sample the SERVED payload once a second and measure when values actually change. */
async function measureCadence(sess) {
  log(`\n═══ A. CADENCE — ${CADENCE_TICKER}, sampling 1/s for ${SECONDS}s`);
  const samples = [];
  let authFails = 0;
  for (let i = 0; i < SECONDS; i++) {
    const t = Date.now();
    const j = await getJson(`/api/market/gex-heatmap?ticker=${CADENCE_TICKER}`, sess);
    if (j.__auth) { authFails++; }
    else if (!j.__status) samples.push({ t, asof: j.asof, spot: j.spot, chg: j.change_pct, gex: j.gex?.total });
    const spent = Date.now() - t;
    await new Promise((r) => setTimeout(r, Math.max(0, 1000 - spent)));
  }
  // Gaps between DISTINCT values = the real refresh period. Counting distinct values alone would
  // conflate "updates every 5s" with "updated twice in 90s", so measure the intervals.
  const intervals = (key) => {
    const gaps = []; let last = null, lastT = null;
    for (const s of samples) {
      const v = s[key];
      if (v == null) continue;
      if (last !== null && v !== last && lastT !== null) gaps.push((s.t - lastT) / 1000);
      if (last === null || v !== last) { last = v; lastT = s.t; }
    }
    return gaps;
  };
  const stat = (g) => g.length ? { changes: g.length, median: +g.sort((a,b)=>a-b)[Math.floor(g.length/2)].toFixed(1),
      min: +Math.min(...g).toFixed(1), max: +Math.max(...g).toFixed(1) } : { changes: 0 };
  const res = { samples: samples.length, authFails, gex: stat(intervals("gex")), spot: stat(intervals("spot")),
                chg: stat(intervals("chg")), asof: stat(intervals("asof")) };
  out.cadence = res;
  for (const k of ["asof", "spot", "gex", "chg"]) {
    const s = res[k];
    log(`  ${k.padEnd(5)} changes=${String(s.changes).padStart(3)}  median=${s.median ?? "-"}s  min=${s.min ?? "-"}s  max=${s.max ?? "-"}s`);
  }
  return res;
}

/** (B) Every preset ticker must serve a matrix AND overlays. */
async function checkSectors(sess) {
  log(`\n═══ B. SECTORS — ${THERMAL_COMPARE_PRESETS.length} presets`);
  for (const p of THERMAL_COMPARE_PRESETS) {
    const rows = [];
    for (const tk of p.tickers) {
      const j = await getJson(`/api/market/gex-heatmap?ticker=${encodeURIComponent(tk)}`, sess);
      // A credential failure says nothing about the ticker — bucket it separately so it can never
      // be counted as a broken preset.
      if (j.__auth) { rows.push({ tk, ok: false, auth: true, why: `auth ${j.__auth}` }); continue; }
      if (j.__status) { rows.push({ tk, ok: false, why: `HTTP ${j.__status}` }); continue; }
      const cells = j.gex?.cells ? Object.keys(j.gex.cells).length : 0;
      const strikes = Array.isArray(j.strikes) ? j.strikes.length : 0;
      const ok = j.available !== false && Number.isFinite(j.spot) && j.spot > 0 && Number.isFinite(j.gex?.total) && strikes > 0;
      rows.push({ tk, ok, spot: j.spot, gex: j.gex?.total, strikes, cells,
                  overlays: j.overlays ? Object.keys(j.overlays).length : 0, chg: j.change_pct });
      await new Promise((r) => setTimeout(r, 350)); // stay under the 2 RPS UW cluster budget
    }
    const authBad = rows.filter((r) => r.auth);
    const bad = rows.filter((r) => !r.ok && !r.auth);
    const noOverlay = rows.filter((r) => r.ok && !r.overlays);
    out.sectors.push({ id: p.id, label: p.label, rows, bad: bad.length, auth: authBad.length, noOverlay: noOverlay.length });
    const mark = bad.length ? "FAIL" : authBad.length ? "AUTH" : noOverlay.length ? "WARN" : "PASS";
    log(`  [${mark}] ${p.label.padEnd(12)} ${rows.map((r) => `${r.tk}${r.ok ? "" : "✗"}${r.ok && !r.overlays ? "°" : ""}`).join(" ")}`);
    if (bad.length) for (const b of bad) log(`         ✗ ${b.tk}: ${b.why ?? "no matrix"}`);
    if (authBad.length) log(`         ! harness auth failure on ${authBad.length} name(s) — NOT a product defect, re-run`);
    if (noOverlay.length) log(`         ° no UW overlays: ${noOverlay.map((r) => r.tk).join(", ")}`);
  }
}

async function main() {
  const s = await mintClerkPremiumSession({ appUrl: BASE });
  if (s.skip) { console.log(`SKIP — ${s.reason}`); process.exit(0); }
  try {
    const sess = sessionHolder(s);
    await checkSectors(sess);
    await measureCadence(sess);
  } finally { await s.cleanup?.(); log("\nsession released"); }

  const failed = out.sectors.filter((x) => x.bad > 0);
  const authed = out.sectors.filter((x) => x.auth > 0);
  const warned = out.sectors.filter((x) => x.bad === 0 && x.noOverlay > 0);
  const cadenceOk = (out.cadence?.gex?.changes ?? 0) > 0 || (out.cadence?.spot?.changes ?? 0) > 0;
  out.verdict = authed.length ? `INCONCLUSIVE — harness auth failed on ${authed.length} preset(s); re-run`
    : failed.length ? `${failed.length} preset(s) with a broken ticker`
    : !cadenceOk ? "sectors OK but NOTHING refreshed during the window"
    : warned.length ? `all presets serve data; ${warned.length} preset(s) have overlay-less names`
    : "ALL PRESETS OK + data refreshing";
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else console.log(`\n${"═".repeat(70)}\nVERDICT: ${out.verdict}`);
  process.exit(failed.length || authed.length || !cadenceOk ? 1 : 0);
}
main().catch((e) => { console.error("FATAL", String(e)); process.exit(2); });
