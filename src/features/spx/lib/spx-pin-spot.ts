/**
 * Resolve pin spot/prior-close from pulse first, then the full desk.
 * Pulse is allowed to return price:0 off-hours; desk still holds the last real print.
 * Pure helper (no server-only) — unit-tested; used by buildSpxPinForecast.
 */
export function resolvePinSpotInputs(
  pulse: { price: number; prior_close: number | null } | null | undefined,
  desk: { price: number; prior_close: number | null } | null | undefined
): { spot: number; priorClose: number | null } {
  let spot = pulse?.price ?? 0;
  let priorClose = pulse?.prior_close ?? null;
  if (!(spot > 0) && desk && desk.price > 0) {
    spot = desk.price;
    priorClose = priorClose ?? desk.prior_close ?? null;
  }
  return { spot, priorClose };
}
