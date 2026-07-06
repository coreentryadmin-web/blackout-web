/**
 * Cross-tool spot/flip agreement tolerances for RTH audit scripts.
 * Mirrors heatmap-verifier desk-vs-matrix flip band: max(1% of spot, 1 pt).
 * Parallel fetches during live RTH routinely diverge by sub-point to a few points.
 */
export function spotAgreementTol(spot) {
  const s = Number(spot);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.max(s * 0.01, 1);
}

export function spotsAgree(a, b, spotHint) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  const tol = spotAgreementTol(spotHint ?? (a + b) / 2);
  return Math.abs(a - b) <= tol;
}

export function flipsAgree(a, b, spotHint) {
  return spotsAgree(a, b, spotHint);
}
