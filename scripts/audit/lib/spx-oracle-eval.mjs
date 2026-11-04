/**
 * SPX vs Polygon oracle for RTH deep audit:
 * - RTH: live desk price vs live index snapshot (0.3%).
 * - Off-hours: desk prior_close vs Polygon prev daily close (0.05%) — NOT session price vs
 *   prev close (that false-fails on any |day change| > tol, e.g. 2026-11-04 Δ 1.518%).
 */

/** @returns {{ verdict: "pass" | "fail" | "skip"; pct?: number; tolPct?: number; rth?: boolean }} */
export function spxOracleVerdict(deskSpx, oracle, rth) {
  const desk = Number(deskSpx);
  const gt = Number(oracle);
  if (!(desk > 0 && gt > 0)) return { verdict: "skip" };
  const pct = (Math.abs(gt - desk) / gt) * 100;
  const tolPct = rth ? 0.3 : 0.05;
  return {
    verdict: pct <= tolPct ? "pass" : "fail",
    pct,
    tolPct,
    rth: Boolean(rth),
  };
}
