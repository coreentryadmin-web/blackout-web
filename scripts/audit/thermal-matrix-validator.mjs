#!/usr/bin/env node
/*
 * Thermal ("BlackOut Thermal", /heatmap) GEX/VEX/DEX/CHARM matrix data-correctness
 * validator — the Thermal analog of data-validator.mjs's GEX section, but going deep
 * on the actual matrix values Thermal's `GexHeatmap.tsx` / `ThermalCompactMatrix.tsx`
 * render, not just the top-level convenience fields `gex-positioning` exposes.
 *
 * WHY THIS EXISTS: `scripts/audit/data-validator.mjs` fetches `/api/market/gex-heatmap`
 * (`P.heatmap`) but never actually checks it — confirmed via grep, zero `P.heatmap`
 * references beyond the fetch itself. `scripts/validate-gex-parity.mjs` is a 5-strike
 * "are these numbers finite" smoke check with no wall/flip/max_pain recomputation, no
 * cell↔strike_totals reconciliation, no cross-provider spot check, and no VEX/DEX/CHARM
 * coverage. This script is the missing deep pass — analogous to the top-down Helix
 * data audit, scoped to Thermal's actual matrix data.
 *
 * WHAT IT CHECKS, per ticker, straight against the LIVE production endpoint:
 *   1. Spot price vs a fresh independent Polygon quote (stock or index snapshot).
 *   2. For every present metric block (gex, vex, dex, charm):
 *      a. total === sum(strike_totals) (server's own reconcileStrikeTotal invariant —
 *         should always hold; a live FAIL here means a code regression slipped past it).
 *      b. strike_totals independently re-derived by summing `cells[strike][expiry]`
 *         over `near_term_expiries` (the exact server algorithm, polygon-options-gex.ts
 *         buildMetric()) — verifies the matrix's own detail cells actually produce the
 *         summary numbers next to them, not two independently-drifting representations.
 *      c. call_wall/put_wall (gex) or pos_wall/neg_wall (vex) independently re-derived
 *         from strike_totals via the side-constrained rule (#2417): call wall must sit
 *         above spot, put wall below spot (wallsFromStrikeTotals in gex-cross-validation-core.ts).
 *      d. flip/zero_level independently re-derived with the EXACT ported algorithm the
 *         server uses (gex uses cumulativeGammaFlip; vex/dex/charm use zeroGammaFlip —
 *         these are DIFFERENT functions, ported faithfully from
 *         src/lib/providers/gex-cross-validation-core.ts) and compared to the server's
 *         reported value.
 *   3. max_pain lies within the served strike range (or null, never a stray value).
 *   4. near_term_expiries is a subset of expiries and both are ascending.
 *   5. Off-hours shift gate: outside ET cash RTH, shift/vex_shift/dex_shift/charm_shift
 *      must all read available:false (the 2026-07-25 fix, task #174 — re-verified live
 *      on every run, not just trusted once).
 *   6. cross_validation (UW cross-check), when present, is inspected for shape/finiteness
 *      (never fabricated) — informational, since UW's own numbers are a second opinion,
 *      not ground truth to FAIL against.
 *   7. Malformed-number scan across the whole payload (NaN/Infinity/unrounded-float noise).
 *
 * SECRETS — env only, never hardcoded/committed:
 *   CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, POLYGON_API_KEY
 * ENV (optional): AUDIT_APP_URL (default https://blackouttrades.com), POLYGON_API_BASE
 *   (self-defaults api.massive.com), AUDIT_EMAIL/AUDIT_PHONE (temp Clerk user).
 * FLAGS: --tickers=SPY,SPX,QQQ,IWM (default) --json --quiet
 *
 * ONE temp Clerk user per run, ALWAYS deleted (finally). Read-only against prod. Exits
 * non-zero if any check FAILs.
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const APP = process.env.AUDIT_APP_URL || "https://blackouttrades.com";
const POLY_KEY = process.env.POLYGON_API_KEY || "";
const POLY_BASE = (process.env.POLYGON_API_BASE || "https://api.massive.com").replace(/\/$/, "");
const POLY_FALLBACK = "https://api.polygon.io";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const TICKERS = (flag("tickers") || "SPY,SPX,QQQ,IWM").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const JSON_OUT = args.includes("--json");
const QUIET = args.includes("--quiet");

const checks = [];
function rec(name, status, detail) {
  checks.push({ name, status, detail });
  if (!QUIET) console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
}

function num(x) {
  return typeof x === "string" ? Number(x) : x;
}

function scanMalformed(obj, path, out) {
  if (obj == null) return;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(`${path}=${obj}(non-finite)`);
    else if (!Number.isInteger(obj) && Math.abs(obj) >= 1000 && (String(obj).split(".")[1] || "").length >= 6) {
      out.push(`${path}=${obj}(${(String(obj).split(".")[1] || "").length}dp)`);
    }
    return;
  }
  if (typeof obj === "string") {
    if (["NaN", "Infinity", "undefined"].includes(obj)) out.push(`${path}="${obj}"`);
    return;
  }
  if (Array.isArray(obj)) { obj.slice(0, 200).forEach((v, i) => scanMalformed(v, `${path}[${i}]`, out)); return; }
  if (typeof obj === "object") for (const [k, v] of Object.entries(obj)) scanMalformed(v, path ? `${path}.${k}` : k, out);
}

/* ── Faithful ports of src/lib/providers/gex-cross-validation-core.ts ──────────────
   These MUST mirror the server exactly — this validator's whole point is comparing
   the server's reported flip/zero_level against an independent recompute, so any
   drift here would silently defeat the check rather than catch a real bug. */

/** Per-strike sign-crossing nearest spot (used for vex.flip, dex/charm.zero_level). */
function zeroGammaFlip(strikeTotals, spot = 0) {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;

  const crossings = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if ((a.gamma < 0 && b.gamma > 0) || (a.gamma > 0 && b.gamma < 0)) {
      const frac = (0 - a.gamma) / (b.gamma - a.gamma);
      crossings.push(Number((a.strike + (b.strike - a.strike) * frac).toFixed(2)));
    }
  }
  if (crossings.length) {
    return spot > 0
      ? crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best))
      : crossings[crossings.length - 1];
  }

  const cum = [];
  let running = 0;
  for (const r of rows) { running += r.gamma; cum.push(running); }
  for (let i = 1; i < cum.length; i++) {
    const prevCum = cum[i - 1], curCum = cum[i];
    if ((prevCum < 0 && curCum > 0) || (prevCum > 0 && curCum < 0)) {
      const frac = (0 - prevCum) / (curCum - prevCum);
      return Number((rows[i - 1].strike + (rows[i].strike - rows[i - 1].strike) * frac).toFixed(2));
    }
  }
  return null;
}

/** Cumulative net-short→net-long crossing — lowest plausible within 12% of spot (gex.flip). */
function cumulativeGammaFlip(strikeTotals, spot = 0) {
  const rows = Object.entries(strikeTotals)
    .map(([s, g]) => ({ strike: Number(s), gamma: g }))
    .filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.gamma))
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;

  const crossings = [];
  let cum = 0, prevStrike = rows[0].strike, prevCum = 0;
  for (const r of rows) {
    cum += r.gamma;
    if (prevCum <= 0 && cum > 0) {
      const frac = -prevCum / (cum - prevCum);
      crossings.push(Number((prevStrike + frac * (r.strike - prevStrike)).toFixed(2)));
    }
    prevStrike = r.strike;
    prevCum = cum;
  }
  if (crossings.length === 0) return null;
  if (!(spot > 0)) return crossings[crossings.length - 1];

  const FLIP_MAX_DIST_PCT = 0.12;
  const plausible = crossings.filter((c) => Math.abs(c - spot) <= spot * FLIP_MAX_DIST_PCT);
  if (plausible.length === 0) return null;
  // Lowest plausible crossing — mirrors cumulativeGammaFlipDetail on server (#2417+).
  return plausible.reduce((lowest, c) => (c < lowest ? c : lowest));
}

/** Side-constrained max +/- strike above/below spot (wallsFromStrikeTotals rule). */
function wallsFromStrikeTotals(strikeTotals, spot) {
  const constrained = typeof spot === "number" && Number.isFinite(spot) && spot > 0;
  let callWall = null, putWall = null, maxPos = 0, maxNeg = 0;
  for (const [s, g] of Object.entries(strikeTotals)) {
    const strike = Number(s);
    if (!Number.isFinite(strike) || !Number.isFinite(g)) continue;
    if (g > maxPos && (!constrained || strike > spot)) { maxPos = g; callWall = strike; }
    if (g < maxNeg && (!constrained || strike < spot)) { maxNeg = g; putWall = strike; }
  }
  return { pos: callWall, neg: putWall };
}

const FLIP_TOL = 0.05; // linear-interpolation is deterministic; allow float noise only

async function fetchApp(path, cookie) {
  const res = await fetch(`${APP}${path}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function polygonFetch(path) {
  for (const base of [POLY_BASE, POLY_FALLBACK]) {
    try {
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(`${base}${path}${sep}apiKey=${POLY_KEY}`, { cache: "no-store" });
      if (res.status === 200) return await res.json();
    } catch { /* try next base */ }
  }
  return null;
}

async function groundTruthSpot(ticker) {
  if (ticker === "SPX") {
    const snap = await polygonFetch("/v3/snapshot/indices?ticker.any_of=I:SPX");
    const row = (snap?.results || []).find((r) => r.ticker === "I:SPX");
    return num(row?.value);
  }
  const snap = await polygonFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`);
  return num(snap?.ticker?.lastTrade?.p ?? snap?.ticker?.day?.c);
}

/** Re-derive strike_totals from `cells` summed over `near_term_expiries`, matching
 *  the server's buildMetric() near-term/far-dated split exactly (polygon-options-gex.ts). */
function rederiveStrikeTotalsFromCells(cells, nearTermExpiries) {
  if (!cells || !Array.isArray(nearTermExpiries) || nearTermExpiries.length === 0) return null;
  const nearSet = new Set(nearTermExpiries);
  const out = {};
  for (const [strike, row] of Object.entries(cells)) {
    let sum = 0;
    for (const [expiry, val] of Object.entries(row)) {
      if (nearSet.has(expiry) && Number.isFinite(val)) sum += val;
    }
    if (sum !== 0) out[strike] = sum;
  }
  return out;
}

function checkMetricBlock(label, block, spot, nearTermExpiries, flipFn, wallFieldNames) {
  if (!block) { rec(`${label}: present`, "INFO", "block absent on this payload (optional metric)"); return; }

  // (a) total === sum(strike_totals)
  const sum = Object.values(block.strike_totals || {}).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const totalDiff = Math.abs(sum - num(block.total));
  rec(`${label}: total reconciles with Σstrike_totals`, totalDiff <= 0.02 ? "PASS" : "FAIL",
    `total=${block.total} Σstrike_totals=${sum.toFixed(2)} Δ=${totalDiff.toFixed(4)}`);

  // (b) strike_totals re-derived from cells over near_term_expiries
  const rederived = rederiveStrikeTotalsFromCells(block.cells, nearTermExpiries);
  if (rederived) {
    const keys = new Set([...Object.keys(rederived), ...Object.keys(block.strike_totals || {})]);
    let maxDiff = 0, worstStrike = null;
    for (const k of keys) {
      const d = Math.abs((rederived[k] ?? 0) - (block.strike_totals?.[k] ?? 0));
      if (d > maxDiff) { maxDiff = d; worstStrike = k; }
    }
    rec(`${label}: cells → strike_totals integrity`, maxDiff <= 0.02 ? "PASS" : "FAIL",
      `max Δ=${maxDiff.toFixed(4)} at strike ${worstStrike} (${keys.size} strikes checked)`);
  } else {
    rec(`${label}: cells → strike_totals integrity`, "INFO", "near_term_expiries or cells unavailable — skipped");
  }

  // (c) walls — GEX is side-constrained vs spot (#2417); VEX uses global argmax.
  if (wallFieldNames && block.strike_totals) {
    const wallSpot = label === "gex" ? spot : undefined;
    const { pos, neg } = wallsFromStrikeTotals(block.strike_totals, wallSpot);
    const [posField, negField] = wallFieldNames;
    const reportedPos = num(block[posField]), reportedNeg = num(block[negField]);
    rec(`${label}: ${posField} matches independent recompute`, (pos == null && reportedPos == null) || pos === reportedPos ? "PASS" : "FAIL",
      `reported=${reportedPos} recomputed=${pos}`);
    rec(`${label}: ${negField} matches independent recompute`, (neg == null && reportedNeg == null) || neg === reportedNeg ? "PASS" : "FAIL",
      `reported=${reportedNeg} recomputed=${neg}`);
  }

  // (d) flip / zero_level
  if (flipFn && block.strike_totals) {
    const flipField = "flip" in block ? "flip" : "zero_level";
    const reported = num(block[flipField]);
    const recomputed = flipFn(block.strike_totals, spot);
    const bothNull = reported == null && recomputed == null;
    const diff = reported != null && recomputed != null ? Math.abs(reported - recomputed) : null;
    rec(`${label}: ${flipField} matches independent recompute`, bothNull || (diff != null && diff <= FLIP_TOL) ? "PASS" : "FAIL",
      `reported=${reported} recomputed=${recomputed}${diff != null ? ` Δ=${diff.toFixed(4)}` : ""}`);
  }
}

async function validateTicker(ticker, cookie, rth) {
  console.log(`\n── ${ticker} ──`);
  const { status, body: hm } = await fetchApp(`/api/market/gex-heatmap?ticker=${ticker}`, cookie);
  if (status !== 200 || !hm) { rec(`${ticker}: endpoint reachable`, "FAIL", `HTTP ${status}`); return; }
  if (hm.available !== true) { rec(`${ticker}: available`, "INFO", `available=${hm.available} — skipping deep checks (no usable data this sample)`); return; }
  rec(`${ticker}: available`, "PASS", `spot=${hm.spot} strikes=${hm.strikes?.length} expiries=${hm.expiries?.length}`);

  // Spot vs Polygon ground truth
  const gtSpot = await groundTruthSpot(ticker);
  const appSpot = num(hm.spot);
  if (gtSpot != null && appSpot != null) {
    const d = Math.abs(appSpot - gtSpot) / gtSpot * 100;
    rec(`${ticker}: spot vs Polygon`, d <= (rth ? 0.5 : 2) ? "PASS" : "WARN", `app=${appSpot} polygon=${gtSpot.toFixed(2)} Δ=${d.toFixed(3)}%`);
  } else {
    rec(`${ticker}: spot vs Polygon`, "INFO", `gt=${gtSpot} app=${appSpot} (one side unavailable)`);
  }

  // Expiry axis sanity
  const nte = hm.near_term_expiries;
  if (Array.isArray(nte) && Array.isArray(hm.expiries)) {
    const expirySet = new Set(hm.expiries);
    const subset = nte.every((e) => expirySet.has(e));
    const ascending = (arr) => arr.every((v, i) => i === 0 || v >= arr[i - 1]);
    rec(`${ticker}: near_term_expiries ⊆ expiries`, subset ? "PASS" : "FAIL", `near=${nte.length} all=${hm.expiries.length}`);
    rec(`${ticker}: expiries ascending`, ascending(hm.expiries) && ascending(nte) ? "PASS" : "FAIL", "");
  } else {
    rec(`${ticker}: near_term_expiries present`, "INFO", "absent on this payload — skipping expiry-axis + cell-integrity checks");
  }

  // max_pain within strike range
  if (hm.max_pain != null && Array.isArray(hm.strikes) && hm.strikes.length) {
    const lo = Math.min(...hm.strikes), hi = Math.max(...hm.strikes);
    const inRange = hm.max_pain >= lo && hm.max_pain <= hi;
    rec(`${ticker}: max_pain within strike range`, inRange ? "PASS" : "FAIL", `max_pain=${hm.max_pain} range=[${lo},${hi}]`);
  } else {
    rec(`${ticker}: max_pain within strike range`, "INFO", `max_pain=${hm.max_pain}`);
  }

  // Metric blocks
  checkMetricBlock("gex", hm.gex, appSpot, nte, cumulativeGammaFlip, ["call_wall", "put_wall"]);
  checkMetricBlock("vex", hm.vex, appSpot, nte, zeroGammaFlip, ["pos_wall", "neg_wall"]);
  checkMetricBlock("dex", hm.dex, appSpot, nte, zeroGammaFlip, null);
  checkMetricBlock("charm", hm.charm, appSpot, nte, zeroGammaFlip, null);

  // Off-hours shift gate (task #174)
  if (!rth) {
    for (const key of ["shift", "vex_shift", "dex_shift", "charm_shift"]) {
      const block = hm[key];
      if (block === undefined) continue; // optional block, absent is fine
      rec(`${ticker}: ${key}.available===false off-hours`, block.available === false ? "PASS" : "FAIL", JSON.stringify(block).slice(0, 120));
    }
  } else {
    rec(`${ticker}: off-hours shift gate`, "INFO", "market is in RTH — gate not applicable this run");
  }

  // cross_validation shape (informational — UW is a second opinion, not ground truth to FAIL against)
  if (hm.cross_validation) {
    const cv = hm.cross_validation;
    const malformed = [];
    scanMalformed(cv, `${ticker}.cross_validation`, malformed);
    rec(`${ticker}: cross_validation shape`, malformed.length === 0 ? "PASS" : "WARN", malformed.length ? malformed.slice(0, 3).join("; ") : JSON.stringify(cv).slice(0, 160));
  } else {
    rec(`${ticker}: cross_validation present`, "INFO", "absent on this payload");
  }

  // Malformed-number scan across the whole payload
  const malformed = [];
  scanMalformed(hm, ticker, malformed);
  rec(`${ticker}: malformed-number scan`, malformed.length === 0 ? "PASS" : "FAIL", malformed.length ? malformed.slice(0, 8).join("; ") : `${JSON.stringify(hm).length} bytes clean`);
}

async function main() {
  console.log(`Thermal matrix validator — tickers: ${TICKERS.join(",")}`);
  const session = await mintClerkPremiumSession({ appUrl: APP });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(1);
  }

  const marketStatus = await polygonFetch("/v1/marketstatus/now");
  const rth = marketStatus?.market === "open";
  rec("market status", "INFO", `Polygon market=${marketStatus?.market} (RTH=${rth})`);

  try {
    for (const ticker of TICKERS) {
      await validateTicker(ticker, session.cookieHeader, rth);
    }
  } finally {
    await session.cleanup();
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const warns = checks.filter((c) => c.status === "WARN");
  console.log(`\n${checks.length} checks — ${checks.length - fails.length - warns.length} PASS/INFO, ${warns.length} WARN, ${fails.length} FAIL`);
  if (JSON_OUT) console.log(JSON.stringify({ tickers: TICKERS, rth, checks }, null, 2));
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
