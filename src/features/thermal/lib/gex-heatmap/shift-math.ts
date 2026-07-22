/**
 * Percent change implied by a $-delta over the shift window, expressed relative to the
 * MAGNITUDE of the value before that delta was applied (baseline = current - delta).
 * Dividing by |baseline| (not baseline) keeps the sign of the result tied to the sign of
 * delta itself — a strike that melted from -$1.0M to -$0.5M (delta=+$0.5M, "building" back
 * toward zero) reads +50%, matching the green "built" convention the Shift view already
 * uses (`built = delta > 0`), instead of the confusing negative a bare delta/baseline would
 * produce when baseline is negative.
 *
 * Returns null (never NaN/Infinity) when there's no delta to work with or the baseline is
 * ~zero — a percent change from ~zero is undefined, and this pipeline never fabricates a
 * shift (mirrors GexShift's own `available` gate).
 */
export function shiftPercentForStrike(
  currentValue: number,
  delta: number | null | undefined
): number | null {
  if (delta == null || !Number.isFinite(delta) || !Number.isFinite(currentValue)) return null;
  const baseline = currentValue - delta;
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1) return null;
  return (delta / Math.abs(baseline)) * 100;
}

/**
 * Wall STRENGTH shift: did the dealer gamma parked at this strike get HEAVIER or LIGHTER over the
 * window, and by what %? This is what a trader means by a wall "building" vs "melting".
 *
 * `shiftPercentForStrike` above keys its sign to the raw signed delta — which is correct for a
 * call-side (positive-GEX) strike but INVERTS on the put side: a put wall building means its net
 * GEX goes MORE NEGATIVE (delta < 0), so the raw-delta convention (`built = delta > 0`) mislabels a
 * strengthening put wall as "melted" and a decaying one as "built". This compares |current| vs
 * |baseline| instead, so `built` means the wall's magnitude grew regardless of which side it's on,
 * and the % is signed by that growth (+ = heavier, − = lighter) — always consistent with the verb.
 *
 * Returns null on the same guards (no delta / ~zero baseline) so it never fabricates a shift.
 */
export function wallStrengthShift(
  currentValue: number,
  delta: number | null | undefined
): { pct: number; built: boolean } | null {
  if (delta == null || !Number.isFinite(delta) || !Number.isFinite(currentValue)) return null;
  const baseline = currentValue - delta;
  if (!Number.isFinite(baseline) || Math.abs(baseline) < 1) return null;
  const magnitudeDelta = Math.abs(currentValue) - Math.abs(baseline);
  return { pct: (magnitudeDelta / Math.abs(baseline)) * 100, built: magnitudeDelta > 0 };
}
