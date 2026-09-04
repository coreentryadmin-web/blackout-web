/**
 * Ground-truth session HOD/LOD from Polygon minute aggregates.
 * During RTH the daily bar's h/l can lag behind minute bars — the desk builds extremes
 * from intraday minutes, so validators must too.
 */
export function sessionExtremesFromMinuteBars(bars) {
  if (!Array.isArray(bars) || !bars.length) return { hod: null, lod: null };
  let maxH = -Infinity;
  let minL = Infinity;
  for (const b of bars) {
    const h = Number(b?.h);
    const l = Number(b?.l);
    if (Number.isFinite(h)) maxH = Math.max(maxH, h);
    if (Number.isFinite(l)) minL = Math.min(minL, l);
  }
  return {
    hod: maxH > -Infinity ? maxH : null,
    lod: minL < Infinity ? minL : null,
  };
}
