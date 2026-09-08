/**
 * CHARM depth validator — offline closed-form vs finite-difference delta decay.
 *
 * GEX has `gex-depth-validate.mjs` (live ladder vs provider gamma). CHARM had no sibling
 * audit script (CLQ-017). This harness validates `charmPerShare()` in polygon-options-gex.ts
 * against an independent Black-Scholes call-delta finite-difference route — the same
 * cross-check the provider file documents (~1e-7 agreement at r=q=0).
 *
 * Read-only. No Polygon, no DB, no writes.
 *
 * Run:
 *   node --import tsx scripts/audit/charm-depth-validate.mjs [--json]
 */
import { __test_charmPerShare } from "../../src/lib/providers/polygon-options-gex.ts";
import { normCdf } from "../../src/lib/gex-depth.ts";

const asJson = process.argv.includes("--json");

function callDelta(spot, strike, t, sigma, q = 0) {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const sqrtT = Math.sqrt(t);
  const r = 0;
  const d1 = (Math.log(spot / strike) + (r - q + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const discount = Math.exp(-q * t);
  const delta = discount * normCdf(d1);
  return Number.isFinite(delta) ? delta : 0;
}

function putDelta(spot, strike, t, sigma, q = 0) {
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(sigma > 0)) return 0;
  const discount = Math.exp(-q * t);
  const delta = callDelta(spot, strike, t, sigma, q) - discount;
  return Number.isFinite(delta) ? delta : 0;
}

/** Central finite-difference −∂Δ/∂T (provider convention: delta decay per year of time remaining). */
function charmFiniteDiff(spot, strike, t, sigma, q = 0, type = "call") {
  const h = Math.max(t * 1e-3, 1e-5);
  const tLo = Math.max(t - h, 1e-6);
  const tHi = t + h;
  const deltaAt = type === "put" ? putDelta : callDelta;
  const dLo = deltaAt(spot, strike, tLo, sigma, q);
  const dHi = deltaAt(spot, strike, tHi, sigma, q);
  return -((dHi - dLo) / (tHi - tLo));
}

const CASES = [
  { spot: 450, strike: 455, t: 0.08, sigma: 0.22, q: 0, type: "call" },
  { spot: 450, strike: 455, t: 0.08, sigma: 0.22, q: 0.012, type: "call" },
  { spot: 450, strike: 455, t: 0.08, sigma: 0.22, q: 0.012, type: "put" },
  { spot: 520, strike: 500, t: 0.02, sigma: 0.35, q: 0, type: "call" },
  { spot: 180, strike: 200, t: 0.15, sigma: 0.55, q: 0, type: "call" },
  { spot: 38, strike: 40, t: 0.04, sigma: 0.9, q: 0, type: "call" },
  { spot: 6000, strike: 5950, t: 0.01, sigma: 0.12, q: 0, type: "call" },
];

const TOL_REL = 1e-4;
const TOL_ABS = 1e-7;

const rows = [];
let worst = "PASS";

for (const c of CASES) {
  const type = c.type ?? "call";
  const closed = __test_charmPerShare(c.spot, c.strike, c.t, c.sigma, c.q, type);
  const fd = charmFiniteDiff(c.spot, c.strike, c.t, c.sigma, c.q, type);
  const denom = Math.max(Math.abs(closed), Math.abs(fd), 1e-9);
  const relErr = Math.abs(closed - fd) / denom;
  const pass = relErr <= TOL_REL || Math.abs(closed - fd) <= TOL_ABS;
  const verdict = pass ? "PASS" : "FAIL";
  if (verdict === "FAIL") worst = "FAIL";
  rows.push({
    ...c,
    closed: Number(closed.toFixed(8)),
    finiteDiff: Number(fd.toFixed(8)),
    relErrPct: Number((relErr * 100).toFixed(4)),
    verdict,
  });
}

if (asJson) {
  console.log(JSON.stringify({ worst, cases: rows }, null, 2));
} else {
  console.log("CHARM closed-form vs finite-difference (∂Δ/∂T)");
  for (const r of rows) {
    console.log(
      `  S=${r.spot} K=${r.strike} T=${r.t} σ=${r.sigma} q=${r.q} ${r.type ?? "call"}: closed=${r.closed} fd=${r.finiteDiff} err=${r.relErrPct}% [${r.verdict}]`
    );
  }
  console.log(`\nWORST VERDICT: ${worst}`);
}

process.exit(worst === "FAIL" ? 1 : 0);
