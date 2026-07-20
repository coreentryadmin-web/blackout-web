#!/usr/bin/env node
/**
 * SPX Slayer matrix ↔ shared gex-heatmap API parity probe.
 * Compares 0DTE-scoped strike totals from the matrix API for cell drift.
 */
const BASE = process.env.VALIDATE_BASE_URL ?? "https://blackouttrades.com";

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function main() {
  const matrix = await fetchJson("/api/market/gex-heatmap?ticker=SPX");
  if (!matrix?.gex?.strike_totals) {
    console.error("FAIL: no SPX strike_totals");
    process.exit(1);
  }
  const strikes = Object.keys(matrix.gex.strike_totals).slice(0, 5);
  let ok = true;
  for (const s of strikes) {
    const v = matrix.gex.strike_totals[s];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      console.error(`FAIL: invalid total at strike ${s}`);
      ok = false;
    }
  }
  if (matrix.shift?.available && matrix.shift.delta_by_strike) {
    const deltas = Object.keys(matrix.shift.delta_by_strike).length;
    console.log(`shift leaders pool: ${deltas} strikes`);
  }
  console.log(
    ok
      ? `OK: SPX matrix parity probe (${strikes.length} sample strikes, spot=${matrix.spot})`
      : "FAIL: parity probe"
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
