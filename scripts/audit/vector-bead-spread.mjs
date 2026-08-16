/**
 * BEAD SIZE SPREAD — measured, not eyeballed.
 *
 * "All the beads look the same size" is a claim about a DISTRIBUTION, so answer it with one. This
 * pulls the live wall rail for a ticker and runs the REAL production sizing function
 * (`targetHalfPx`, with the real `BEAD_TUNING_DEFAULT`) over the real per-strike gamma shares, then
 * reports how many visually distinct bead radii the shipped code actually produces.
 *
 * Both sizing modes are measured, because the `$ Size` chip picks between them:
 *   - dollar OFF (default) → frame-relative: halfMin + (pct/maxPct)^1.6 × (halfMax − halfMin)
 *   - dollar ON            → absolute $ ladder, log-mapped over $200M…$2.5B
 *
 * The number that matters is not the min/max spread but how many beads land within ~1px of the
 * FLOOR: beads inside a pixel of each other are indistinguishable on screen, so a large floor
 * cluster IS the "they all look the same" complaint, regardless of what the extremes say.
 */
import { targetHalfPx, BEAD_TUNING_DEFAULT } from "../../src/features/vector/lib/vector-wall-rail-core.ts";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const TICKERS = (process.argv.find((a) => a.startsWith("--tickers="))?.split("=")[1] || "SPX,SPY,NVDA").split(",");
const DTE = process.argv.find((a) => a.startsWith("--dte="))?.split("=")[1] || "0dte";

const q = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : null);

async function main() {
  try {
    for (const ticker of TICKERS) {
      let payload = null;
      for (const path of [
        `/api/market/vector/walls?ticker=${ticker}&dte=${DTE}`,
        `/api/market/vector/rail-bootstrap?ticker=${ticker}&dte=${DTE}`,
      ]) {
        const res = await fetchAuditJson(BASE, path).catch(() => null);
        if (res?.ok && res.json) { payload = { path, json: res.json }; break; }
      }
      if (!payload) { console.log(`${ticker}: no wall payload reachable — SKIP (harness, not product)`); continue; }

      // Collect per-strike gamma shares from whatever shape the payload uses.
      const pcts = [];
      const notionals = [];
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (typeof node.pct === "number" && typeof node.strike === "number") {
          pcts.push(node.pct);
          notionals.push(typeof node.notional === "number" ? node.notional : undefined);
        }
        for (const v of Object.values(node)) walk(v);
      };
      walk(payload.json);
      if (!pcts.length) { console.log(`${ticker}: payload carried no {strike,pct} rows (${payload.path}) — SKIP`); continue; }

      const maxPct = Math.max(...pcts);
      const t = BEAD_TUNING_DEFAULT;

      for (const [mode, useDollar] of [["frame-relative (default, $ Size OFF)", false], ["$ ladder ($ Size ON)", true]]) {
        const radii = pcts.map((p, i) =>
          targetHalfPx(p, useDollar ? notionals[i] : undefined, maxPct, t)
        );
        const floor = t.halfMin;
        const nearFloor = radii.filter((r) => r <= floor + 1).length;
        const distinct = new Set(radii.map((r) => Math.round(r * 2) / 2)).size; // 0.5px buckets
        console.log(
          `\n${ticker}  ${mode}\n` +
          `  strikes=${pcts.length}  maxPct=${maxPct.toFixed(2)}%  medianPct=${q(pcts, 50).toFixed(2)}%\n` +
          `  radius px: min=${Math.min(...radii).toFixed(2)} p50=${q(radii, 50).toFixed(2)} p90=${q(radii, 90).toFixed(2)} max=${Math.max(...radii).toFixed(2)}  (band ${t.halfMin}-${t.halfMax})\n` +
          `  within 1px of floor: ${nearFloor}/${radii.length} (${((nearFloor / radii.length) * 100).toFixed(0)}%)  <- these are visually identical\n` +
          `  distinct sizes at 0.5px granularity: ${distinct}`
        );
      }
    }
  } finally {
    await releaseAuditClerkSession().catch(() => {});
  }
}
main().catch((e) => { console.error("HARNESS ERROR:", e?.message || e); process.exitCode = 1; });
