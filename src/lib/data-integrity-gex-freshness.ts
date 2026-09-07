import { ZERODTE_MARK_FUTURE_TOLERANCE_MS } from "@/lib/zerodte/marks-math";

function matrixAgeMin(thenMs: number, now: number): number {
  const diffMs = now - thenMs;
  if (diffMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS) return Infinity;
  return diffMs / 60_000;
}

/** RTH GEX matrix `asof` age in minutes — mirrors data-integrity-verifier's redis_gex freshness band. */
export function gexMatrixRthAgeMin(asof: string, now: number): number {
  const asofMs = new Date(asof).getTime();
  return Number.isFinite(asofMs) ? matrixAgeMin(asofMs, now) : Infinity;
}

export function gexMatrixStaleDuringRth(asof: string, now: number): boolean {
  const asofMs = new Date(asof).getTime();
  const matrixAgeMin = gexMatrixRthAgeMin(asof, now);
  return !Number.isFinite(asofMs) || matrixAgeMin > 15;
}
