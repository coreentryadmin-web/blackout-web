/**
 * SPX desk vs Polygon oracle — RTH: live index snapshot; off-hours: last session close
 * (desk carries the settled session level, not prior-day close — comparing to /prev false-fails
 * after any |day move| > tolerance, e.g. RTH deep audit 2026-11-04 Δ 1.518% vs prev-close).
 */

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
