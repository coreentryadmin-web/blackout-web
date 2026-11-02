/**
 * SPX desk vs Polygon oracle — same RTH/off-hours discipline as data-validator.mjs.
 */

/** @returns {boolean} */
export function polygonMarketOpen(marketStatusPayload) {
  return marketStatusPayload?.market === "open";
}

/** @param {number | null | undefined} deskSpx @param {number | null | undefined} oracle @param {boolean} rth */
export function spxOracleVerdict(deskSpx, oracle, rth) {
  if (!(Number(deskSpx) > 0) || !(Number(oracle) > 0)) {
    return { ok: true, detail: "oracle skipped (missing desk or Polygon reference)" };
  }
  const desk = Number(deskSpx);
  const ref = Number(oracle);
  const delta = Math.abs(ref - desk);
  if (rth) {
    const tolPct = 0.3;
    const pct = (delta / ref) * 100;
    const ok = pct <= tolPct;
    return {
      ok,
      detail: `desk ${desk} vs Polygon live ${ref} (Δ ${delta.toFixed(2)}, ${pct.toFixed(3)}%)`,
      severity: ok ? undefined : "P0",
    };
  }
  const tolPct = 1.5;
  const pct = (delta / ref) * 100;
  const ok = pct <= tolPct;
  return {
    ok,
    detail: `desk ${desk} vs Polygon prev-close ${ref} (Δ ${pct.toFixed(3)}%)`,
    severity: ok ? undefined : "P0",
  };
}
