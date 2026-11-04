/**
 * SPX desk vs Polygon oracle — same RTH/off-hours convention as data-validator.mjs:
 * live index snapshot during RTH, prior daily close off-hours; percent tolerance not raw points.
 */

/**
 * Live index snapshot vs prior close — same fallback as gha-rth-audit: when Polygon
 * marketstatus is missing/wrong during the ET RTH window, never compare live desk to prev-close.
 */
export function resolveOracleUsesLiveRth(polygonMarketOpen, etInRthOpenWindow) {
  if (polygonMarketOpen === true) return true;
  if (etInRthOpenWindow) return true;
  return false;
}

/** @returns {{ verdict: "pass" | "fail" | "skip"; pct?: number; tolPct?: number; rth?: boolean }} */
export function spxOracleVerdict(deskSpx, oracle, rth) {
  const desk = Number(deskSpx);
  const gt = Number(oracle);
  if (!(desk > 0 && gt > 0)) return { verdict: "skip" };
  const pct = (Math.abs(gt - desk) / gt) * 100;
  const tolPct = rth ? 0.3 : 1.5;
  return {
    verdict: pct <= tolPct ? "pass" : "fail",
    pct,
    tolPct,
    rth: Boolean(rth),
  };
}
